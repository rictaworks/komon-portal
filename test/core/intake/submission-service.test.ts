import { beforeEach, describe, expect, it } from "vitest";
import { systemActor } from "../../../src/core/model/actor";
import { caseRecord, caseType, docType, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";
import { PDF, PNG, text } from "./fixtures";

const staff = staffActor();
const member = memberActor(["c1"], "u-member");
const input = { clientId: "c1", docTypeId: "d3", targetMonth: "2026-11" };

function pdf(marker: string): Uint8Array {
  return new Uint8Array([...PDF, ...text(marker)]);
}

describe("SubmissionService.submit", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.caseTypeRows.push(caseType({ id: "t3", kind: "Payroll", label: "Bonus payroll" }));
  });

  it("stores the file for the submitter's client as Submitted", async () => {
    const result = await kit.submissions.submit(member, input, { fileName: "payroll Taro.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file).toMatchObject({
      direction: "Inbound", state: "Submitted", clientId: "c1", docTypeId: "d3", targetMonth: "2026-11", caseId: null,
      displayName: "C0031_KYUYO_20261124_01",
    });
    expect(kit.store.objects.size).toBe(1);
    expect(JSON.stringify([kit.repo.fileRows, kit.repo.auditRows, kit.repo.metricRows])).not.toContain("Taro");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ action: "file.submit", actorUserId: "u-member", result: "ok" });
  });

  it("is visible to every member of that client and to staff, and to nobody else", async () => {
    const result = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("a") });
    if (result.outcome !== "stored") throw new Error("setup");
    await expect(kit.view.open(memberActor(["c1"], "u-colleague"), result.file.id, "view", "session-secret")).resolves.toBeDefined();
    await expect(kit.view.open(staff, result.file.id, "view", "session-secret")).resolves.toBeDefined();
    await expect(kit.view.open(memberActor(["c2"], "u-outsider"), result.file.id, "view", "session-secret")).rejects.toThrow("not_found: file");
  });

  it("cannot be sent to another client, and the refusal looks like a missing client", async () => {
    for (const clientId of ["c2", "missing"]) {
      await expect(kit.submissions.submit(member, { ...input, clientId }, { fileName: "a.pdf", bytes: pdf("a") })).rejects.toThrow("not_found: client");
    }
    expect(kit.repo.fileRows).toEqual([]);
    expect(kit.repo.auditRows.map((row) => row.result)).toEqual(["denied", "denied"]);
  });

  it("is refused for archived clients, pending members and staff", async () => {
    const archived = { ...memberActor(["c3"]), memberships: [{ clientId: "c3", status: "Active" as const, clientStatus: "Archived" as const }] };
    await expect(kit.submissions.submit(archived, { ...input, clientId: "c3" }, { fileName: "a.pdf", bytes: pdf("a") })).rejects.toThrow("not_found: client");
    const pending = { ...member, memberships: [{ clientId: "c1", status: "Pending" as const, clientStatus: "Active" as const }] };
    await expect(kit.submissions.submit(pending, input, { fileName: "a.pdf", bytes: pdf("a") })).rejects.toThrow("not_found: client");
    await expect(kit.submissions.submit(staff, input, { fileName: "a.pdf", bytes: pdf("a") })).rejects.toThrow("not_found: client");
  });

  it("validates format and size like office intake", async () => {
    expect(await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: new Uint8Array(0) })).toEqual({ outcome: "rejected", reason: "Empty" });
    expect(await kit.submissions.submit(member, input, { fileName: "a.exe", bytes: PDF })).toEqual({ outcome: "rejected", reason: "UnsupportedFormat" });
    expect(await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: PNG })).toEqual({ outcome: "rejected", reason: "ContentMismatch" });
    expect(kit.store.objects.size).toBe(0);
  });

  it.each([
    [{ targetMonth: "2026-13" }, "invalid_input: target_month"],
    [{ docTypeId: "missing" }, "invalid_input: doc_type"],
    [{ docTypeId: "d1" }, "invalid_input: doc_type"],
  ])("rejects %j", async (override, message) => {
    await expect(kit.submissions.submit(member, { ...input, ...override }, { fileName: "a.pdf", bytes: pdf("a") })).rejects.toThrow(message);
  });

  it("does not store the same content twice and points to the earlier submission", async () => {
    const first = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("same") });
    const again = await kit.submissions.submit(member, input, { fileName: "b.pdf", bytes: pdf("same") });
    expect(again).toEqual({ outcome: "duplicate", existingFileId: first.outcome === "stored" ? first.file.id : "" });
    expect(kit.repo.fileRows).toHaveLength(1);
  });

  it("does not reveal an unpublished office document with the same content", async () => {
    const office = await kit.intake.accept(staff, (await kit.intake.openBatch(staff, "c1")).id, { fileName: "x.pdf", bytes: pdf("same") });
    expect(office.outcome).toBe("stored");
    expect(await kit.submissions.submit(member, input, { fileName: "b.pdf", bytes: pdf("same") })).toEqual({ outcome: "duplicate", existingFileId: null });
  });

  it("links the only open case of that month whose case type is the document type's, and moves it to MaterialsReceived", async () => {
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", caseTypeId: "t2" }));
    const result = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBe("k1");
    expect(kit.repo.caseRows[0]?.state).toBe("MaterialsReceived");
    expect(kit.repo.metricRows.find((row) => row.name === "submission.received")).toMatchObject({ attributes: { linked: true } });
  });

  it.each([
    ["no case exists", []],
    ["two cases of that case type exist", [caseRecord({ id: "k1", caseTypeId: "t2" }), caseRecord({ id: "k2", caseTypeId: "t2", sequence: 2 })]],
    ["the only case is for another month", [caseRecord({ id: "k1", caseTypeId: "t2", targetMonth: "2026-10" })]],
    ["the only case of that month is of another case type", [caseRecord({ id: "k1", caseTypeId: "t1" })]],
    ["the only case of that month is of another case type of the same kind", [caseRecord({ id: "k1", caseTypeId: "t3" })]],
    ["the only case is closed", [caseRecord({ id: "k1", caseTypeId: "t2", state: "Closed" })]],
    ["the only case belongs to another client", [caseRecord({ id: "k1", caseTypeId: "t2", clientId: "c2" })]],
  ])("leaves the case to staff when %s", async (_name, cases) => {
    kit.repo.caseRows.push(...cases);
    const result = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBeNull();
    expect(kit.repo.caseRows.every((row) => row.state !== "MaterialsReceived")).toBe(true);
    expect(kit.repo.metricRows.at(-1)).toMatchObject({ name: "submission.received", attributes: { linked: false } });
  });

  it("links the case of the document type's case type when the month also has a case of another type", async () => {
    kit.repo.caseRows.push(caseRecord({ id: "k1", caseTypeId: "t3" }), caseRecord({ id: "k2", caseTypeId: "t2" }), caseRecord({ id: "k3", caseTypeId: "t1" }));
    const result = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBe("k2");
    expect(kit.repo.caseRows.map((row) => row.state)).toEqual(["Open", "MaterialsReceived", "Open"]);
  });

  it("never links a document type that has no case type, even when the month has a single open case", async () => {
    kit.repo.docTypeRows.push(docType({ id: "d4", shortCode: "KINTAI", label: "Payroll attendance", direction: "Inbound", caseTypeId: null }));
    kit.repo.caseRows.push(caseRecord({ id: "k1", caseTypeId: "t2" }));
    const result = await kit.submissions.submit(member, { ...input, docTypeId: "d4" }, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBeNull();
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
  });

  it("decides by the linked case type and not by the names", async () => {
    // The names contain each other, but the document type is linked to the other case type.
    kit.repo.caseTypeRows.push(caseType({ id: "t4", kind: "Payroll", label: "Tax" }), caseType({ id: "t5", kind: "Payroll", label: "Expenses" }));
    kit.repo.docTypeRows.push(docType({ id: "d5", shortCode: "TAXI", label: "Taxi receipts", direction: "Inbound", caseTypeId: "t5" }));
    kit.repo.caseRows.push(caseRecord({ id: "k1", caseTypeId: "t4" }), caseRecord({ id: "k2", caseTypeId: "t5" }));
    const result = await kit.submissions.submit(member, { ...input, docTypeId: "d5" }, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBe("k2");
  });

  it.each(["Procedure", "Other"] as const)("links only to a monthly case: a document type that names a %s case type is left to staff", async (kind) => {
    kit.repo.caseTypeRows.push(caseType({ id: "t6", kind, label: "Not monthly" }));
    kit.repo.docTypeRows.push(docType({ id: "d6", shortCode: "ETC", label: "Other material", direction: "Inbound", caseTypeId: "t6" }));
    kit.repo.caseRows.push(caseRecord({ id: "k1", caseTypeId: "t6" }));
    const result = await kit.submissions.submit(member, { ...input, docTypeId: "d6" }, { fileName: "a.pdf", bytes: pdf("a") });
    expect(result.outcome === "stored" && result.file.caseId).toBeNull();
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
    expect(kit.repo.metricRows.at(-1)).toMatchObject({ name: "submission.received", attributes: { linked: false } });
  });
});

