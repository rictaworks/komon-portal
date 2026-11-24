import type { Id } from "../model/types";

export interface ClassifierItem {
  id: Id;
  text: string;
}

export interface ClassifierChoice {
  id: Id;
  label: string;
}

export interface ClassifierRequest {
  model: string;
  /** The user's own key. Used for this one call and never stored or logged. */
  credential: string;
  items: readonly ClassifierItem[];
  choices: readonly ClassifierChoice[];
}

export interface ClassifierAnswer {
  itemId: Id;
  choiceId: Id;
  confidence: number;
}

export interface ClassifierResponse {
  /** Model name reported by the provider. */
  model: string;
  answers: readonly ClassifierAnswer[];
}

export const CLASSIFIER_ERROR_CODES = [
  "authentication_failed",
  "unsupported_model",
  "limit_reached",
  "network_failure",
  "invalid_response",
] as const;
export type ClassifierErrorCode = (typeof CLASSIFIER_ERROR_CODES)[number];

/** Raised by a classifier adapter. Never contains the credential. */
export class ClassifierError extends Error {
  readonly code: ClassifierErrorCode;

  constructor(code: ClassifierErrorCode) {
    super(`classifier: ${code}`);
    this.name = "ClassifierError";
    this.code = code;
  }
}

export interface ClassifierPort {
  /** One provider call for all items. Throws ClassifierError; never falls back to another model. */
  choose(request: ClassifierRequest): Promise<ClassifierResponse>;
}
