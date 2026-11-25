import type { FileView, IntakeResult } from "../../api/office-types";
import type { Translator } from "../../i18n";
import { caseLabel } from "./shelf-view";

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
 * The message key of the sentence that explains how a file was matched, or null when no method matched.
 * An arrival number that found a case is explained with the case.
 */
export function matchReasonKey(file: Pick<FileView, "resolutionMethod" | "caseRef">): string | null {
  switch (file.resolutionMethod) {
    case "ArrivalNumber":
      return file.caseRef === null ? "office.intake.reason.arrivalClient" : "office.intake.reason.arrivalCase";
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

/** The values the match sentence needs: the matched case, named as the case list names it. */
export function matchReasonParams(file: Pick<FileView, "caseRef">): Record<string, string> {
  return file.caseRef === null ? {} : { case: caseLabel(file.caseRef) };
}

/** The Client cell: the client of the file the row is about, or why there is none. */
export function clientCellText(result: RowResult, file: FileView | null, t: Translator): string {
  if (isNotStored(result)) {
    return t("office.intake.notStored");
  }
  return file?.client ? `${file.client.code} ${file.client.corporateName}` : t("office.intake.notDecided");
}

/** The Decided-by cell: what settled the destination; empty when no method did. */
export function decidedByText(result: RowResult, file: FileView | null, t: Translator): string {
  if (result.outcome === "duplicate") {
    return t("office.intake.sameContent");
  }
  if (isNotStored(result)) {
    return t("office.intake.notStored");
  }
  return file?.resolutionMethod ? t(`method.${file.resolutionMethod}`) : "";
}

/**
 * The Reason cell text: why the row has its state, or null when no sentence applies.
 * A failed row has no text here; its error is shown as a notice instead.
 */
export function reasonText(result: RowResult, file: FileView | null, t: Translator): string | null {
  if (result.outcome === "rejected") {
    return t(`rejection.${result.reason}`);
  }
  if (result.outcome === "duplicate") {
    return t("office.intake.duplicateReason");
  }
  if (result.outcome !== "stored" || file === null) {
    return null;
  }
  if (file.reviewReason) {
    return t(`reviewReason.${file.reviewReason}`);
  }
  const key = matchReasonKey(file);
  return key === null ? null : t(key, matchReasonParams(file));
}

/** Whether a Jev key is stored in this browser. A blank key counts as none. */
export function hasJevKey(settings: { key: string }): boolean {
  return settings.key.trim() !== "";
}

/** Classification with Jev runs only with a stored key, when nothing is busy, files are unclassified, and it has not run yet. */
export function canClassify(state: { busy: boolean; hasJevKey: boolean; unclassified: number; alreadyClassified: boolean }): boolean {
  return state.hasJevKey && !state.busy && state.unclassified > 0 && !state.alreadyClassified;
}
