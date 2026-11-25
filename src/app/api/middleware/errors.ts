import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError, type DomainErrorCode } from "../../../core/model/errors";
import { ClassifierError } from "../../../core/ports/classifier";
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REQUEST_TARGET = "request";
const SIGN_IN_ACTION = "auth.login";
const SIGN_IN_TARGET = "sign_in";

/**
 * The audit action of a refusal: a request refused for who is asking or where it comes from
 * (401, 403), or a refused sign-in. Null for every other error. The action is built from the
 * stable code of the error only.
 */
function refusalAction(error: Error): string | null {
  if (error instanceof IdentityError || (error instanceof HttpError && error.code === API_CODES.signInFailed)) {
    return SIGN_IN_ACTION;
  }
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return `request.${error.code}`;
  }
  return null;
}

/**
 * Writes a refusal to the audit log with result `denied`, also when nobody is signed in (the
 * actor is then empty). The entry holds the actor's ID and fixed words only: no address, no path
 * and nothing else the caller sent. Refusals decided inside the Domain Core are recorded there.
 *
 * A read refused because nobody is signed in is not recorded: it changes nothing, an expired
 * session in an open tab produces it all the time, and the log can never be trimmed. Refused
 * state changes and refused sign-ins are recorded for everyone.
 */
async function recordRefusal(error: Error, c: AppContext): Promise<void> {
  const action = refusalAction(error);
  if (action === null) {
    return;
  }
  const actor = c.get("auth")?.actor ?? null;
  if (actor === null && action !== SIGN_IN_ACTION && SAFE_METHODS.has(c.req.method)) {
    return;
  }
  const target = action === SIGN_IN_ACTION ? SIGN_IN_TARGET : SAFE_METHODS.has(c.req.method) ? "read" : "state_change";
  await c.get("services").audit.record(actor, action, REQUEST_TARGET, target, "denied");
}

/**
 * Maps errors to stable codes, after writing a refusal to the audit log. A refusal that cannot
 * be recorded is answered as an internal error; the request stays refused either way.
 */
export async function handleError(error: Error, c: AppContext): Promise<Response> {
  try {
    await recordRefusal(error, c);
  } catch (auditError) {
    const name = auditError instanceof Error ? auditError.name : "unknown";
    const message = auditError instanceof Error ? auditError.message : "unknown";
    console.error(JSON.stringify({ event: "refusal_not_recorded", path: new URL(c.req.url).pathname, name, message }));
    return c.json({ error: API_CODES.internalError }, 500);
  }
  return respond(error, c);
}

/**
 * Anyone who is not active office staff receives "not found" for a
 * forbidden resource, so a rewritten client ID reveals nothing about what exists.
 */
function respond(error: Error, c: AppContext): Response {
  if (error instanceof HttpError) {
    return c.json(error.detail === undefined ? { error: error.code } : { error: error.code, detail: error.detail }, error.status);
  }
  if (error instanceof DomainError) {
    if (error.code === "forbidden" && !isActiveStaff(c)) {
      return c.json({ error: API_CODES.notFound }, 404);
    }
    return c.json({ error: error.code, detail: error.detail }, DOMAIN_STATUS[error.code]);
  }
  if (error instanceof ClassifierError) {
    // Reported as it is; the files stay unclassified. The error never contains the key.
    return c.json({ error: API_CODES.classifierFailed, detail: error.code }, 502);
  }
  if (error instanceof IdentityError) {
    return c.json({ error: API_CODES.signInFailed }, 400);
  }
  console.error(JSON.stringify({ event: "unhandled_error", path: new URL(c.req.url).pathname, name: error.name, message: error.message }));
  return c.json({ error: API_CODES.internalError }, 500);
}
