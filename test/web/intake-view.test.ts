import { describe, expect, it } from "vitest";
import type { FileView, IntakeResult } from "../../src/app/web/api/office-types";
import { canClassify, fileOfResult, hasJevKey, isNotStored, matchReasonKey } from "../../src/app/web/pages/office/intake-view";
import { englishTranslator } from "../../src/app/web/i18n";

function file(overrides: Partial<FileView>): FileView {
  return {
    id: "f1", direction: "Inbound", displayName: "C0031_SHAHO_20261124_01", format: "pdf", sizeBytes: 10, state: "Staged",
    client: null, caseId: null, docType: null, targetMonth: null, resolutionMethod: null, reviewReason: null, evidence: [],
    unmatchedArrivalNumber: null, typeSource: null, jev: null, withdrawReason: null, incident: false,
    receivedAt: "2026-11-24T00:00:00.000Z", publishedAt: null, acknowledgedAt: null, trashedAt: null, trashedFrom: null, readers: [], version: 1,
    ...overrides,
  };
}

const stored = (overrides: Partial<FileView>): IntakeResult => ({ outcome: "stored", published: false, file: file(overrides) });

describe("matchReasonKey", () => {
  it("explains an arrival-number match that found a case", () => {
    expect(matchReasonKey(file({ resolutionMethod: "ArrivalNumber", caseId: "case-1" }))).toBe("office.intake.reason.arrivalCase");
  });

  it("explains an arrival-number match that found no case", () => {
    expect(matchReasonKey(file({ resolutionMethod: "ArrivalNumber", caseId: null }))).toBe("office.intake.reason.arrivalClient");
  });

  it("explains client-code and corporate-number matches", () => {
    expect(matchReasonKey(file({ resolutionMethod: "ClientCode" }))).toBe("office.intake.reason.clientCode");
    expect(matchReasonKey(file({ resolutionMethod: "CorporateNumber" }))).toBe("office.intake.reason.corporateNumber");
  });

  it("explains a choice made by staff", () => {
    expect(matchReasonKey(file({ resolutionMethod: "StaffSelected" }))).toBe("office.intake.reason.staff");
  });

  it("has no sentence when the file was not matched", () => {
    expect(matchReasonKey(file({ resolutionMethod: null }))).toBeNull();
  });

  it("names a sentence for every resolution method, with the mock's wording", () => {
    const t = englishTranslator();
    expect(t("office.intake.reason.clientCode")).toBe("Code at the start of the file name.");
    expect(t("office.intake.reason.corporateNumber")).toBe("Matched exactly one client.");
    expect(t("office.intake.reason.arrivalCase")).toBe("Matched a case by arrival number.");
  });
});

describe("row results", () => {
  it("takes the file of a stored row and the existing file of a duplicate", () => {
    const existing = file({ id: "old" });
    expect(fileOfResult(stored({ id: "new" }))?.id).toBe("new");
    expect(fileOfResult({ outcome: "duplicate", existing })).toBe(existing);
    expect(fileOfResult({ outcome: "duplicate", existing: null })).toBeNull();
  });

  it("has no file for a rejected or failed row, so such a row is not stored", () => {
    expect(fileOfResult({ outcome: "rejected", reason: "Empty" })).toBeNull();
    expect(fileOfResult({ outcome: "failed", error: new Error("network") })).toBeNull();
    expect(isNotStored({ outcome: "rejected", reason: "Empty" })).toBe(true);
    expect(isNotStored({ outcome: "failed", error: new Error("network") })).toBe(true);
    expect(isNotStored({ outcome: "duplicate", existing: null })).toBe(false);
    expect(isNotStored(stored({}))).toBe(false);
  });
});

describe("Jev key gate", () => {
  it("counts a stored key only when it is not blank", () => {
    expect(hasJevKey({ key: "" })).toBe(false);
    expect(hasJevKey({ key: "   " })).toBe(false);
    expect(hasJevKey({ key: "jev-key-1" })).toBe(true);
  });

  it("allows classification only with a key, unbusy, with unclassified files and no earlier run", () => {
    const ready = { busy: false, hasJevKey: true, unclassified: 2, alreadyClassified: false };
    expect(canClassify(ready)).toBe(true);
    expect(canClassify({ ...ready, hasJevKey: false })).toBe(false);
    expect(canClassify({ ...ready, busy: true })).toBe(false);
    expect(canClassify({ ...ready, unclassified: 0 })).toBe(false);
    expect(canClassify({ ...ready, alreadyClassified: true })).toBe(false);
  });
});
