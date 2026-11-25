import { stemOf } from "./file-name";
import { compileArrivalNumberPattern } from "./key-extractor";

export const MAX_TITLE_LENGTH = 120;
export const MAX_MODEL_NAME_LENGTH = 64;
const LONG_DIGIT_RUN = /[0-9]{6,}/g;
/**
 * Anything that is not a letter, a digit or a combining mark separates the words of a vocabulary
 * phrase: spaces and every kind of punctuation, such as a comma, a slash or the Japanese middle dot.
 */
const SEPARATORS = /[^\p{L}\p{N}\p{M}]+/gu;
/** A fixed version such as jev-1.13.0. Aliases (jev-latest, jev-preview) and bare names do not match. */
const MODEL_NAME = /^[a-z][a-z0-9]*-\d+(?:\.\d+)+$/;

const ASCII_WORD_CHARACTER = /[a-z0-9]/;

export interface TitleOptions {
  arrivalNumberPattern: string;
  clientCodes: readonly string[];
  /** The office's document type labels, short codes and rule keywords. Their words are the only text that is kept. */
  vocabulary: readonly string[];
}

/**
 * Reduces a file name to the text that may be sent to the classifier: the form or notice name
 * (instructions.md 1.4 and 1.9). Only words of the office's own vocabulary are kept, so any other
 * word in the file name, such as a personal name, is dropped. Arrival numbers, client codes and
 * digit runs of six or more are removed first and therefore never match.
 */
export function classifierTitle(fileName: string, options: TitleOptions): string {
  const withoutNumbers = stemOf(fileName)
    .normalize("NFKC")
    .replace(compileArrivalNumberPattern(options.arrivalNumberPattern), " ")
    .replace(LONG_DIGIT_RUN, " ");
  // Client codes are removed wherever they occur, in any letter case and even inside a longer word.
  const text = options.clientCodes
    .map((code) => code.normalize("NFKC"))
    .filter((code) => code !== "")
    .reduce((rest, code) => rest.replace(new RegExp(escapeRegExp(code), "gi"), " "), withoutNumbers)
    .toLowerCase();
  // Longest first, so a longer word wins over a shorter one that starts at the same place.
  const words = [...new Set(options.vocabulary.flatMap(wordsOf))].sort((left, right) => right.length - left.length);
  const kept: string[] = [];
  let length = 0;
  let index = 0;
  while (index < text.length) {
    const word = words.find((candidate) => occursAt(text, candidate, index));
    if (word === undefined) {
      index += 1;
      continue;
    }
    length += word.length + (kept.length === 0 ? 0 : 1);
    if (length > MAX_TITLE_LENGTH) {
      break;
    }
    kept.push(word);
    index += word.length;
  }
  return kept.join(" ");
}

function wordsOf(phrase: string): string[] {
  return phrase
    .normalize("NFKC")
    .toLowerCase()
    .split(SEPARATORS)
    .filter((word) => word !== "");
}

/**
 * True when the word stands at this place of the text. An end of the word that is a letter or digit
 * of the Latin alphabet must also be the end of a word in the text, so "notice" is not found in
 * "noticeboard". Other scripts are written without separators and match anywhere.
 */
function occursAt(text: string, word: string, index: number): boolean {
  if (!text.startsWith(word, index)) {
    return false;
  }
  const end = index + word.length;
  const openStart = ASCII_WORD_CHARACTER.test(word.charAt(0)) && ASCII_WORD_CHARACTER.test(text.charAt(index - 1));
  const openEnd = ASCII_WORD_CHARACTER.test(word.charAt(word.length - 1)) && ASCII_WORD_CHARACTER.test(text.charAt(end));
  return !openStart && !openEnd;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A model must be named by a fixed version such as jev-1.13.0. */
export function isFixedModelName(model: string): boolean {
  return model.length <= MAX_MODEL_NAME_LENGTH && MODEL_NAME.test(model);
}
