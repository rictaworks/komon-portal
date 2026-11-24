import { invalidInput } from "../model/errors";
import type { FileFormat } from "../model/types";
import { isValidCorporateNumber } from "./corporate-number";
import { stemOf } from "./file-name";
import { MAX_ARRIVAL_PATTERN_LENGTH } from "./limits";
import { inspectZip } from "./zip-reader";

export interface ExtractedKeys {
  arrivalNumbers: string[];
  clientCodes: string[];
  corporateNumbers: string[];
}

export interface KeySource {
  fileName: string;
  format: FileFormat;
  bytes: Uint8Array;
}

export interface KeyExtractionOptions {
  /** Regular expression source for arrival numbers, from the office settings. */
  arrivalNumberPattern: string;
  /** Registered client codes. */
  clientCodes: readonly string[];
}

const NOT_AFTER_DIGIT = "(?<![0-9])";
const NOT_BEFORE_DIGIT = "(?![0-9])";
const CORPORATE_NUMBER = new RegExp(`${NOT_AFTER_DIGIT}[0-9]{13}${NOT_BEFORE_DIGIT}`, "g");
/** Characters that may follow a client code: ASCII separators plus full-width space, parentheses and brackets. */
const CODE_DELIMITERS = "_\\-\\s.()[\\]\\u3000\\uff08\\uff09\\u3010\\u3011";
const LEADING_WORD = new RegExp(`^([A-Za-z0-9]+)(?:$|[${CODE_DELIMITERS}])`);

/**
 * Accepted pattern syntax: a sequence of literals, `\d` or simple character classes, each with an
 * optional bounded quantifier `{n}` or `{n,m}`. No groups, alternation or unbounded quantifiers,
 * so matching always runs in linear time on attacker-supplied text.
 */
const SAFE_PATTERN = /^(?:(?:[A-Za-z0-9-]|\\d|\[[A-Za-z0-9-]+\])(?:\{\d{1,2}(?:,\d{1,2})?\})?)+$/;

/** Compiles the configured pattern so that it never matches inside a longer digit run. */
export function compileArrivalNumberPattern(pattern: string): RegExp {
  if (pattern.length > MAX_ARRIVAL_PATTERN_LENGTH || !SAFE_PATTERN.test(pattern)) {
    throw invalidInput("arrival_number_pattern");
  }
  let bare: RegExp;
  try {
    bare = new RegExp(`^(?:${pattern})$`);
  } catch {
    throw invalidInput("arrival_number_pattern");
  }
  if (bare.test("")) {
    throw invalidInput("arrival_number_pattern");
  }
  return new RegExp(`${NOT_AFTER_DIGIT}(?:${pattern})${NOT_BEFORE_DIGIT}`, "g");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function matchAll(texts: readonly string[], pattern: RegExp): string[] {
  return texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[0]));
}

function leadingClientCode(fileName: string, clientCodes: readonly string[]): string[] {
  const word = LEADING_WORD.exec(stemOf(fileName))?.[1];
  return word !== undefined && clientCodes.includes(word) ? [word] : [];
}

function readableTexts(source: KeySource): string[] {
  const texts = [stemOf(source.fileName)];
  if (source.format !== "zip") {
    return texts;
  }
  const inspection = inspectZip(source.bytes);
  return inspection.readable ? [...texts, ...inspection.entryNames, ...inspection.xmlTexts] : texts;
}

/**
 * Reads identifiers from the file name and, for ZIP files, from entry names and XML entries.
 * Client codes come from the file name only. A ZIP that cannot be read yields no keys from inside.
 */
export function extractKeys(source: KeySource, options: KeyExtractionOptions): ExtractedKeys {
  const arrivalPattern = compileArrivalNumberPattern(options.arrivalNumberPattern);
  const texts = readableTexts(source);
  return {
    arrivalNumbers: unique(matchAll(texts, arrivalPattern)),
    clientCodes: leadingClientCode(source.fileName, options.clientCodes),
    corporateNumbers: unique(matchAll(texts, CORPORATE_NUMBER).filter(isValidCorporateNumber)),
  };
}
