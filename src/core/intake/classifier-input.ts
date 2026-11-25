import { stemOf } from "./file-name";
import { compileArrivalNumberPattern } from "./key-extractor";

export const MAX_TITLE_LENGTH = 120;
export const MAX_MODEL_NAME_LENGTH = 64;
const LONG_DIGIT_RUN = /[0-9]{6,}/g;
const SEPARATORS = /[\s_\-.()[\]]+/g;
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]*$/;
/** Aliases move to a new model without notice, so only fixed versions are accepted. */
const ALIAS_SUFFIXES = ["-latest", "-preview"];

export interface TitleOptions {
  arrivalNumberPattern: string;
  clientCodes: readonly string[];
}

/**
 * Reduces a file name to the text that may be sent to the classifier: the form or notice name.
 * Arrival numbers, client codes and digit runs of six or more are removed (instructions.md 1.9).
 */
export function classifierTitle(fileName: string, options: TitleOptions): string {
  const codes = new Set(options.clientCodes);
  const withoutNumbers = stemOf(fileName)
    .normalize("NFKC")
    .replace(compileArrivalNumberPattern(options.arrivalNumberPattern), " ")
    .replace(LONG_DIGIT_RUN, " ");
  return withoutNumbers
    .split(SEPARATORS)
    .filter((word) => word !== "" && !codes.has(word))
    .join(" ")
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
}

/** A model must be named by a fixed version such as jev-1.13.0. */
export function isFixedModelName(model: string): boolean {
  return model.length <= MAX_MODEL_NAME_LENGTH && MODEL_NAME.test(model) && !ALIAS_SUFFIXES.some((suffix) => model.endsWith(suffix));
}
