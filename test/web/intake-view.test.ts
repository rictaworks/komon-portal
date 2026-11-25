import { describe, expect, it } from "vitest";
import type { FileView, IntakeResult } from "../../src/app/web/api/office-types";
import {
  canClassify,
  clientCellText,
  decidedByText,
  fileOfResult,
  hasJevKey,
  isNotStored,
  matchReasonKey,
  matchReasonParams,
  reasonText,
} from "../../src/app/web/pages/office/intake-view";
import { englishTranslator } from "../../src/app/web/i18n";

type CaseRef = NonNullable<FileView["caseRef"]>;

const socialCase: CaseRef = {
  id: "case-1",
  caseType: { id: "type-1", kind: "Procedure", label: "Social insurance" },
  targetMonth: "2026-11",
  sequence: 1,
};

function file(overrides: Partial<FileView>): FileView {
  return {
    id: "f1", direction: "Inbound", displayName: "C0031_SHAHO_20261124_01", format: "pdf", sizeBytes: 10, state: "Staged",
    client: null, caseId: null, caseRef: null, docType: null, targetMonth: null, resolutionMethod: null, reviewReason: null, evidence: [],
    unmatchedArrivalNumber: null, typeSource: null, jev: null, withdrawReason: null, incident: false,
    receivedAt: "2026-11-24T00:00:00.000Z", publishedAt: null, acknowledgedAt: null, trashedAt: null, trashedFrom: null, readers: [], version: 1,
    ...overrides,
  };
}

const stored = (overrides: Partial<FileView>): IntakeResult => ({ outcome: "stored", published: false, file: file(overrides) });
const t = englishTranslator();
const hinode = { id: "client-1", code: "C0031", corporateName: "Hinode Logistics", status: "Active" as const };

describe("matchReasonKey", () => {
  it("explains an arrival-number match that found a case", () => {
    expect(matchReasonKey(file({ resolutionMethod: "ArrivalNumber", caseRef: socialCase }))).toBe("office.intake.reason.arrivalCase");
  });

  it("explains an arrival-number match that found no case", () => {
    expect(matchReasonKey(file({ resolutionMethod: "ArrivalNumber", caseRef: null }))).toBe("office.intake.reason.arrivalClient");
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

  it("has the sentence of each method, in the mock's wording", () => {
    expect(t("office.intake.reason.clientCode")).toBe("Code at the start of the file name.");
    expect(t("office.intake.reason.corporateNumber")).toBe("Matched exactly one client.");
    expect(t("office.intake.reason.staff")).toBe("Chosen by staff.");
    expect(t("office.intake.reason.arrivalClient")).toBe("Matched a client by arrival number.");
  });
});

describe("matchReasonParams", () => {
  it("names the matched case, as the case list labels it", () => {
    expect(matchReasonParams(file({ caseRef: socialCase }))).toEqual({ case: "Social insurance November 2026 #1" });
    expect(t("office.intake.reason.arrivalCase", matchReasonParams(file({ caseRef: socialCase })))).toBe(
      "Matched case Social insurance November 2026 #1.",
    );
  });

  it("names no case when the file has none", () => {
    expect(matchReasonParams(file({ caseRef: null }))).toEqual({});
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

describe("row cells", () => {
  it("shows Not stored in the client and decided-by cells of a rejected or failed row", () => {
    const rejected: IntakeResult = { outcome: "rejected", reason: "Empty" };
    expect(clientCellText(rejected, null, t)).toBe("Not stored");
    expect(decidedByText(rejected, null, t)).toBe("Not stored");
    expect(clientCellText({ outcome: "failed", error: new Error("network") }, null, t)).toBe("Not stored");
  });

  it("shows the client of a stored file, or Not decided when none is set", () => {
    expect(clientCellText(stored({ client: hinode }), file({ client: hinode }), t)).toBe("C0031 Hinode Logistics");
    expect(clientCellText(stored({}), file({}), t)).toBe("Not decided");
  });

  it("labels a duplicate Same content and shows the client of the file it repeats", () => {
    const existing = file({ client: hinode, resolutionMethod: "ClientCode" });
    const duplicate: IntakeResult = { outcome: "duplicate", existing };
    expect(decidedByText(duplicate, existing, t)).toBe("Same content");
    expect(clientCellText(duplicate, existing, t)).toBe("C0031 Hinode Logistics");
  });

  it("names the method that decided a stored file, and nothing when no method decided it", () => {
    expect(decidedByText(stored({}), file({ resolutionMethod: "StaffSelected" }), t)).toBe("Chosen by staff");
    expect(decidedByText(stored({}), file({ resolutionMethod: null }), t)).toBe("");
  });
});

describe("row reasons", () => {
  it("gives the rejection, the duplicate sentence and the review reason", () => {
    expect(reasonText({ outcome: "rejected", reason: "Empty" }, null, t)).toBe("The file is empty.");
    expect(reasonText({ outcome: "duplicate", existing: null }, null, t)).toBe("Identical file is already on this shelf.");
    expect(reasonText(stored({ state: "NeedsReview", reviewReason: "NoKey" }), file({ reviewReason: "NoKey" }), t)).toBe(
      "No client could be identified",
    );
  });

  it("gives the matched-case sentence for a staged file matched by arrival number", () => {
    const staged = file({ resolutionMethod: "ArrivalNumber", caseRef: socialCase });
    expect(reasonText(stored({}), staged, t)).toBe("Matched case Social insurance November 2026 #1.");
  });

  it("gives the sentence of the method for a staged file of each method", () => {
    expect(reasonText(stored({}), file({ resolutionMethod: "ClientCode" }), t)).toBe("Code at the start of the file name.");
    expect(reasonText(stored({}), file({ resolutionMethod: "CorporateNumber" }), t)).toBe("Matched exactly one client.");
    expect(reasonText(stored({}), file({ resolutionMethod: "StaffSelected" }), t)).toBe("Chosen by staff.");
  });

  it("has no reason for a stored file that no method decided", () => {
    expect(reasonText(stored({}), file({ resolutionMethod: null }), t)).toBeNull();
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
