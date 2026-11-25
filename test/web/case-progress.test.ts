import { describe, expect, it } from "vitest";
import type { CaseView } from "../../src/app/web/api/office-types";
import { caseSteps, freshestCase, parseArrivalNumbers } from "../../src/app/web/pages/office/case-progress";

function statuses(kind: "Procedure" | "Payroll" | "Other", state: string, submittedOn: string | null): string[] {
  return caseSteps(kind, state, submittedOn).map((step) => `${step.state}:${step.status}`);
}

function view(id: string, version: number): CaseView {
  return {
    id,
    client: null,
    caseType: null,
    targetMonth: "2026-11",
    sequence: 1,
    referenceCode: "REF-1",
    assignee: null,
    dueOn: null,
    submittedOn: null,
    state: "Open",
    retrieval: { level: "none", deadline: null, daysLeft: null },
    due: { level: "none", deadline: null, daysLeft: null },
    version,
  };
}

describe("caseSteps", () => {
  it("has no Submitted step for a case that is not a procedure", () => {
    expect(statuses("Other", "DocumentReceived", null)).toEqual(["Open:done", "DocumentReceived:current", "Delivered:pending", "Confirmed:pending"]);
  });

  it("does not show Submitted as done when a procedure received its document before the submission was recorded", () => {
    expect(statuses("Procedure", "DocumentReceived", null)).toEqual(["Open:done", "Submitted:unconfirmed", "DocumentReceived:current", "Delivered:pending", "Confirmed:pending"]);
  });

  it("shows Submitted as done once the submission date is recorded", () => {
    expect(statuses("Procedure", "Delivered", "2026-11-02")).toEqual(["Open:done", "Submitted:done", "DocumentReceived:done", "Delivered:current", "Confirmed:pending"]);
    expect(statuses("Procedure", "Submitted", "2026-11-02")).toEqual(["Open:done", "Submitted:current", "DocumentReceived:pending", "Delivered:pending", "Confirmed:pending"]);
  });

  it("does not claim that materials arrived for a payroll case that is past that step", () => {
    expect(statuses("Payroll", "DocumentReceived", null)).toEqual(["Open:done", "MaterialsReceived:unconfirmed", "DocumentReceived:current", "Delivered:pending", "Confirmed:pending"]);
    expect(statuses("Payroll", "MaterialsReceived", null)).toEqual(["Open:done", "MaterialsReceived:current", "DocumentReceived:pending", "Delivered:pending", "Confirmed:pending"]);
  });

  it("puts a closed or cancelled case on no step", () => {
    expect(statuses("Other", "Closed", null)).toEqual(["Open:pending", "DocumentReceived:pending", "Delivered:pending", "Confirmed:pending"]);
  });
});

describe("freshestCase", () => {
  it("is null when nothing is selected or nothing matches the selection", () => {
    expect(freshestCase(null, view("a", 1), view("a", 2))).toBeNull();
    expect(freshestCase("b", view("a", 1), view("a", 2))).toBeNull();
  });

  it("prefers the answer of the last change over an older loaded copy", () => {
    expect(freshestCase("a", view("a", 1), view("a", 2))?.version).toBe(2);
  });

  it("prefers the loaded copy once it is at least as new", () => {
    const loaded = view("a", 3);
    expect(freshestCase("a", loaded, view("a", 2))).toBe(loaded);
    const same = view("a", 2);
    expect(freshestCase("a", same, view("a", 2))).toBe(same);
    expect(freshestCase("a", loaded, null)).toBe(loaded);
    expect(freshestCase("a", null, view("b", 9))).toBeNull();
  });
});

describe("parseArrivalNumbers", () => {
  it("splits on spaces, commas and line breaks and drops blanks", () => {
    expect(parseArrivalNumbers(" 12345678-01, 12345678-02\n12345678-03 ")).toEqual(["12345678-01", "12345678-02", "12345678-03"]);
    expect(parseArrivalNumbers("  ")).toEqual([]);
  });
});
