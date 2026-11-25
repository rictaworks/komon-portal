import { beforeEach, describe, expect, it } from "vitest";
import { OPEN_TICKET_SECONDS } from "../../../src/core/publish/view-service";
import { caseRecord, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();
const member = memberActor(["c1"], "u-member");
/** The secret of the session that asks; each browser session has its own. */
const SESSION = "session-secret-one";
const OTHER_SESSION = "session-secret-two";
const NOT_OPENED = "invalid_state: not_opened";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

describe("ViewService", () => {
  let kit: IntakeKit;

  function written(): unknown[] {
    return [kit.repo.receiptRows.length, kit.repo.auditRows.length, kit.repo.metricRows.length, kit.repo.fileRows.map((row) => row.version)];
  }

  beforeEach(async () => {
    kit = intakeKit();
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", state: "Delivered" }));
    kit.repo.fileRows.push(
      fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date("2026-11-24T02:00:00.000Z"), displayName: "C0031_SHAHO_20261124_01", format: "jpeg" }),
      fileRecord({ id: "f2", clientId: "c2", state: "Published", publishedAt: new Date(), sha256: "b".repeat(64) }),
      fileRecord({ id: "f3", state: "Staged", sha256: "c".repeat(64) }),
    );
    for (const row of kit.repo.fileRows) {
      await kit.store.put(row.r2Key, new Uint8Array([1, 2, 3]));
    }
  });

  it("returns the body of an opened file with a generated download name", async () => {
    const { ticket } = await kit.view.open(member, "f1", "download", SESSION);
    const opened = await kit.view.download(member, "f1", SESSION, ticket);
    expect(opened.downloadName).toBe("C0031_SHAHO_20261124_01.jpg");
    expect(opened.body.sizeBytes).toBe(3);
    expect(await readAll(opened.body.body)).toEqual([1, 2, 3]);
  });

  it("records the first open of each member once and confirms the case", async () => {
    await kit.view.open(member, "f1", "view", SESSION);
    await kit.view.open(member, "f1", "download", SESSION);
    await kit.view.open(memberActor(["c1"], "u-second"), "f1", "view", OTHER_SESSION);
    expect(kit.repo.receiptRows.map((row) => [row.fileId, row.userId])).toEqual([["f1", "u-member"], ["f1", "u-second"]]);
    expect(kit.repo.receiptRows[0]?.firstViewedAt).toEqual(kit.clock.now());
    expect(kit.repo.caseRows[0]?.state).toBe("Confirmed");
    expect(kit.repo.metricRows.filter((row) => row.name === "file.first_viewed")).toHaveLength(2);
    expect(kit.repo.metricRows.find((row) => row.name === "file.first_viewed")?.attributes.secondsSincePublished).toBe(3600);
  });

  it("hands out no body, and writes nothing, before the open is on record", async () => {
    await expect(kit.view.download(member, "f1", SESSION, null)).rejects.toThrow(NOT_OPENED);
    expect(kit.repo.receiptRows).toEqual([]);
    expect(kit.repo.auditRows).toEqual([]);
    expect(kit.repo.metricRows).toEqual([]);
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
    const colleague = await kit.view.open(memberActor(["c1"], "u-second"), "f1", "view", OTHER_SESSION);
    await expect(kit.view.download(member, "f1", SESSION, colleague.ticket)).rejects.toThrow(NOT_OPENED);
  });

  it("refuses every download that does not follow an open, whoever asks and whatever the file", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f4", direction: "Inbound", state: "Submitted", sha256: "d".repeat(64) }));
    await kit.store.put("files/f4", new Uint8Array([9]));
    const before = written();
    for (const fileId of ["f1", "f2", "f3", "f4"]) {
      await expect(kit.view.download(staff, fileId, SESSION, null)).rejects.toThrow(NOT_OPENED);
    }
    await expect(kit.view.download(member, "f4", SESSION, null)).rejects.toThrow(NOT_OPENED);
    for (const forged of ["", "x", "9999999999999.", `9999999999999.${"0".repeat(64)}`]) {
      await expect(kit.view.download(staff, "f3", SESSION, forged)).rejects.toThrow(NOT_OPENED);
    }
    expect(written()).toEqual(before);
  });

  it("accepts an open only in the session that made it, for that file, and for a short time", async () => {
    const { ticket } = await kit.view.open(member, "f1", "view", SESSION);
    const other = await kit.view.open(member, "f1", "view", OTHER_SESSION);
    await expect(kit.view.download(member, "f1", OTHER_SESSION, ticket)).rejects.toThrow(NOT_OPENED);
    await expect(kit.view.download(member, "f1", SESSION, other.ticket)).rejects.toThrow(NOT_OPENED);
    // A receipt on record from an earlier open is not enough: staff opened f2, then asks for f1 with that proof.
    const second = await kit.view.open(staff, "f2", "view", SESSION);
    await expect(kit.view.download(staff, "f1", SESSION, second.ticket)).rejects.toThrow(NOT_OPENED);
    await expect(kit.view.download(staff, "f1", SESSION, ticket)).rejects.toThrow(NOT_OPENED);
    const [expiry, signature] = ticket.split(".");
    await expect(kit.view.download(member, "f1", SESSION, `${Number(expiry) + 60_000}.${signature}`)).rejects.toThrow(NOT_OPENED);
    await (await kit.view.download(member, "f1", SESSION, ticket)).body.body.cancel();
    kit.clock.current = new Date(kit.clock.current.getTime() + OPEN_TICKET_SECONDS * 1000);
    await expect(kit.view.download(member, "f1", SESSION, ticket)).rejects.toThrow(NOT_OPENED);
  });

  it("refuses to open or download without a session secret", async () => {
    await expect(kit.view.open(member, "f1", "view", "")).rejects.toThrow("session secret");
    await expect(kit.view.download(member, "f1", "", null)).rejects.toThrow("session secret");
    expect(kit.repo.receiptRows).toEqual([]);
  });

  it("writes nothing when an opened file is downloaded", async () => {
    const { ticket } = await kit.view.open(member, "f1", "view", SESSION);
    const before = written();
    await (await kit.view.download(member, "f1", SESSION, ticket)).body.body.cancel();
    expect(written()).toEqual(before);
  });

  it("answers not found for a download of another client's file and audits the denial", async () => {
    await expect(kit.view.download(member, "f2", SESSION, null)).rejects.toThrow("not_found: file");
    expect(kit.repo.auditRows).toEqual([expect.objectContaining({ action: "file.download", targetId: "f2", result: "denied" })]);
  });

  it("does not count a staff view as a receipt", async () => {
    await kit.view.open(staff, "f1", "view", SESSION);
    expect(kit.repo.receiptRows).toEqual([]);
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
  });

  it("audits every view and download, of members and of staff", async () => {
    await kit.view.open(member, "f1", "view", SESSION);
    await kit.view.open(member, "f1", "download", SESSION);
    await kit.view.open(staff, "f3", "view", OTHER_SESSION);
    expect(kit.repo.auditRows.map((row) => [row.action, row.targetId, row.result])).toEqual([
      ["file.receive", "f1", "ok"], ["case.state_change", "k1", "ok"], ["file.view", "f1", "ok"], ["file.download", "f1", "ok"], ["file.view", "f3", "ok"],
    ]);
  });

  it.each([
    ["another client's file", "f2"],
    ["a file that is not published", "f3"],
    ["an unknown file", "missing"],
  ])("answers not found for %s and audits the denial", async (_name, fileId) => {
    await expect(kit.view.open(member, fileId, "view", SESSION)).rejects.toThrow("not_found: file");
    expect(kit.repo.auditRows).toEqual([expect.objectContaining({ action: "file.view", targetId: fileId, result: "denied", actorUserId: "u-member" })]);
    expect(kit.repo.receiptRows).toEqual([]);
  });

  it("refuses a withdrawn file even to a member who opened it a moment ago", async () => {
    const { ticket } = await kit.view.open(member, "f1", "view", SESSION);
    await kit.publish.withdraw(staff, "f1", { reason: "WrongFile", next: "NeedsReview" }, 1);
    await expect(kit.view.open(member, "f1", "download", SESSION)).rejects.toThrow("not_found: file");
    await expect(kit.view.download(member, "f1", SESSION, ticket)).rejects.toThrow("not_found: file");
  });

  it("refuses the open when the file is withdrawn while it is being opened", async () => {
    const original = kit.repo.receipts.insertIfAbsent;
    kit.repo.receipts.insertIfAbsent = async (receipt) => {
      const inserted = await original(receipt);
      await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
      return inserted;
    };
    await expect(kit.view.open(member, "f1", "download", SESSION)).rejects.toThrow("not_found: file");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "NeedsReview", incidentFlag: true });
  });

  it("confirms the case on a later open when the first attempt failed after the receipt", async () => {
    const original = kit.repo.audit.append;
    let failed = false;
    kit.repo.audit.append = async (entry) => {
      if (entry.action === "file.receive" && !failed) {
        failed = true;
        throw new Error("audit unavailable");
      }
      await original(entry);
    };
    await expect(kit.view.open(member, "f1", "view", SESSION)).rejects.toThrow("audit unavailable");
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
    await kit.view.open(member, "f1", "view", SESSION);
    expect(kit.repo.caseRows[0]?.state).toBe("Confirmed");
  });

  it("hands out no body after a member's open that failed part way, although the receipt was written", async () => {
    const original = kit.repo.audit.append;
    kit.repo.audit.append = async (entry) => {
      if (entry.action === "file.receive") {
        throw new Error("audit unavailable");
      }
      await original(entry);
    };
    await expect(kit.view.open(member, "f1", "view", SESSION)).rejects.toThrow("audit unavailable");
    expect(kit.repo.receiptRows).toHaveLength(1);
    await expect(kit.view.download(member, "f1", SESSION, null)).rejects.toThrow(NOT_OPENED);
    expect(kit.repo.auditRows).toEqual([]);
  });

  it("hands out no body after a staff open that failed part way, although the submission was acknowledged", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f4", direction: "Inbound", state: "Submitted", sha256: "d".repeat(64) }));
    await kit.store.put("files/f4", new Uint8Array([9]));
    const original = kit.repo.audit.append;
    kit.repo.audit.append = async (entry) => {
      if (entry.action === "file.acknowledge") {
        throw new Error("audit unavailable");
      }
      await original(entry);
    };
    await expect(kit.view.open(staff, "f4", "view", SESSION)).rejects.toThrow("audit unavailable");
    expect(kit.repo.fileRows[3]?.state).toBe("Acknowledged");
    await expect(kit.view.download(staff, "f4", SESSION, null)).rejects.toThrow(NOT_OPENED);
    expect(kit.repo.auditRows).toEqual([]);
  });

  it("audits a denial with a well-formed target only", async () => {
    await expect(kit.view.open(member, "x".repeat(300), "view", SESSION)).rejects.toThrow("not_found: file");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ targetId: "invalid", result: "denied" });
  });

  it("refuses members whose membership is not active", async () => {
    const pending = { ...member, memberships: [{ clientId: "c1", status: "Pending" as const, clientStatus: "Active" as const }] };
    await expect(kit.view.open(pending, "f1", "view", SESSION)).rejects.toThrow("not_found: file");
  });

  it("lets staff open files in any state", async () => {
    const staged = await kit.view.open(staff, "f3", "view", SESSION);
    expect(staged.file.id).toBe("f3");
    expect((await kit.view.open(staff, "f2", "view", SESSION)).file.id).toBe("f2");
    expect((await kit.view.download(staff, "f3", SESSION, staged.ticket)).file.id).toBe("f3");
  });

  it("reports a missing body as a failure, not as not found", async () => {
    await kit.store.delete("files/f1");
    await expect(kit.view.open(member, "f1", "view", SESSION)).rejects.toThrow("invalid_state: body_missing");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ result: "failed" });
    expect(kit.repo.receiptRows).toEqual([]);
  });

  it("audits the failure when the body is gone by the time an opened file is downloaded", async () => {
    const { ticket } = await kit.view.open(staff, "f3", "download", SESSION);
    await kit.store.delete("files/f3");
    const before = kit.repo.auditRows.length;
    await expect(kit.view.download(staff, "f3", SESSION, ticket)).rejects.toThrow("invalid_state: body_missing");
    expect(kit.repo.auditRows.slice(before)).toEqual([
      expect.objectContaining({ action: "file.download", targetId: "f3", result: "failed", actorUserId: staff.userId }),
    ]);
  });

  it("acknowledges a submission on the first staff open only", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f4", direction: "Inbound", state: "Submitted", sha256: "d".repeat(64) }));
    await kit.store.put("files/f4", new Uint8Array([9]));
    const own = await kit.view.open(member, "f4", "view", SESSION);
    expect((await kit.view.download(member, "f4", SESSION, own.ticket)).body.sizeBytes).toBe(1);
    await expect(kit.view.download(staff, "f4", OTHER_SESSION, null)).rejects.toThrow(NOT_OPENED);
    expect(kit.repo.fileRows[3]?.state).toBe("Submitted");
    const opened = await kit.view.open(staff, "f4", "view", OTHER_SESSION);
    expect(opened.file).toMatchObject({ state: "Acknowledged", version: 2 });
    expect(opened.file.acknowledgedAt).toEqual(kit.clock.now());
    expect((await kit.view.download(staff, "f4", OTHER_SESSION, opened.ticket)).file.state).toBe("Acknowledged");
    await kit.view.open(staffActor("Staff", "u-other"), "f4", "view", "session-secret-three");
    expect(kit.repo.fileRows[3]?.version).toBe(2);
    expect(kit.repo.receiptRows).toEqual([]);
  });
});
