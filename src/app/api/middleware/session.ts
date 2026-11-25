import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { secretsEqual } from "../../../core/access/secret-compare";
import { CSRF_HEADER, SESSION } from "../../config/app-config";
import { buildServices, type AdapterOverrides } from "../composition";
import { HttpError, type AppBindings } from "../context";

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

/**
 * Records the weekly activity of the signed-in user (once per client and ISO week, see MetricRecorder). Runs for requests
 * that passed the state-change guard, so a refused request is not counted. Recording failures stop the request.
 */
export function recordActivity(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (auth !== undefined) {
      await c.get("services").metrics.recordWeeklyActivity(auth.actor);
    }
    await next();
  };
}

/**
 * State-changing requests must come from this origin, and, once signed in, carry the session's
 * CSRF token. A request without an Origin header is refused. The error handler writes these
 * refusals to the audit log, also when nobody is signed in.
 */
export function protectStateChanges(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const auth = c.get("auth");
      if (c.req.header("Origin") !== new URL(c.req.url).origin) {
        throw new HttpError(403, "bad_origin");
      }
      if (auth !== undefined && !(await secretsEqual(c.req.header(CSRF_HEADER) ?? "", auth.session.csrfToken))) {
        throw new HttpError(403, "bad_csrf");
      }
    }
    await next();
  };
}
