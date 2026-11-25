/** Stable machine-readable codes returned by the API. Display text lives in src/locales. */
export const API_CODES = {
  ok: "ok",
  notFound: "not_found",
  internalError: "internal_error",
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  badOrigin: "bad_origin",
  badCsrf: "bad_csrf",
  humanCheckFailed: "human_check_failed",
  notConfigured: "not_configured",
  invalidInput: "invalid_input",
  invalidState: "invalid_state",
  conflict: "conflict",
  signInFailed: "sign_in_failed",
  classifierFailed: "classifier_failed",
} as const;

export type ApiCode = (typeof API_CODES)[keyof typeof API_CODES];