describe("SubmissionService.cancel and linkCase", () => {
  let kit: IntakeKit;
  let fileId: string;

  beforeEach(async () => {
    kit = intakeKit();
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", caseTypeId: "t2" }), caseRecord({ id: "k9", clientId: "c2", caseTypeId: "t2" }));
    const result = await kit.submissions.submit(member, input, { fileName: "a.pdf", bytes: pdf("a") });
    if (result.outcome !== "stored") throw new Error("setup");
    fileId = result.file.id;
  });

  it("lets the submitter cancel before the office opens it", async () => {
    const cancelled = await kit.submissions.cancel(member, fileId, 1);
    expect(cancelled).toMatchObject({ state: "Trashed", trashedFrom: "Submitted" });
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
  });

  it("refuses a colleague, and refuses everyone once the office has opened it", async () => {
    await expect(kit.submissions.cancel(memberActor(["c1"], "u-colleague"), fileId, 1)).rejects.toThrow("invalid_state: not_cancellable");
    await kit.view.open(staff, fileId, "view", "session-secret");
    await expect(kit.submissions.cancel(member, fileId, 2)).rejects.toThrow("invalid_state: not_cancellable");
    await expect(kit.submissions.cancel(member, "x".repeat(300), 1)).rejects.toThrow("not_found: file");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ targetId: "invalid", result: "denied" });
  });

  it("answers not found to members of other clients", async () => {
    await expect(kit.submissions.cancel(memberActor(["c2"], "u-outsider"), fileId, 1)).rejects.toThrow("not_found: file");
    await expect(kit.submissions.cancel(member, "missing", 1)).rejects.toThrow("not_found: file");
  });

  it("refuses a version other than the current one, so an acknowledged submission cannot be cancelled", async () => {
    await expect(kit.submissions.cancel(member, fileId, 2)).rejects.toThrow("conflict: stale");
    await expect(kit.submissions.linkCase(staff, fileId, null, 5)).rejects.toThrow("conflict: stale");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "Submitted", version: 1 });
  });

  it("removes the body again when the record cannot be written", async () => {
    kit.repo.files.insert = async () => {
      throw new Error("database unavailable");
    };
    const before = kit.store.objects.size;
    await expect(kit.submissions.submit(member, input, { fileName: "b.pdf", bytes: pdf("b") })).rejects.toThrow("database unavailable");
    expect(kit.store.objects.size).toBe(before);
  });

  it("lets staff link and unlink a case of the same client", async () => {
    const unlinked = await kit.submissions.linkCase(staff, fileId, null, 1);
    expect(unlinked.caseId).toBeNull();
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
    const linked = await kit.submissions.linkCase(staff, fileId, "k1", 2);
    expect(linked.caseId).toBe("k1");
    expect(kit.repo.caseRows[0]?.state).toBe("MaterialsReceived");
    await expect(kit.submissions.linkCase(staff, fileId, "k9", 3)).rejects.toThrow("invalid_input: case");
    await expect(kit.submissions.linkCase(member, fileId, null, 3)).rejects.toThrow("forbidden");
  });
});

