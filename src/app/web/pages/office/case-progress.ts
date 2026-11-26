import type { CaseView } from "../../api/office-types";

export type CaseKindName = "Procedure" | "Payroll" | "Other";

/**
 * done: the step lies behind the case. current: the case is on it. pending: not reached.
 * unconfirmed: the case is past the step, but nothing records that the step itself happened.
 */
export type StepStatus = "done" | "current" | "pending" | "unconfirmed";

export interface CaseStep {
  state: string;
  status: StepStatus;
}

/** Steps a case can pass without stopping on them: the state is derived from files, so a later fact wins. */
const SECOND_STEP: Readonly<Record<CaseKindName, string | null>> = { Procedure: "Submitted", Payroll: "MaterialsReceived", Other: null };

/**
 * The progress steps of a case of this kind. Only a procedure can be submitted and only a
 * payroll case waits for materials. A closed or cancelled case is on no step: its progress
 * before the end is not recorded.
 */
export function caseSteps(kind: CaseKindName, state: string, submittedOn: string | null): CaseStep[] {
  const second = SECOND_STEP[kind];
  const states = ["Open", ...(second === null ? [] : [second]), "DocumentReceived", "Delivered", "Confirmed"];
  const current = states.indexOf(state);
  return states.map((step, index) => {
    if (index === current) return { state: step, status: "current" };
    if (index > current) return { state: step, status: "pending" };
    if (step === "MaterialsReceived" || (step === "Submitted" && submittedOn === null)) return { state: step, status: "unconfirmed" };
    return { state: step, status: "done" };
  });
}

/**
 * The locale key of the note a step shows while it is current or pending. Done and unconfirmed
 * steps carry their own notes instead, so they have none here.
 */
export function stepNoteKey(step: CaseStep): string | null {
  if (step.status === "done" || step.status === "unconfirmed") {
    return null;
  }
  return `caseStepNote.${step.state}`;
}

/**
 * The newest known copy of the selected case: the loaded one, or the answer of the last
 * change when that is newer. Null when neither belongs to the selection.
 */
export function freshestCase(selectedId: string | null, loaded: CaseView | null, saved: CaseView | null): CaseView | null {
  if (selectedId === null) {
    return null;
  }
  const loadedMatch = loaded !== null && loaded.id === selectedId ? loaded : null;
  const savedMatch = saved !== null && saved.id === selectedId ? saved : null;
  if (loadedMatch === null || savedMatch === null) {
    return loadedMatch ?? savedMatch;
  }
  return savedMatch.version > loadedMatch.version ? savedMatch : loadedMatch;
}

/** Arrival numbers typed into one field, separated by spaces, commas or line breaks. */
export function parseArrivalNumbers(text: string): string[] {
  return text.split(/[\s,]+/).filter((value) => value !== "");
}
