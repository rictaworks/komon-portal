import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaseView } from "../../src/app/web/api/office-types";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import { Steps } from "../../src/app/web/pages/office/Cases";
import { caseSteps, freshestCase, parseArrivalNumbers, stepNoteKey, type CaseStep } from "../../src/app/web/pages/office/case-progress";

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

describe("stepNoteKey", () => {
  const step = (state: string, status: CaseStep["status"]): CaseStep => ({ state, status });

  it("gives a current step its note, one per state", () => {
    expect(stepNoteKey(step("Open", "current"))).toBe("caseStepNote.Open");
    expect(stepNoteKey(step("Submitted", "current"))).toBe("caseStepNote.Submitted");
    expect(stepNoteKey(step("MaterialsReceived", "current"))).toBe("caseStepNote.MaterialsReceived");
    expect(stepNoteKey(step("DocumentReceived", "current"))).toBe("caseStepNote.DocumentReceived");
    expect(stepNoteKey(step("Delivered", "current"))).toBe("caseStepNote.Delivered");
    expect(stepNoteKey(step("Confirmed", "current"))).toBe("caseStepNote.Confirmed");
  });

  it("gives a pending step its note, one per state", () => {
    expect(stepNoteKey(step("Submitted", "pending"))).toBe("caseStepNote.Submitted");
    expect(stepNoteKey(step("MaterialsReceived", "pending"))).toBe("caseStepNote.MaterialsReceived");
    expect(stepNoteKey(step("DocumentReceived", "pending"))).toBe("caseStepNote.DocumentReceived");
    expect(stepNoteKey(step("Delivered", "pending"))).toBe("caseStepNote.Delivered");
    expect(stepNoteKey(step("Confirmed", "pending"))).toBe("caseStepNote.Confirmed");
  });

  it("gives no state note to a done step or to an unconfirmed step, which carry their own notes", () => {
    expect(stepNoteKey(step("Open", "done"))).toBeNull();
    expect(stepNoteKey(step("Submitted", "done"))).toBeNull();
    expect(stepNoteKey(step("Submitted", "unconfirmed"))).toBeNull();
    expect(stepNoteKey(step("MaterialsReceived", "unconfirmed"))).toBeNull();
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

/** The text of each progress step as a reader sees it, one string per step. */
function stepTexts(record: CaseView): string[] {
  const html = renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(Steps, { record })));
  return (html.match(/<li[\s\S]*?<\/li>/g) ?? []).map((item) => item.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function caseOf(kind: "Procedure" | "Payroll" | "Other", state: string, submittedOn: string | null): CaseView {
  return { ...view("a", 1), caseType: { id: "type-1", kind, label: "Test" }, state, submittedOn };
}

describe("Steps", () => {
  it("shows the state note of the current and of each pending step, and no note on a done step", () => {
    const texts = stepTexts(caseOf("Other", "DocumentReceived", null));
    expect(texts[0]).toBe("1 Open");
    expect(texts[1]).toContain("Waiting for official document");
    expect(texts[2]).toContain("Published to client");
    expect(texts[3]).toContain("Opened by client");
  });

  it("shows the Waiting for filing note on a current Submitted step and the Not submitted note when no date is recorded", () => {
    const texts = stepTexts(caseOf("Procedure", "Submitted", null));
    expect(texts[1]).toContain("Submitted");
    expect(texts[1]).toContain("Waiting for filing");
    expect(texts[2]).toContain("Waiting for official document");
    const unconfirmed = stepTexts(caseOf("Procedure", "DocumentReceived", null));
    expect(unconfirmed[1]).toContain("Not submitted");
    expect(unconfirmed[1]).not.toContain("Waiting for filing");
  });

  it("shows the submission date instead of the note on a dated Submitted step, and no note on a done step", () => {
    const texts = stepTexts(caseOf("Procedure", "Delivered", "2026-11-02"));
    expect(texts[1]).toContain("02 Nov 2026");
    expect(texts[1]).not.toContain("Waiting for filing");
    expect(texts[2]).not.toContain("Published to client");
    expect(texts[3]).toContain("Published to client");
    expect(texts[4]).toContain("Opened by client");
  });

  it("shows the Not recorded note on an unconfirmed step and the materials note on a current one", () => {
    const past = stepTexts(caseOf("Payroll", "DocumentReceived", null));
    expect(past[1]).toContain("Not recorded");
    expect(past[1]).not.toContain("Waiting for materials");
    const current = stepTexts(caseOf("Payroll", "MaterialsReceived", null));
    expect(current[1]).toContain("Waiting for materials");
  });

  it("shows the state notes of every pending step on a closed or cancelled case", () => {
    const closed = stepTexts(caseOf("Other", "Closed", null));
    expect(closed[0]).toContain("Registered");
    expect(closed[1]).toContain("Waiting for official document");
    expect(closed[2]).toContain("Published to client");
    expect(closed[3]).toContain("Opened by client");
    expect(stepTexts(caseOf("Procedure", "Cancelled", null))[1]).toContain("Waiting for filing");
  });
});
