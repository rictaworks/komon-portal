import { beforeEach, describe, expect, it } from "vitest";
import { caseRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";
import { PDF, PNG, text } from "./fixtures";

const A1 = "202611240912345678";
const staff = staffActor();

function pdf(marker: string): Uint8Array {
  return new Uint8Array([...PDF, ...text(marker)]);
}

describe("IntakeService", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", submittedOn: "2026-11-20", state: "Submitted" }));
    kit.repo.arrivalRows.push({ id: "a1", caseId: "k1", arrivalNumber: A1 });
  });

  async function accept(fileName: string, bytes: Uint8Array, hint: string | null = null) {
    const batch = await kit.intake.openBatch(staff, hint);
    return kit.intake.accept(staff, batch.id, { fileName, bytes });
  }

  it("stages a file whose client is decided and stores the body under a generated key", async () => {
    const result = await accept("C0142_koyou_Taro Yamada.pdf", pdf("one"));
    expect(result.outcome).toBe("stored");
    if (result.outcome !== "stored") return;
    expect(result.file).toMatchObject({
      state: "Staged", clientId: "c2", caseId: null, docTypeId: "d2", typeSource: "Rule", resolutionMethod: "ClientCode",
      reviewReason: null, reviewDetail: null, displayName: "C0142_KOYOU_20261124_01", format: "pdf", sizeBytes: 12, version: 1,
    });
    expect(result.file.r2Key).toBe(`files/${result.file.id}`);
    expect([...kit.store.objects.keys()]).toEqual([result.file.r2Key]);
    expect(result.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never persists the original file name", async () => {
    await accept("C0142_koyou_Taro Yamada.pdf", pdf("one"));
    const persisted = JSON.stringify([kit.repo.fileRows, kit.repo.batchRows, kit.repo.auditRows, kit.repo.metricRows, [...kit.store.objects.keys()]]);
    expect(persisted).not.toContain("Yamada");
    expect(persisted).not.toContain("Taro");
  });

  it("links the case by arrival number and advances the case", async () => {
    const result = await accept(`${A1}.pdf`, pdf("two"));
    expect(result.outcome === "stored" && result.file).toMatchObject({ state: "Staged", clientId: "c1", caseId: "k1", resolutionMethod: "ArrivalNumber" });
    expect(kit.repo.caseRows[0]?.state).toBe("DocumentReceived");
  });

  it("sends an undecided file to review with a reason and the evidence", async () => {
    const result = await accept(`C0142_${A1}.pdf`, pdf("three"));
    expect(result.outcome === "stored" && result.file).toMatchObject({
      state: "NeedsReview", clientId: null, caseId: null, resolutionMethod: null, reviewReason: "ConflictingKeys",
      reviewDetail: [{ kind: "ArrivalNumber", clientId: "c1" }, { kind: "ClientCode", clientId: "c2" }],
      displayName: "UNASSIGNED_UNCLASSIFIED_20261124_01",
    });
    expect(kit.repo.caseRows[0]?.state).toBe("Submitted");
  });

  it("uses the destination chosen at intake and keeps an unregistered arrival number", async () => {
    const result = await accept("202601010000000000.pdf", pdf("four"), "c2");
    expect(result.outcome === "stored" && result.file).toMatchObject({
      state: "Staged", clientId: "c2", resolutionMethod: "StaffSelected", unmatchedArrivalNumber: "202601010000000000",
    });
  });

  it("numbers display names per client and day", async () => {
    const first = await accept("C0031_a.pdf", pdf("a"));
    const second = await accept("C0031_b.pdf", pdf("b"));
    const other = await accept("C0142_c.pdf", pdf("c"));
    const names = [first, second, other].map((result) => (result.outcome === "stored" ? result.file.displayName : ""));
    expect(names).toEqual(["C0031_UNCLASSIFIED_20261124_01", "C0031_UNCLASSIFIED_20261124_02", "C0142_UNCLASSIFIED_20261124_01"]);
  });

  it("rejects a bad file without storing it and continues with the next one", async () => {
    const batch = await kit.intake.openBatch(staff, "c1");
    const results = [
      await kit.intake.accept(staff, batch.id, { fileName: "a.pdf", bytes: new Uint8Array(0) }),
      await kit.intake.accept(staff, batch.id, { fileName: "a.exe", bytes: PDF }),
      await kit.intake.accept(staff, batch.id, { fileName: "a.pdf", bytes: PNG }),
      await kit.intake.accept(staff, batch.id, { fileName: "ok.pdf", bytes: pdf("ok") }),
    ];
    expect(results.slice(0, 3)).toEqual([
      { outcome: "rejected", reason: "Empty" },
      { outcome: "rejected", reason: "UnsupportedFormat" },
      { outcome: "rejected", reason: "ContentMismatch" },
    ]);
    expect(results[3]?.outcome).toBe("stored");
    expect(kit.repo.fileRows).toHaveLength(1);
    expect(kit.store.objects.size).toBe(1);
  });

  it("does not store content the same client already holds and points to the existing file", async () => {
    const first = await accept("C0031_a.pdf", pdf("same"));
    const again = await accept("C0031_renamed.pdf", pdf("same"));
    expect(first.outcome).toBe("stored");
    if (first.outcome !== "stored") return;
    expect(again).toEqual({ outcome: "duplicate", existingFileId: first.file.id, existingDisplayName: first.file.displayName, clientId: "c1" });
    expect(kit.repo.fileRows).toHaveLength(1);
    expect(kit.store.objects.size).toBe(1);
  });

  it("stores content held by another client but sends it to review", async () => {
    await accept("C0031_a.pdf", pdf("same"));
    const result = await accept("C0142_a.pdf", pdf("same"));
    expect(result.outcome === "stored" && result.file).toMatchObject({
      state: "NeedsReview", clientId: null, reviewReason: "DuplicateAcrossClients",
      reviewDetail: [{ kind: "ClientCode", clientId: "c2" }, { kind: "ExistingCopy", clientId: "c1" }],
    });
    expect(kit.store.objects.size).toBe(2);
  });

  it("accepts the same content again after the first copy was trashed", async () => {
    const first = await accept("C0031_a.pdf", pdf("same"));
    if (first.outcome !== "stored") throw new Error("setup");
    await kit.review.trash(staff, first.file.id, 1);
    expect((await accept("C0031_a.pdf", pdf("same"))).outcome).toBe("stored");
  });

  it("removes the body again when the record cannot be written", async () => {
    const original = kit.repo.files.insert;
    kit.repo.files.insert = async () => {
      throw new Error("database unavailable");
    };
    await expect(accept("C0031_a.pdf", pdf("a"))).rejects.toThrow("database unavailable");
    kit.repo.files.insert = original;
    expect(kit.store.objects.size).toBe(0);
    expect(kit.repo.fileRows).toEqual([]);
  });

  it("audits opening a batch, rejections and duplicates", async () => {
    const batch = await kit.intake.openBatch(staff, "c1");
    await kit.intake.accept(staff, batch.id, { fileName: "a.exe", bytes: PDF });
    const stored = await kit.intake.accept(staff, batch.id, { fileName: "a.pdf", bytes: pdf("same") });
    await kit.intake.accept(staff, batch.id, { fileName: "b.pdf", bytes: pdf("same") });
    expect(kit.repo.auditRows.map((row) => [row.action, row.targetId, row.result])).toEqual([
      ["batch.open", batch.id, "ok"],
      ["file.reject", batch.id, "failed"],
      ["file.accept", stored.outcome === "stored" ? stored.file.id : "", "ok"],
      ["file.duplicate", stored.outcome === "stored" ? stored.file.id : "", "ok"],
    ]);
  });

  it("asks for automatic publishing only for staged files", async () => {
    const staged = await accept("C0031_a.pdf", pdf("a"));
    await accept("nokey.pdf", pdf("b"));
    expect(kit.autoPublisher.asked).toEqual([staged.outcome === "stored" ? staged.file.id : ""]);
    expect(staged.outcome === "stored" && staged.published).toBe(false);
  });

  it("audits and measures with internal identifiers only", async () => {
    const result = await accept("C0031_shaho.pdf", pdf("a"));
    if (result.outcome !== "stored") throw new Error("setup");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ action: "file.accept", targetType: "file", targetId: result.file.id, actorUserId: "u-staff", result: "ok" });
    expect(kit.repo.metricRows.find((row) => row.name === "intake.accepted")).toMatchObject({
      clientId: "c1", attributes: { fileId: result.file.id, state: "Staged", method: "ClientCode", reviewReason: null, typeSource: "Rule" },
    });
  });

  it("is denied to client members", async () => {
    await expect(kit.intake.openBatch(memberActor(), null)).rejects.toThrow("forbidden");
    const batch = await kit.intake.openBatch(staff, null);
    await expect(kit.intake.accept(memberActor(), batch.id, { fileName: "a.pdf", bytes: PDF })).rejects.toThrow("forbidden");
    expect(kit.repo.fileRows).toEqual([]);
  });

  it("rejects an unknown destination, an unknown batch and another user's batch", async () => {
    await expect(kit.intake.openBatch(staff, "missing")).rejects.toThrow("not_found: client");
    await expect(kit.intake.accept(staff, "missing", { fileName: "a.pdf", bytes: PDF })).rejects.toThrow("not_found: batch");
    const batch = await kit.intake.openBatch(staff, null);
    await expect(kit.intake.accept(staffActor("Staff", "u-other"), batch.id, { fileName: "a.pdf", bytes: PDF })).rejects.toThrow("invalid_input: batch_owner");
  });
});
