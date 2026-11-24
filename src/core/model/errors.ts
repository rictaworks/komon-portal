export const DOMAIN_ERROR_CODES = ["forbidden", "not_found", "conflict", "invalid_input", "invalid_state"] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Error raised by the Domain Core. `code` is the stable category, `detail` a stable
 * machine-readable reason (never display text).
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly detail: string;

  constructor(code: DomainErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "DomainError";
    this.code = code;
    this.detail = detail;
  }
}

export function forbidden(detail: string): DomainError {
  return new DomainError("forbidden", detail);
}

export function notFound(detail: string): DomainError {
  return new DomainError("not_found", detail);
}

export function conflict(detail: string): DomainError {
  return new DomainError("conflict", detail);
}

export function invalidInput(detail: string): DomainError {
  return new DomainError("invalid_input", detail);
}

export function invalidState(detail: string): DomainError {
  return new DomainError("invalid_state", detail);
}
