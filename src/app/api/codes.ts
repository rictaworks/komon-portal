/** Stable machine-readable codes returned by the API. Display text lives in src/locales. */
export const API_CODES = {
  ok: "ok",
  notFound: "not_found",
  internalError: "internal_error",
} as const;

export type ApiCode = (typeof API_CODES)[keyof typeof API_CODES];
