import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { secretsEqual } from "../../../core/access/secret-compare";
import { CSRF_HEADER, SESSION } from "../../config/app-config";
import { buildServices, type AdapterOverrides } from "../composition";
import { HttpError, type AppBindings, type AuthContext } from "../context";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Builds the services for this request. */
export function withServices(overrides: AdapterOverrides): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    c.set("services", buildServices(c.env, overrides));
    c.set("auth", undefined);
    await next();
  };
}

/** Loads the signed-in user, if any. A session whose user no longer exists is ignored. */
export function loadSession(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const token = getCookie(c, SESSION.cookieName);
    if (token !== undefined && token !== "") {
      const services = c.get("services");
      const session = await services.sessions.find(token);
      const user = session === null ? null : await services.repository.users.findById(session.userId);
      if (session !== null && user !== null) {
        c.set("auth", { user, actor: await services.actors.load(user), session, token });
      }
    }
    await next();
  };
}

/** Denials are written to the audit log when the actor is known; anonymous requests have no actor to record. */
async function recordDenial(c: Context<AppBindings>, auth: AuthContext | undefined, action: string): Promise<void> {
  if (auth !== undefined) {
    await c.get("services").audit.record(auth.actor, action, "request", "state_change", "denied");
  }
}

/**
 * State-changing requests must come from this origin, and, once signed in, carry the session's
 * CSRF token. A request without an Origin header is refused.
 */
export function protectStateChanges(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const auth = c.get("auth");
      if (c.req.header("Origin") !== new URL(c.req.url).origin) {
        await recordDenial(c, auth, "request.bad_origin");
        throw new HttpError(403, "bad_origin");
      }
      if (auth !== undefined && !(await secretsEqual(c.req.header(CSRF_HEADER) ?? "", auth.session.csrfToken))) {
        await recordDenial(c, auth, "request.bad_csrf");
        throw new HttpError(403, "bad_csrf");
      }
    }
    await next();
  };
}
