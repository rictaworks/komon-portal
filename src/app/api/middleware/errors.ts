import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError, type DomainErrorCode } from "../../../core/model/errors";
import { IdentityError } from "../../adapters/identity-provider";
import { API_CODES } from "../codes";
import { HttpError, type AppContext } from "../context";

const DOMAIN_STATUS: Readonly<Record<DomainErrorCode, ContentfulStatusCode>> = {
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 400,
  invalid_state: 422,
};

function isActiveStaff(c: AppContext): boolean {
  const auth = c.get("auth");
  return auth !== undefined && c.get("services").policy.can(auth.actor, "staff.operate");
}

/**
 * Maps errors to stable codes. Anyone who is not active office staff receives "not found" for a
 * forbidden resource, so a rewritten client ID reveals nothing about what exists.
 */
export function handleError(error: Error, c: AppContext): Response {
  if (error instanceof HttpError) {
    return c.json(error.detail === undefined ? { error: error.code } : { error: error.code, detail: error.detail }, error.status);
  }
  if (error instanceof DomainError) {
    if (error.code === "forbidden" && !isActiveStaff(c)) {
      return c.json({ error: API_CODES.notFound }, 404);
    }
    return c.json({ error: error.code, detail: error.detail }, DOMAIN_STATUS[error.code]);
  }
  if (error instanceof IdentityError) {
    return c.json({ error: API_CODES.signInFailed }, 400);
  }
  console.error(JSON.stringify({ event: "unhandled_error", path: new URL(c.req.url).pathname, name: error.name, message: error.message }));
  return c.json({ error: API_CODES.internalError }, 500);
}
