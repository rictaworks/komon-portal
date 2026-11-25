import { stemOf } from "./file-name";
import { compileArrivalNumberPattern } from "./key-extractor";

export const MAX_TITLE_LENGTH = 120;
export const MAX_MODEL_NAME_LENGTH = 64;
const LONG_DIGIT_RUN = /[0-9]{6,}/g;
const SEPARATORS = /[\s_\-.()[\]]+/g;
/** A fixed version such as jev-1.13.0. Aliases (jev-latest, jev-preview) and bare names do not match. */
const MODEL_NAME = /^[a-z][a-z0-9]*-\d+(?:\.\d+)+$/;

export interface TitleOptions {
  arrivalNumberPattern: string;
  clientCodes: readonly string[];
}

/**
 * Reduces a file name to the text that may be sent to the classifier: the form or notice name.
 * Arrival numbers, client codes and digit runs of six or more are removed (instructions.md 1.9).
 */
export function classifierTitle(fileName: string, options: TitleOptions): string {
  const withoutNumbers = stemOf(fileName)
    .normalize("NFKC")
    .replace(compileArrivalNumberPattern(options.arrivalNumberPattern), " ")
    .replace(LONG_DIGIT_RUN, " ");
  // Client codes are removed wherever they occur, in any letter case and even inside a longer word.
  const withoutCodes = options.clientCodes
    .map((code) => code.normalize("NFKC"))
    .filter((code) => code !== "")
    .reduce((text, code) => text.replace(new RegExp(escapeRegExp(code), "gi"), " "), withoutNumbers);
  return withoutCodes
    .split(SEPARATORS)
    .filter((word) => word !== "")
    .join(" ")
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A model must be named by a fixed version such as jev-1.13.0. */
export function isFixedModelName(model: string): boolean {
  return model.length <= MAX_MODEL_NAME_LENGTH && MODEL_NAME.test(model);
}
