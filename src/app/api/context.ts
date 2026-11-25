import type { Context } from "hono";
import type { UserActor } from "../../core/model/actor";
import type { User } from "../../core/model/types";
import type { ActiveSession } from "../adapters/session-store";
import type { AppEnv } from "../env";
import type { Services } from "./composition";

export interface AuthContext {
  user: User;
  actor: UserActor;
  session: ActiveSession;
  token: string;
}

export type AppBindings = {
  Bindings: AppEnv;
  Variables: {
    services: Services;
    /** Set by the session middleware when the request carries a valid session. */
    auth: AuthContext | undefined;
  };
};

export type AppContext = Context<AppBindings>;

/** Raised by handlers to answer with a specific status and stable code. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(`${status} ${code}`);
    this.name = "HttpError";
  }
}

/** The signed-in user of this request. Answers 401 when there is none. */
export function requireAuth(c: AppContext): AuthContext {
  const auth = c.get("auth");
  if (auth === undefined) {
    throw new HttpError(401, "unauthenticated");
  }
  return auth;
}
