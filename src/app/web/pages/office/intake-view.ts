import type { FileView, IntakeResult } from "../../api/office-types";

/** Rules of the Intake screen that do not need React: what a row is about, and when classification may run. */

/** One file of an intake batch: the server's result, or a failure to reach the server. */
export type RowResult = IntakeResult | { outcome: "failed"; error: unknown };

/** The file a row is about: the stored file, or the existing file a duplicate repeats. */
export function fileOfResult(result: RowResult): FileView | null {
  if (result.outcome === "stored") {
    return result.file;
  }
  return result.outcome === "duplicate" ? result.existing : null;
}

/** A rejected or failed file never reached the shelf, so the row has no client and no decision. */
export function isNotStored(result: RowResult): boolean {
  return result.outcome === "rejected" || result.outcome === "failed";
}

/**
 * The message key of the sentence that explains how a file was matched, or null when no key matched.
 * An arrival number that found a case is explained with the case.
 */
export function matchReasonKey(file: Pick<FileView, "resolutionMethod" | "caseId">): string | null {
  switch (file.resolutionMethod) {
    case "ArrivalNumber":
      return file.caseId === null ? "office.intake.reason.arrivalClient" : "office.intake.reason.arrivalCase";
    case "ClientCode":
      return "office.intake.reason.clientCode";
    case "CorporateNumber":
      return "office.intake.reason.corporateNumber";
    case "StaffSelected":
      return "office.intake.reason.staff";
    default:
      return null;
  }
}

/** Whether a Jev key is stored in this browser. A blank key counts as none. */
export function hasJevKey(settings: { key: string }): boolean {
  return settings.key.trim() !== "";
}

/** Classification with Jev runs only with a stored key, when nothing is busy, files are unclassified, and it has not run yet. */
export function canClassify(state: { busy: boolean; hasJevKey: boolean; unclassified: number; alreadyClassified: boolean }): boolean {
  return state.hasJevKey && !state.busy && state.unclassified > 0 && !state.alreadyClassified;
}
