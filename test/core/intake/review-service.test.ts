import { beforeEach, describe, expect, it } from "vitest";
import { caseRecord, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();

describe("ReviewService", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.caseRows.push(
      caseRecord({ id: "k1", clientId: "c1" }),
      caseRecord({ id: "k2", clientId: "c2" }),
      caseRecord({ id: "k3", clientId: "c1", sequence: 2, state: "Cancelled" }),
    );
  });

  function seed(overrides: Parameters<typeof fileRecord>[0] = {}) {
    const file = fileRecord({
      id: "f1", clientId: null, state: "NeedsReview", resolutionMethod: null, reviewReason: "NoKey",
      displayName: "UNASSIGNED_UNCLASSIFIED_20261124_01", ...overrides,
    });
    kit.repo.fileRows.push(file);
    return file;
  }

  describe("assign", () => {
    it("stages the file for the chosen client, case and type and renames it", async () => {
      seed();
      const updated = await kit.review.assign(staff, "f1", { clientId: "c1", caseId: "k1", docTypeId: "d1", confirmed: false }, 1);
      expect(updated).toMatchObject({
        state: "Staged", clientId: "c1", caseId: "k1", targetMonth: "2026-11", docTypeId: "d1", typeSource: "Staff", resolutionMethod: "StaffSelected",
        reviewReason: null, reviewDetail: null, displayName: "C0031_SHAHO_20261124_01", version: 2,
      });
      expect(kit.repo.caseRows[0]?.state).toBe("DocumentReceived");
      // The assignment, then the case change that followed from it.
      expect(kit.repo.auditRows.slice(-2).map((row) => [row.action, row.targetId, row.result])).toEqual([
        ["file.assign", "f1", "ok"],
        ["case.state_change", "k1", "ok"],
      ]);
    });

    it("keeps the current type when none is given", async () => {
      seed({ docTypeId: "d2", typeSource: "Rule" });
      const updated = await kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 1);
      expect(updated).toMatchObject({ docTypeId: "d2", typeSource: "Rule", displayName: "C0031_KOYOU_20261124_01" });
    });

    it.each(["DuplicateAcrossClients", "ConflictingKeys", "HintMismatch"] as const)("requires confirmation for %s", async (reviewReason) => {
      seed({ reviewReason, reviewDetail: [{ kind: "ClientCode", clientId: "c2" }] });
      await expect(kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 1)).rejects.toThrow("invalid_input: confirmation_required");
      expect(kit.repo.fileRows[0]?.state).toBe("NeedsReview");
      const updated = await kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: true }, 1);
      expect(updated.state).toBe("Staged");
    });

    it("requires confirmation whenever another client holds the same content, whatever the reason says", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f0", clientId: "c2", state: "Staged" }));
      seed({ reviewReason: "NoKey" });
      await expect(kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 1)).rejects.toThrow("invalid_input: confirmation_required");
      expect((await kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: true }, 1)).state).toBe("Staged");
    });

    it("still requires that confirmation after a staged file was sent back", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f0", clientId: "c2", state: "Staged" }));
      kit.repo.fileRows.push(fileRecord({ id: "f1", clientId: "c1", state: "Staged", sha256: "a".repeat(64), displayName: "C0031_UNCLASSIFIED_20261124_05" }));
      await kit.review.sendBack(staff, "f1", 1);
      await expect(kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 2)).rejects.toThrow("invalid_input: confirmation_required");
    });

    it("counts corrections of client and type", async () => {
      seed({ clientId: "c2", reviewReason: "SentBack", docTypeId: "d2", typeSource: "Rule" });
      await kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, docTypeId: "d1", confirmed: false }, 1);
      expect(kit.repo.metricRows.find((row) => row.name === "review.assigned")?.attributes).toMatchObject({ clientChanged: true, typeChanged: true, reason: "SentBack" });
    });

    it.each([
      [{ clientId: "missing", caseId: null }, "not_found: client"],
      [{ clientId: "c3", caseId: null }, "invalid_state: client_not_active"],
      [{ clientId: "c1", caseId: "k2" }, "invalid_input: case"],
      [{ clientId: "c1", caseId: "missing" }, "invalid_input: case"],
      [{ clientId: "c1", caseId: "k3" }, "invalid_state: case_terminal"],
      [{ clientId: "c1", caseId: null, docTypeId: "missing" }, "invalid_input: doc_type"],
      [{ clientId: "c1", caseId: null, docTypeId: "d3" }, "invalid_input: doc_type"],
    ])("rejects %j", async (input, message) => {
      seed();
      await expect(kit.review.assign(staff, "f1", { ...input, confirmed: true }, 1)).rejects.toThrow(message);
      expect(kit.repo.fileRows[0]).toMatchObject({ state: "NeedsReview", version: 1 });
    });

    it("refuses a stale version, content the client already holds and files that are not in review", async () => {
      seed();
      await expect(kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 5)).rejects.toThrow("conflict: stale");
      kit.repo.fileRows.push(fileRecord({ id: "f2", clientId: "c1", state: "Staged" }));
      await expect(kit.review.assign(staff, "f1", { clientId: "c1", caseId: null, confirmed: false }, 1)).rejects.toThrow("conflict: duplicate_content");
      await expect(kit.review.assign(staff, "f2", { clientId: "c1", caseId: null, confirmed: false }, 1)).rejects.toThrow("invalid_state: not_in_review");
      await expect(kit.review.assign(staff, "missing", { clientId: "c1", caseId: null, confirmed: false }, 1)).rejects.toThrow("not_found: file");
    });

    it("is denied to client members and the denial is audited", async () => {
      seed();
      await expect(kit.review.assign(memberActor(), "f1", { clientId: "c1", caseId: null, confirmed: true }, 1)).rejects.toThrow("forbidden");
      expect(kit.repo.auditRows.at(-1)).toMatchObject({ result: "denied", targetId: "f1" });
    });
  });

  describe("published files", () => {
    it("cannot have their client, case or type changed", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Published", publishedAt: new Date() }));
      await expect(kit.review.assign(staff, "f1", { clientId: "c2", caseId: null, confirmed: true }, 1)).rejects.toThrow("invalid_state: not_in_review");
      await expect(kit.review.sendBack(staff, "f1", 1)).rejects.toThrow("invalid_state: not_staged");
      expect(kit.repo.fileRows[0]).toMatchObject({ clientId: "c1", state: "Published", version: 1 });
    });
  });

  describe("setDocType", () => {
    it("changes the type of a staged file and renames it", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Staged", docTypeId: "d1", typeSource: "Rule" }));
      const updated = await kit.review.setDocType(staff, "f1", "d2", 1);
      expect(updated).toMatchObject({ docTypeId: "d2", typeSource: "Staff", displayName: "C0031_KOYOU_20261124_01" });
      const cleared = await kit.review.setDocType(staff, "f1", null, 2);
      expect(cleared).toMatchObject({ docTypeId: null, typeSource: null });
    });

    it("refuses published files", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Published", publishedAt: new Date() }));
      await expect(kit.review.setDocType(staff, "f1", "d2", 1)).rejects.toThrow("invalid_state: not_editable");
    });
  });

  describe("sendBack", () => {
    it("returns a staged file to review", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Staged" }));
      expect(await kit.review.sendBack(staff, "f1", 1)).toMatchObject({ state: "NeedsReview", reviewReason: "SentBack", clientId: "c1", resolutionMethod: null, version: 2 });
      expect(kit.repo.metricRows.at(-1)).toMatchObject({ name: "review.sent_back" });
    });

    it("applies only to staged files", async () => {
      seed();
      await expect(kit.review.sendBack(staff, "f1", 1)).rejects.toThrow("invalid_state: not_staged");
    });
  });

  describe("trash", () => {
    it.each(["NeedsReview", "Staged", "Withdrawn"] as const)("trashes a %s file and remembers where it came from", async (state) => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state, reviewReason: state === "NeedsReview" ? "NoKey" : null, withdrawReason: state === "Withdrawn" ? "Other" : null }));
      const updated = await kit.review.trash(staff, "f1", 1);
      expect(updated).toMatchObject({ state: "Trashed", trashedFrom: state, version: 2 });
      expect(updated.trashedAt).toEqual(kit.clock.now());
    });

    it("refuses to act on a version other than the one given", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Staged", version: 3 }));
      await expect(kit.review.trash(staff, "f1", 2)).rejects.toThrow("conflict: stale");
      await expect(kit.review.sendBack(staff, "f1", 4)).rejects.toThrow("conflict: stale");
      await expect(kit.review.setDocType(staff, "f1", "d1", 1)).rejects.toThrow("conflict: stale");
    });

    it("refuses to trash a published file directly", async () => {
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Published", publishedAt: new Date() }));
      await expect(kit.review.trash(staff, "f1", 1)).rejects.toThrow("invalid_state: published_must_be_withdrawn");
    });

    it("trashes an acknowledged submission but not one still waiting", async () => {
      kit.repo.fileRows.push(
        fileRecord({ id: "f1", direction: "Inbound", state: "Acknowledged", acknowledgedAt: new Date() }),
        fileRecord({ id: "f2", direction: "Inbound", state: "Submitted", sha256: "b".repeat(64) }),
      );
      expect((await kit.review.trash(staff, "f1", 1)).state).toBe("Trashed");
      await expect(kit.review.trash(staff, "f2", 1)).rejects.toThrow("invalid_state: not_trashable");
    });

    it("rolls the linked case back", async () => {
      kit.repo.caseRows[0] = caseRecord({ id: "k1", clientId: "c1", state: "DocumentReceived" });
      kit.repo.fileRows.push(fileRecord({ id: "f1", state: "Staged", caseId: "k1" }));
      await kit.review.trash(staff, "f1", 1);
      expect(kit.repo.caseRows[0]?.state).toBe("Open");
    });
  });
});
