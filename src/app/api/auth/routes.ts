import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secretsEqual } from "../../../core/access/secret-compare";
import type { User } from "../../../core/model/types";
import { OIDC, SESSION } from "../../config/app-config";
import { API_CODES } from "../codes";
import type { Services } from "../composition";
import { HttpError, requireAuth, type AppBindings, type AppContext, type AuthContext } from "../context";
import { readJson, requireEnum, requireString } from "../input";
import { codeChallenge, safeReturnPath } from "./pkce";

interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

const COOKIE_BASE = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;
const TOKEN_BYTES = 32;
const DEV_ROLES = ["owner", "staff", "member"] as const;
const DEV_CLIENT = { id: "dev-client", code: "DEMO01", corporateName: "Demo Client" } as const;
const MAX_CODE_LENGTH = 512;

function callbackUrl(c: AppContext): string {
  return `${new URL(c.req.url).origin}/api/auth/callback`;
}

function parseOidcState(raw: string | undefined): OidcState | null {
  if (raw === undefined) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<OidcState>;
    const complete = [value.state, value.nonce, value.verifier, value.returnTo].every((part) => typeof part === "string" && part !== "");
    return complete ? (value as OidcState) : null;
  } catch {
    return null;
  }
}

async function startSession(c: AppContext, services: Services, user: User): Promise<void> {
  const session = await services.sessions.create(user.id);
  setCookie(c, SESSION.cookieName, session.token, { ...COOKIE_BASE, maxAge: SESSION.lifetimeHours * 60 * 60 });
  await services.audit.record(await services.actors.load(user), "auth.login", "user", user.id);
}

/** Finds the user for a sign-in or creates one. Only the subject and the display name are kept. */
async function upsertUser(services: Services, sub: string, displayName: string): Promise<User> {
  const existing = await services.repository.users.findByGoogleSub(sub);
  if (existing !== null) {
    if (existing.displayName !== displayName) {
      await services.repository.users.updateDisplayName(existing.id, displayName);
    }
    return { ...existing, displayName };
  }
  const created: User = { id: services.ids.newId(), googleSub: sub, displayName, officeRole: null, officeStatus: null, createdAt: services.clock.now() };
  await services.repository.users.insert(created);
  return created;
}

async function requireHuman(services: Services, token: string): Promise<void> {
  if (services.humans === null) {
    throw new HttpError(503, API_CODES.notConfigured, "turnstile");
  }
  if (!(await services.humans.verify(token))) {
    throw new HttpError(403, API_CODES.humanCheckFailed);
  }
}

/** Development only: signs in as a ready-made test user so that screens can be exercised without Google. */
async function developmentUser(services: Services, role: (typeof DEV_ROLES)[number]): Promise<User> {
  const user = await upsertUser(services, `dev-${role}`, `Dev ${role}`);
  if (role === "member") {
    if ((await services.repository.clients.findById(DEV_CLIENT.id)) === null) {
      await services.repository.clients.insert({ ...DEV_CLIENT, corporateNumber: null, status: "Active", version: 1 });
    }
    if ((await services.repository.memberships.findOngoing(user.id, DEV_CLIENT.id)) === null) {
      await services.repository.memberships.insert({
        id: services.ids.newId(), userId: user.id, clientId: DEV_CLIENT.id, status: "Active", approvedBy: null,
        approvedAt: services.clock.now(), createdAt: services.clock.now(),
      });
    }
    return user;
  }
  if (user.officeStatus !== "Active") {
    const active: User = { ...user, officeRole: role === "owner" ? "Owner" : "Staff", officeStatus: "Active" };
    await services.repository.users.transitionOffice(active, user.officeStatus);
    return active;
  }
  return user;
}

async function describeSession(services: Services, auth: AuthContext): Promise<Record<string, unknown>> {
  const memberships = [];
  for (const membership of auth.actor.memberships) {
    const client = await services.repository.clients.findById(membership.clientId);
    const reachable = services.policy.can(auth.actor, "client.read", { clientId: membership.clientId });
    memberships.push({
      clientId: membership.clientId,
      status: membership.status,
      // Name and code are shown only for clients the member can actually reach.
      code: reachable ? (client?.code ?? null) : null,
      corporateName: reachable ? (client?.corporateName ?? null) : null,
      clientStatus: reachable ? membership.clientStatus : null,
    });
  }
  return {
    user: { id: auth.user.id, displayName: auth.user.displayName, officeRole: auth.user.officeRole, officeStatus: auth.user.officeStatus },
    memberships,
    csrfToken: auth.session.csrfToken,
  };
}

