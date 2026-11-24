import type { CaseKind, CaseRecord, CaseState } from "../model/types";
import type { CaseFileSummary } from "../ports/repository";

/** States that only a staff action sets and that file events never change. */
export const TERMINAL_CASE_STATES: readonly CaseState[] = ["Closed", "Cancelled"];
/** States from which a case may be cancelled (instructions.md 6.3). */
export const CANCELLABLE_CASE_STATES: readonly CaseState[] = ["Open", "Submitted", "MaterialsReceived"];

/**
 * Derives the state of a case from its own fields and the files linked to it.
 * Because the state is always recomputed from facts, every rollback of 6.3 follows
 * from the same rule and no partial update can leave it inconsistent.
 */
export function deriveCaseState(
  record: Pick<CaseRecord, "state" | "submittedOn">,
  kind: CaseKind,
  files: CaseFileSummary,
): CaseState {
  if (TERMINAL_CASE_STATES.includes(record.state)) {
    return record.state;
  }
  if (files.publishedAndOpened > 0) {
    return "Confirmed";
  }
  if (files.published > 0) {
    return "Delivered";
  }
  if (files.outbound > 0) {
    return "DocumentReceived";
  }
  if (kind === "Payroll" && files.inbound > 0) {
    return "MaterialsReceived";
  }
  return record.submittedOn === null ? "Open" : "Submitted";
}