describe("TrashService", () => {
  let kit: IntakeKit;

  beforeEach(async () => {
    kit = intakeKit();
    kit.repo.fileRows.push(
      fileRecord({ id: "f1", state: "Trashed", trashedFrom: "Staged", trashedAt: kit.clock.now() }),
      fileRecord({ id: "f2", direction: "Inbound", state: "Trashed", trashedFrom: "Acknowledged", acknowledgedAt: kit.clock.now(), trashedAt: kit.clock.now(), sha256: "b".repeat(64) }),
    );
    kit.repo.receiptRows.push({ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: kit.clock.now() });
    await kit.store.put("files/f1", new Uint8Array([1]));
    await kit.store.put("files/f2", new Uint8Array([2]));
  });

  it("restores an office document to review and a submission to its earlier state", async () => {
    expect(await kit.trash.restore(staff, "f1", 1)).toMatchObject({ state: "NeedsReview", reviewReason: "Restored", trashedAt: null, trashedFrom: null });
    expect(await kit.trash.restore(staff, "f2", 1)).toMatchObject({ state: "Acknowledged", trashedAt: null, trashedFrom: null });
  });

  it("restores until the 30th day and not after", async () => {
    kit.clock.current = new Date(kit.clock.current.getTime() + 30 * 24 * 60 * 60 * 1000 - 1);
    await expect(kit.trash.restore(staff, "f1", 1)).resolves.toMatchObject({ state: "NeedsReview" });
    kit.clock.current = new Date(kit.clock.current.getTime() + 1);
    await expect(kit.trash.restore(staff, "f2", 1)).rejects.toThrow("invalid_state: trash_expired");
  });

  it("refuses files that are not trashed, a stale version and client members", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f3", state: "Staged", sha256: "c".repeat(64) }));
    await expect(kit.trash.restore(staff, "f3", 1)).rejects.toThrow("invalid_state: not_trashed");
    await expect(kit.trash.restore(staff, "f1", 9)).rejects.toThrow("conflict: stale");
    await expect(kit.trash.restore(memberActor(), "f1", 1)).rejects.toThrow("forbidden");
  });

  it("refuses to restore when the client now holds the same content", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f3", state: "Staged" }));
    await expect(kit.trash.restore(staff, "f1", 1)).rejects.toThrow("conflict: duplicate_content");
  });

  it("erases body, record and receipts after 30 days and audits each erasure as the system", async () => {
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 0 });
    kit.clock.advanceDays(30);
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 2, skipped: 0, failed: 0 });
    expect(kit.repo.fileRows).toEqual([]);
    expect(kit.repo.receiptRows).toEqual([]);
    expect(kit.store.objects.size).toBe(0);
    const entries = kit.repo.auditRows.filter((row) => row.action === "file.purge");
    expect(entries.map((row) => [row.targetId, row.actorUserId, row.result])).toEqual([["f1", null, "ok"], ["f2", null, "ok"]]);
    expect(entries[0]?.occurredAt).toEqual(kit.clock.now());
  });

  it("continues with the remaining files when one erasure fails", async () => {
    kit.clock.advanceDays(31);
    const original = kit.repo.files.beginPurge;
    kit.repo.files.beginPurge = async (id, before, at) => {
      if (id === "f1") {
        throw new Error("database unavailable");
      }
      return original(id, before, at);
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 1 });
    expect(kit.repo.fileRows.map((row) => row.id)).toEqual(["f1"]);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.purge").map((row) => [row.targetId, row.result])).toEqual([["f1", "failed"], ["f2", "ok"]]);
  });

  it("never erases a file that was restored after the job listed it", async () => {
    kit.clock.advanceDays(31);
    const original = kit.repo.files.listTrashedBefore;
    kit.repo.files.listTrashedBefore = async (threshold, page) => {
      const listed = await original(threshold, page);
      const row = kit.repo.fileRows.find((candidate) => candidate.id === "f1" && candidate.state === "Trashed");
      if (row !== undefined) {
        // Staff restore f1 right after the listing was read.
        Object.assign(row, { state: "NeedsReview", reviewReason: "Restored", trashedAt: null, trashedFrom: null, version: 2 });
      }
      return listed;
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 1, failed: 0 });
    expect(kit.repo.fileRows.map((row) => [row.id, row.state])).toEqual([["f1", "NeedsReview"]]);
    expect(kit.store.objects.has("files/f1")).toBe(true);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.purge").map((row) => row.targetId)).toEqual(["f2"]);
  });

  it("reaches every due file even when more than a page of them keeps failing", async () => {
    kit.repo.fileRows = [];
    for (let index = 0; index < 130; index += 1) {
      const id = `p${String(index).padStart(3, "0")}`;
      kit.repo.fileRows.push(fileRecord({
        id, sha256: String(index).padStart(64, "0"), displayName: `N_${id}`, state: "Trashed", trashedFrom: "Staged",
        trashedAt: new Date(kit.clock.now().getTime() + index),
      }));
    }
    kit.clock.advanceDays(31);
    const original = kit.repo.files.beginPurge;
    kit.repo.files.beginPurge = async (id, before, at) => {
      if (Number(id.slice(1)) < 110) {
        throw new Error("database unavailable");
      }
      return original(id, before, at);
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 20, skipped: 0, failed: 110 });
    expect(kit.repo.fileRows).toHaveLength(110);
  });

  it("does not skip due files when the content of a few erased files cannot be removed", async () => {
    kit.repo.fileRows = [];
    for (let index = 0; index < 130; index += 1) {
      const id = `q${String(index).padStart(3, "0")}`;
      kit.repo.fileRows.push(fileRecord({
        id, sha256: String(index + 300).padStart(64, "0"), displayName: `N_${id}`, state: "Trashed", trashedFrom: "Staged",
        trashedAt: new Date(kit.clock.now().getTime() + index),
      }));
    }
    kit.clock.advanceDays(31);
    const original = kit.store.delete.bind(kit.store);
    let calls = 0;
    kit.store.delete = async (key: string) => {
      calls += 1;
      if (calls <= 3) {
        throw new Error("object store unavailable");
      }
      return original(key);
    };
    // Three bodies could not be removed; their records wait, out of the due listing, so every due file is reached in this run.
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 127, skipped: 0, failed: 3 });
    expect(kit.repo.fileRows.map((row) => row.id)).toEqual(["q000", "q001", "q002"]);
    expect(calls).toBe(130);
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 3, skipped: 0, failed: 0 });
    expect(kit.repo.fileRows).toHaveLength(0);
    expect(calls).toBe(133);
  });

  it("keeps the record of a file whose body cannot be removed and erases both on the next run", async () => {
    kit.clock.advanceDays(31);
    const original = kit.store.delete.bind(kit.store);
    kit.store.delete = async (key: string) => {
      if (key === "files/f1") {
        throw new Error("object store unavailable");
      }
      return original(key);
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 1 });
    expect(kit.repo.fileRows.map((row) => row.id)).toEqual(["f1"]);
    expect(kit.store.objects.has("files/f1")).toBe(true);
    const purges = (): [string, string][] => kit.repo.auditRows.filter((row) => row.action === "file.purge").map((row) => [row.targetId, row.result]);
    expect(purges()).toEqual([["f1", "failed"], ["f2", "ok"]]);
    expect(kit.repo.metricRows.filter((row) => row.name === "purge.failed").map((row) => row.attributes.fileId)).toEqual(["f1"]);

    // Still failing on the next run: the same record is found and tried again.
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 1 });
    expect(kit.repo.fileRows.map((row) => row.id)).toEqual(["f1"]);

    kit.store.delete = original;
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 0 });
    expect(kit.repo.fileRows).toEqual([]);
    expect(kit.store.objects.size).toBe(0);
    expect(purges().filter(([id, result]) => id === "f1" && result === "ok")).toHaveLength(1);
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 0 });
    expect(purges().filter(([id, result]) => id === "f1" && result === "ok")).toHaveLength(1);
  });

  it("retries a file whose record could not be erased after its body was removed", async () => {
    kit.clock.advanceDays(31);
    const original = kit.repo.files.completePurge;
    kit.repo.files.completePurge = async (id, audit) => {
      if (id === "f1") {
        throw new Error("database unavailable");
      }
      return original(id, audit);
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 1 });
    expect(kit.repo.fileRows.map((row) => row.id)).toEqual(["f1"]);
    expect(kit.store.objects.size).toBe(0);
    kit.repo.files.completePurge = original;
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 1, skipped: 0, failed: 0 });
    expect(kit.repo.fileRows).toEqual([]);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.purge" && row.targetId === "f1").map((row) => row.result)).toEqual(["failed", "ok"]);
  });

  it("reaches every file being purged even when more than a page of them keeps failing", async () => {
    kit.repo.fileRows = [];
    for (let index = 0; index < 130; index += 1) {
      const id = `r${String(index).padStart(3, "0")}`;
      kit.repo.fileRows.push(fileRecord({
        id, r2Key: `files/${id}`, sha256: String(index + 600).padStart(64, "0"), displayName: `N_${id}`, state: "Trashed", trashedFrom: "Staged",
        trashedAt: new Date(kit.clock.now().getTime() + index),
      }));
    }
    kit.clock.advanceDays(31);
    const original = kit.store.delete.bind(kit.store);
    kit.store.delete = async () => {
      throw new Error("object store unavailable");
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 130 });
    kit.store.delete = async (key: string) => {
      if (Number(key.slice(-3)) < 110) {
        throw new Error("object store unavailable");
      }
      return original(key);
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 20, skipped: 0, failed: 110 });
    expect(kit.repo.fileRows).toHaveLength(110);
  });

  it("hides a file being purged: it is not listed, counted, opened or restored", async () => {
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1" }));
    const linked = kit.repo.fileRows.find((row) => row.id === "f1");
    if (linked === undefined) throw new Error("setup");
    linked.caseId = "k1";
    kit.clock.advanceDays(31);
    kit.store.delete = async () => {
      throw new Error("object store unavailable");
    };
    expect(await kit.repo.files.count({ states: ["Trashed"] })).toBe(2);
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 2 });
    expect(await kit.repo.files.findById("f1")).toBeNull();
    expect(await kit.repo.files.list({}, { limit: 100, offset: 0 })).toEqual([]);
    expect(await kit.repo.files.count({})).toBe(0);
    expect(await kit.repo.files.count({ states: ["Trashed"] })).toBe(0);
    expect(await kit.repo.files.summarizeForCase("k1")).toEqual({ outbound: 0, published: 0, publishedAndOpened: 0, inbound: 0 });
    expect(await kit.repo.files.listTrashedBefore(kit.trash.purgeThreshold(), { limit: 100, offset: 0 })).toEqual([]);
    expect(await kit.repo.receipts.listByFile("f1")).toEqual([]);
    await expect(kit.trash.restore(staff, "f1", 1)).rejects.toThrow("not_found: file");
    await expect(kit.view.open(staff, "f1", "view", "session-secret")).rejects.toThrow("not_found: file");
    await expect(kit.view.open(staff, "f2", "download", "session-secret")).rejects.toThrow("not_found: file");
  });

  it("refuses a restore that read the file before the purge began", async () => {
    kit.clock.advanceDays(31);
    const before = kit.repo.fileRows.find((row) => row.id === "f1");
    if (before === undefined) throw new Error("setup");
    const stale = { ...before, state: "NeedsReview" as const, reviewReason: "Restored" as const, trashedAt: null, trashedFrom: null, version: 2 };
    expect(await kit.repo.files.beginPurge("f1", kit.trash.purgeThreshold(), kit.clock.now())).toBe(true);
    expect(await kit.repo.files.update(stale, 1)).toBe("stale");
    expect(kit.repo.fileRows.find((row) => row.id === "f1")?.state).toBe("Trashed");
  });

  it("finishes the job even when a failure cannot be recorded", async () => {
    kit.clock.advanceDays(31);
    kit.repo.files.beginPurge = async () => {
      throw new Error("database unavailable");
    };
    kit.repo.audit.append = async () => {
      throw new Error("audit unavailable");
    };
    expect(await kit.trash.purgeExpired(systemActor())).toEqual({ purged: 0, skipped: 0, failed: 2 });
  });

  it("can only be run by the system", async () => {
    await expect(kit.trash.purgeExpired(staffActor("Owner"))).rejects.toThrow("forbidden: maintenance.run");
  });
});