export function authRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/config", async (c) => {
    const services = c.get("services");
    return c.json({
      environment: services.config.environment,
      turnstileSiteKey: services.config.turnstileSiteKey ?? null,
      signInAvailable: services.identity !== null,
      setupOpen: await services.setup.isOpen(),
    });
  });

  routes.get("/auth/login", async (c) => {
    const services = c.get("services");
    if (services.identity === null) {
      throw new HttpError(503, API_CODES.notConfigured, "google");
    }
    const oidc: OidcState = {
      state: services.ids.randomToken(TOKEN_BYTES),
      nonce: services.ids.randomToken(TOKEN_BYTES),
      verifier: services.ids.randomToken(TOKEN_BYTES),
      returnTo: safeReturnPath(c.req.query("return")),
    };
    setCookie(c, OIDC.cookieName, JSON.stringify(oidc), { ...COOKIE_BASE, maxAge: OIDC.cookieMaxAgeSeconds });
    return c.redirect(
      services.identity.authorizationUrl({
        redirectUri: callbackUrl(c),
        state: oidc.state,
        nonce: oidc.nonce,
        codeChallenge: await codeChallenge(oidc.verifier),
      }),
    );
  });

  routes.get("/auth/callback", async (c) => {
    const services = c.get("services");
    const oidc = parseOidcState(getCookie(c, OIDC.cookieName));
    deleteCookie(c, OIDC.cookieName, COOKIE_BASE);
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    if (services.identity === null || oidc === null || code === undefined || !(await secretsEqual(state, oidc.state))) {
      throw new HttpError(400, API_CODES.signInFailed);
    }
    const identity = await services.identity.exchange({
      code,
      codeVerifier: oidc.verifier,
      redirectUri: callbackUrl(c),
      expectedNonce: oidc.nonce,
    });
    await startSession(c, services, await upsertUser(services, identity.sub, identity.displayName));
    return c.redirect(oidc.returnTo);
  });

  routes.post("/auth/logout", async (c) => {
    const auth = c.get("auth");
    if (auth !== undefined) {
      await c.get("services").sessions.destroy(auth.token);
      await c.get("services").audit.record(auth.actor, "auth.logout", "user", auth.user.id);
    }
    deleteCookie(c, SESSION.cookieName, COOKIE_BASE);
    return c.json({ status: API_CODES.ok });
  });

  routes.get("/me", async (c) => c.json(await describeSession(c.get("services"), requireAuth(c))));

  // Same content as /me, but answers 200 with null when nobody is signed in, so that a page can ask without causing an error.
  routes.get("/session", async (c) => {
    const auth = c.get("auth");
    return c.json({ me: auth === undefined ? null : await describeSession(c.get("services"), auth) });
  });

  routes.post("/setup/claim", async (c) => {
    const auth = requireAuth(c);
    const services = c.get("services");
    const body = await readJson(c);
    await requireHuman(services, requireString(body, "turnstileToken", 4096));
    const owner = await services.setup.claimOwner(auth.user, requireString(body, "token", MAX_CODE_LENGTH));
    return c.json({ officeRole: owner.officeRole, officeStatus: owner.officeStatus });
  });

  routes.post("/invitations/redeem", async (c) => {
    const auth = requireAuth(c);
    const services = c.get("services");
    const body = await readJson(c);
    await requireHuman(services, requireString(body, "turnstileToken", 4096));
    const invitation = await services.invitations.redeem(auth.user, requireString(body, "code", MAX_CODE_LENGTH));
    return c.json({ status: "pending", targetType: invitation.targetType });
  });

  routes.post("/dev/login", async (c) => {
    const services = c.get("services");
    if (!services.config.isDevelopment) {
      throw new HttpError(404, API_CODES.notFound);
    }
    const role = requireEnum(await readJson(c), "role", DEV_ROLES);
    await startSession(c, services, await developmentUser(services, role));
    return c.json({ status: API_CODES.ok });
  });

  return routes;
}
