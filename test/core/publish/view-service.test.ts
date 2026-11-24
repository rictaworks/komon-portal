import { beforeEach, describe, expect, it } from "vitest";
import { caseRecord, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();
const member = memberActor(["c1"], "u-member");

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

describe("ViewService.open", () => {
  let kit: IntakeKit;

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

  it("returns the body with a generated download name", async () => {
    const opened = await kit.view.open(member, "f1", "download");
    expect(opened.downloadName).toBe("C0031_SHAHO_20261124_01.jpg");
    expect(opened.body.sizeBytes).toBe(3);
    expect(await readAll(opened.body.body)).toEqual([1, 2, 3]);
  });

  it("records the first open of each member once and confirms the case", async () => {
    await kit.view.open(member, "f1", "view");
    await kit.view.open(member, "f1", "download");
    await kit.view.open(memberActor(["c1"], "u-second"), "f1", "view");
    expect(kit.repo.receiptRows.map((row) => [row.fileId, row.userId])).toEqual([["f1", "u-member"], ["f1", "u-second"]]);
    expect(kit.repo.receiptRows[0]?.firstViewedAt).toEqual(kit.clock.now());
    expect(kit.repo.caseRows[0]?.state).toBe("Confirmed");
    expect(kit.repo.metricRows.filter((row) => row.name === "file.first_viewed")).toHaveLength(2);
    expect(kit.repo.metricRows.find((row) => row.name === "file.first_viewed")?.attributes.secondsSincePublished).toBe(3600);
  });

  it("does not count a staff view as a receipt", async () => {
    await kit.view.open(staff, "f1", "view");
    expect(kit.repo.receiptRows).toEqual([]);
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
  });

  it("audits every view and download", async () => {
    await kit.view.open(member, "f1", "view");
    await kit.view.open(member, "f1", "download");
    expect(kit.repo.auditRows.map((row) => [row.action, row.result])).toEqual([
      ["file.receive", "ok"], ["file.view", "ok"], ["file.download", "ok"],
    ]);
  });

  it.each([
    ["another client's file", "f2"],
    ["a file that is not published", "f3"],
    ["an unknown file", "missing"],
  ])("answers not found for %s and audits the denial", async (_name, fileId) => {
    await expect(kit.view.open(member, fileId, "view")).rejects.toThrow("not_found: file");
    expect(kit.repo.auditRows).toEqual([expect.objectContaining({ action: "file.view", targetId: fileId, result: "denied", actorUserId: "u-member" })]);
    expect(kit.repo.receiptRows).toEqual([]);
  });

  it("refuses a withdrawn file even to a member who opened it before", async () => {
    await kit.view.open(member, "f1", "view");
    await kit.publish.withdraw(staff, "f1", { reason: "WrongFile", next: "NeedsReview" }, 1);
    await expect(kit.view.open(member, "f1", "download")).rejects.toThrow("not_found: file");
  });

  it("refuses members whose membership is not active", async () => {
    const pending = { ...member, memberships: [{ clientId: "c1", status: "Pending" as const, clientStatus: "Active" as const }] };
    await expect(kit.view.open(pending, "f1", "view")).rejects.toThrow("not_found: file");
  });

  it("lets staff open files in any state", async () => {
    expect((await kit.view.open(staff, "f3", "view")).file.id).toBe("f3");
    expect((await kit.view.open(staff, "f2", "view")).file.id).toBe("f2");
  });

  it("reports a missing body as a failure, not as not found", async () => {
    await kit.store.delete("files/f1");
    await expect(kit.view.open(member, "f1", "view")).rejects.toThrow("invalid_state: body_missing");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ result: "failed" });
    expect(kit.repo.receiptRows).toEqual([]);
  });

  it("acknowledges a submission on the first staff open only", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f4", direction: "Inbound", state: "Submitted", sha256: "d".repeat(64) }));
    await kit.store.put("files/f4", new Uint8Array([9]));
    await kit.view.open(member, "f4", "view");
    expect(kit.repo.fileRows[3]?.state).toBe("Submitted");
    const opened = await kit.view.open(staff, "f4", "view");
    expect(opened.file).toMatchObject({ state: "Acknowledged", version: 2 });
    expect(opened.file.acknowledgedAt).toEqual(kit.clock.now());
    await kit.view.open(staffActor("Staff", "u-other"), "f4", "view");
    expect(kit.repo.fileRows[3]?.version).toBe(2);
    expect(kit.repo.receiptRows).toEqual([]);
  });
});
