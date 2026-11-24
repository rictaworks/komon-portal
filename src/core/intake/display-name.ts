import type { LocalDate } from "../model/types";

export const UNASSIGNED_CODE = "UNASSIGNED";
export const UNCLASSIFIED_CODE = "UNCLASSIFIED";
const SEQUENCE_WIDTH = 2;

export interface DisplayNameParts {
  clientCode: string | null;
  shortCode: string | null;
  receivedOn: LocalDate;
  sequence: number;
}

/**
 * Builds the name shown on screens and used for downloads:
 * {client code}_{type short code or UNCLASSIFIED}_{YYYYMMDD}_{sequence of that day}.
 * The original file name is never used.
 */
export function buildDisplayName(parts: DisplayNameParts): string {
  return [
    parts.clientCode ?? UNASSIGNED_CODE,
    parts.shortCode ?? UNCLASSIFIED_CODE,
    parts.receivedOn.replaceAll("-", ""),
    String(parts.sequence).padStart(SEQUENCE_WIDTH, "0"),
  ].join("_");
}
