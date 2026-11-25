import type { DocTypeRecord, SettingsView } from "../../api/office-types";

/** The range the server accepts for the Jev confidence threshold (see the settings service). */
export const JEV_THRESHOLD_MIN = 0.8;
export const JEV_THRESHOLD_MAX = 1;
/** The longest office name the server accepts, counted in characters after trimming (see the settings service). */
export const OFFICE_NAME_MAX_LENGTH = 100;

/** The office name typed into the form, trimmed, or null when it is blank or longer than the server accepts. */
export function parseOfficeName(text: string): string | null {
  const trimmed = text.trim();
  return trimmed !== "" && [...trimmed].length <= OFFICE_NAME_MAX_LENGTH ? trimmed : null;
}

/** The spin-button step only. Any value inside the range is valid, on this grid or not. */
export const JEV_THRESHOLD_STEP = 0.01;

/** The threshold typed into the office form, or null when it is not a number inside the accepted range. */
export function parseJevThreshold(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return value >= JEV_THRESHOLD_MIN && value <= JEV_THRESHOLD_MAX ? value : null;
}

/**
 * Copies text with the Clipboard API and reports whether it worked.
 * The API is missing outside a secure context (plain http by host name) and in some embedded views;
 * that is reported as a failure like a refused write, so the caller can always tell the user.
 */
export async function copyText(clipboard: Pick<Clipboard, "writeText"> | undefined, text: string): Promise<boolean> {
  if (clipboard === undefined) {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A client can submit a file of this document type, so its case type matters. */
export function takesSubmissions(docType: Pick<DocTypeRecord, "direction">): boolean {
  return docType.direction !== "Outbound";
}

/** The choices for a document type's case type: none, then the monthly (Payroll) case types, the only ones the server accepts. */
export function submissionCaseTypeOptions(caseTypes: SettingsView["caseTypes"], noneLabel: string): { value: string; label: string }[] {
  return [{ value: "", label: noneLabel }, ...caseTypes.filter((type) => type.kind === "Payroll").map((type) => ({ value: type.id, label: type.label }))];
}

/** The body that sets or removes (empty choice) the case type of an existing document type; the update replaces every field. */
export function docTypeUpdate(docType: DocTypeRecord, choice: string): { label: string; shortCode: string; direction: DocTypeRecord["direction"]; caseTypeId: string | null } {
  return { label: docType.label, shortCode: docType.shortCode, direction: docType.direction, caseTypeId: choice === "" ? null : choice };
}
