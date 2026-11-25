import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { D1Repository } from "../../../src/app/adapters/d1/d1-repository";
import { apiKit, ORIGIN, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

const SETUP_TOKEN = "setup-token-0123456789-abcdef";

describe("authentication", () => {
  let kit: ApiKit;
  let client: ApiClient;
  let repository: D1Repository;
  let serial = 0;

  beforeAll(async () => {
    repository = new D1Repository(await migrate());
  });

  beforeEach(() => {
    kit = apiKit();
    client = kit.client();
    serial += 1;
    kit.identity.identity = { sub: `google-sub-${serial}`, displayName: "K. Tanabe" };
  });

  /** Audit rows of one action and result, oldest first (the database is shared by the tests of this file). */
  async function auditRows(action: string, result: string): Promise<Record<string, unknown>[]> {
    const rows = await env.DB
      .prepare("SELECT actor_user_id, target_type, target_id FROM audit_log WHERE action = ? AND result = ? ORDER BY rowid")
      .bind(action, result)
      .all<Record<string, unknown>>();
    return rows.results;
  }

  async function googleSignIn(target: ApiClient = client, returnTo?: string): Promise<Response> {
    const start = await target.call("GET", `/api/auth/login${returnTo === undefined ? "" : `?return=${encodeURIComponent(returnTo)}`}`);
    const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    return target.call("GET", `/api/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`);
  }

  describe("Google sign-in", () => {
    it("redirects to Google asking for openid and profile only", async () => {
      const response = await client.call("GET", "/api/auth/login");
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      expect(location.origin).toBe("https://accounts.google.com");
      expect(location.searchParams.get("scope")).toBe("openid profile");
      expect(location.searchParams.get("redirectUri")).toBe(`${ORIGIN}/api/auth/callback`);
      expect(location.searchParams.get("state")?.length).toBeGreaterThanOrEqual(32);
      expect(location.searchParams.get("nonce")?.length).toBeGreaterThanOrEqual(32);
      expect(location.searchParams.get("codeChallenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-kp_oidc=")) ?? "";
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it("creates the user from sub and display name and starts a session", async () => {
      const response = await googleSignIn();
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/");
      const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-kp_session=")) ?? "";
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//i);
      expect(cookie).toMatch(/Max-Age=43200/i);
      const stored = await repository.users.findByGoogleSub(kit.identity.identity.sub);
      expect(stored).toMatchObject({ displayName: "K. Tanabe", officeRole: null, officeStatus: null });
      expect(kit.identity.lastExchange).toMatchObject({ code: "auth-code", redirectUri: `${ORIGIN}/api/auth/callback` });
      const me = (await (await client.call("GET", "/api/me")).json()) as { user: { id: string; displayName: string }; memberships: unknown[]; csrfToken: string };
      expect(me.user).toMatchObject({ id: stored?.id, displayName: "K. Tanabe" });
      expect(me.memberships).toEqual([]);
      expect(me.csrfToken.length).toBeGreaterThanOrEqual(32);
      expect(JSON.stringify(me)).not.toContain(kit.identity.identity.sub);
    });

    it("stores only a hash of the session token", async () => {
      await googleSignIn();
      const token = client.cookies.get("__Host-kp_session") ?? "";
      const rows = await env.DB.prepare("SELECT id FROM sessions").all<{ id: string }>();
      expect(rows.results.map((row) => row.id)).not.toContain(token);
    });

    it("keeps the display name current and reuses the user", async () => {
      await googleSignIn();
      kit.identity.identity = { ...kit.identity.identity, displayName: "Kei Tanabe" };
      await googleSignIn(kit.client());
      const rows = await env.DB.prepare("SELECT display_name FROM users WHERE google_sub = ?").bind(kit.identity.identity.sub).all<{ display_name: string }>();
      expect(rows.results).toEqual([{ display_name: "Kei Tanabe" }]);
    });

    it("returns to the requested page but never to another site", async () => {
      expect((await googleSignIn(kit.client(), "/documents?month=2026-11")).headers.get("Location")).toBe("/documents?month=2026-11");
      for (const target of ["//evil.example", "https://evil.example/", "/\\evil.example", "evil", "/api/auth/logout", "/\t/evil.example", "/\n/evil.example", "/./api/x"]) {
        expect((await googleSignIn(kit.client(), target)).headers.get("Location")).toBe("/");
      }
    });

    it("refuses a callback whose state does not match, has no cookie, or fails verification", async () => {
      await client.call("GET", "/api/auth/login");
      const wrong = await client.call("GET", "/api/auth/callback?code=x&state=forged");
      expect(wrong.status).toBe(400);
      expect(await wrong.json()).toEqual({ error: "sign_in_failed" });
      const noCookie = await kit.client().call("GET", "/api/auth/callback?code=x&state=anything");
      expect(noCookie.status).toBe(400);
      kit.identity.fail = true;
      const failed = await googleSignIn(kit.client());
      expect(failed.status).toBe(400);
      expect(await failed.json()).toEqual({ error: "sign_in_failed" });
      expect(failed.headers.getSetCookie().some((value) => value.startsWith("__Host-kp_session="))).toBe(false);
    });

    it("ends the previous session when the same browser signs in again", async () => {
      await googleSignIn();
      const first = client.cookies.get("__Host-kp_session") ?? "";
      await googleSignIn();
      const rows = await env.DB.prepare("SELECT id FROM sessions").all<{ id: string }>();
      expect(rows.results.map((row) => row.id)).not.toContain(first);
    });

    it("records a state-changing request denied for a bad origin when the actor is signed in", async () => {
      await googleSignIn();
      const denied = await client.call("POST", "/api/auth/logout", { origin: "https://evil.example" });
      expect(denied.status).toBe(403);
      const rows = await env.DB.prepare("SELECT action, result FROM audit_log WHERE action = 'request.bad_origin'").all<{ action: string; result: string }>();
      expect(rows.results).toEqual([{ action: "request.bad_origin", result: "denied" }]);
    });

    it("records a refused sign-in as denied, with no actor and nothing the caller sent", async () => {
      const before = await auditRows("auth.login", "denied");
      await client.call("GET", "/api/auth/login");
      expect((await client.call("GET", "/api/auth/callback?code=x&state=forged-by-caller")).status).toBe(400);
      kit.identity.fail = true;
      expect((await googleSignIn(kit.client())).status).toBe(400);
      const rows = (await auditRows("auth.login", "denied")).slice(before.length);
      expect(rows).toEqual([
        { actor_user_id: null, target_type: "request", target_id: "sign_in" },
        { actor_user_id: null, target_type: "request", target_id: "sign_in" },
      ]);
    });

    it("cannot replay a used state", async () => {
      const start = await client.call("GET", "/api/auth/login");
      const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state") ?? "";
      expect((await client.call("GET", `/api/auth/callback?code=a&state=${state}`)).status).toBe(302);
      expect((await client.call("GET", `/api/auth/callback?code=a&state=${state}`)).status).toBe(400);
    });
  });

  describe("sessions", () => {
    it("answers 401 without a session", async () => {
      const response = await client.call("GET", "/api/me");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    });

    it("answers the session question with 200 and null when nobody is signed in", async () => {
      const anonymous = await client.call("GET", "/api/session");
      expect(anonymous.status).toBe(200);
      expect(await anonymous.json()).toEqual({ me: null });
      await client.signIn("staff");
      const signedIn = (await (await client.call("GET", "/api/session")).json()) as { me: { user: { officeRole: string }; csrfToken: string } };
      expect(signedIn.me.user.officeRole).toBe("Staff");
      expect(signedIn.me.csrfToken).toBe(client.csrfToken);
    });

    it("ends after 60 idle minutes", async () => {
      await googleSignIn();
      kit.clock.current = new Date(kit.clock.current.getTime() + 59 * 60 * 1000);
      expect((await client.call("GET", "/api/me")).status).toBe(200);
      kit.clock.current = new Date(kit.clock.current.getTime() + 59 * 60 * 1000);
      expect((await client.call("GET", "/api/me")).status).toBe(200);
      kit.clock.current = new Date(kit.clock.current.getTime() + 60 * 60 * 1000);
      expect((await client.call("GET", "/api/me")).status).toBe(401);
    });

    it("ends 12 hours after sign-in even when used all the time", async () => {
      await googleSignIn();
      for (let step = 0; step < 14; step += 1) {
        kit.clock.current = new Date(kit.clock.current.getTime() + 50 * 60 * 1000);
        expect((await client.call("GET", "/api/me")).status).toBe(200);
      }
      kit.clock.current = new Date(kit.clock.current.getTime() + 50 * 60 * 1000);
      expect((await client.call("GET", "/api/me")).status).toBe(401);
    });

    it("signs out and invalidates the session on the server", async () => {
      await client.signIn("staff");
      const token = client.cookies.get("__Host-kp_session") ?? "";
      expect((await client.call("POST", "/api/auth/logout")).status).toBe(200);
      expect(client.cookies.has("__Host-kp_session")).toBe(false);
      client.cookies.set("__Host-kp_session", token);
      expect((await client.call("GET", "/api/me")).status).toBe(401);
    });

    it("ends every session of a user whose access is revoked", async () => {
      const { userId } = await client.signIn("staff");
      await repository.sessions.revokeAllForUser(userId);
      expect((await client.call("GET", "/api/me")).status).toBe(401);
    });
  });

  describe("state-changing requests", () => {
    it("are recorded as denied when refused, also when nobody is signed in", async () => {
      const anonymous = kit.client();
      const before = (await auditRows("request.bad_origin", "denied")).length;
      const denied = await anonymous.call("POST", "/api/auth/logout", { origin: "https://evil.example", csrf: null });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "bad_origin" });
      expect((await auditRows("request.bad_origin", "denied")).slice(before)).toEqual([
        { actor_user_id: null, target_type: "request", target_id: "state_change" },
      ]);

      const { userId } = await client.signIn("staff");
      const csrfBefore = (await auditRows("request.bad_csrf", "denied")).length;
      expect((await client.call("POST", "/api/auth/logout", { csrf: "wrong" })).status).toBe(403);
      expect((await auditRows("request.bad_csrf", "denied")).slice(csrfBefore)).toEqual([
        { actor_user_id: userId, target_type: "request", target_id: "state_change" },
      ]);
    });

    it("are recorded as denied when the session is missing or unknown", async () => {
      const before = (await auditRows("request.unauthenticated", "denied")).length;
      const anonymous = kit.client();
      expect((await anonymous.call("POST", "/api/invitations/redeem", { body: { code: "x", turnstileToken: "t" }, csrf: null })).status).toBe(401);
      const stranger = kit.client();
      stranger.cookies.set("__Host-kp_session", "no-such-session");
      expect((await stranger.call("GET", "/api/me")).status).toBe(401);
      expect((await auditRows("request.unauthenticated", "denied")).slice(before)).toEqual([
        { actor_user_id: null, target_type: "request", target_id: "state_change" },
        { actor_user_id: null, target_type: "request", target_id: "read" },
      ]);
    });

    it("record a failed human check as denied for the signed-in user", async () => {
      const { userId } = await client.signIn("member");
      const before = (await auditRows("request.human_check_failed", "denied")).length;
      kit.humans.pass = false;
      const refused = await client.call("POST", "/api/invitations/redeem", { body: { code: "typed-by-user", turnstileToken: "bad" } });
      expect(refused.status).toBe(403);
      expect((await auditRows("request.human_check_failed", "denied")).slice(before)).toEqual([
        { actor_user_id: userId, target_type: "request", target_id: "state_change" },
      ]);
    });

    it("keep addresses and caller-supplied text out of the audit log", async () => {
      const marker = "caller-marker-7731";
      const anonymous = kit.client();
      await anonymous.call("POST", `/api/office/${marker}`, { origin: `https://${marker}.example`, csrf: null, body: { note: marker }, headers: { "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "203.0.113.9" } });
      await anonymous.call("GET", `/api/me?${marker}=1`, { headers: { "CF-Connecting-IP": "203.0.113.9" } });
      const rows = await env.DB.prepare("SELECT * FROM audit_log").all<Record<string, unknown>>();
      const dump = JSON.stringify(rows.results);
      expect(dump).not.toContain(marker);
      expect(dump).not.toContain("203.0.113.9");
    });

    it("require this origin", async () => {
      await client.signIn("staff");
      for (const origin of [null, "https://evil.example", "http://portal.test"]) {
        const response = await client.call("POST", "/api/auth/logout", { origin });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "bad_origin" });
      }
      expect((await client.call("GET", "/api/me")).status).toBe(200);
    });

    it("require the CSRF token of the session", async () => {
      await client.signIn("staff");
      for (const csrf of [null, "wrong", ""]) {
        const response = await client.call("POST", "/api/auth/logout", { csrf });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "bad_csrf" });
      }
      const other = kit.client();
      await other.signIn("owner");
      expect((await client.call("POST", "/api/auth/logout", { csrf: other.csrfToken })).status).toBe(403);
      expect((await client.call("POST", "/api/auth/logout")).status).toBe(200);
    });
  });

  describe("environment", () => {
    it("offers the development sign-in only in development", async () => {
      const production = kit.client({ ENVIRONMENT: "production" });
      const response = await production.call("POST", "/api/dev/login", { body: { role: "owner" }, csrf: null });
      expect(response.status).toBe(404);
      expect(production.cookies.size).toBe(0);
      const config = (await (await production.call("GET", "/api/config")).json()) as { environment: string };
      expect(config.environment).toBe("production");
      expect((await client.call("POST", "/api/dev/login", { body: { role: "owner" }, csrf: null })).status).toBe(200);
      expect((await kit.client().call("POST", "/api/dev/login", { body: { role: "root" }, csrf: null })).status).toBe(400);
    });

    it("gives the development users the roles they are named after", async () => {
      await client.signIn("member");
      const me = (await (await client.call("GET", "/api/me")).json()) as { user: { officeRole: string | null }; memberships: { code: string; status: string }[] };
      expect(me.user.officeRole).toBeNull();
      expect(me.memberships).toEqual([expect.objectContaining({ code: "DEMO01", status: "Active", clientStatus: "Active" })]);
      const owner = kit.client();
      await owner.signIn("owner");
      const ownerMe = (await (await owner.call("GET", "/api/me")).json()) as { user: { officeRole: string; officeStatus: string } };
      expect(ownerMe.user).toMatchObject({ officeRole: "Owner", officeStatus: "Active" });
    });

    it("fails loudly on an unknown environment name", async () => {
      const response = await kit.client({ ENVIRONMENT: "staging" }).call("GET", "/api/config");
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
    });

    it("reports what is configured without exposing secrets", async () => {
      const response = await kit.client({ TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key", GOOGLE_CLIENT_SECRET: "g-secret", SETUP_TOKEN }).call("GET", "/api/config");
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ environment: "development", turnstileSiteKey: "site-key", signInAvailable: true });
      expect(text).not.toContain("secret-key");
      expect(text).not.toContain("g-secret");
      expect(text).not.toContain(SETUP_TOKEN);
    });
  });

  describe("security headers", () => {
    it("are set on API responses, errors and unknown paths", async () => {
      for (const path of ["/api/health", "/api/me", "/api/unknown"]) {
        const response = await client.call("GET", path);
        const csp = response.headers.get("Content-Security-Policy") ?? "";
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("script-src 'self' https://accounts.google.com https://challenges.cloudflare.com");
        expect(csp).not.toContain("unsafe-inline");
        expect(csp).not.toContain("unsafe-eval");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    });
  });

  describe("first-time setup and invitations", () => {
    it("requires sign-in and a passed human check", async () => {
      const anonymous = await kit.client().call("POST", "/api/invitations/redeem", { body: { code: "x", turnstileToken: "t" }, csrf: null });
      expect(anonymous.status).toBe(401);
      await googleSignIn();
      const me = (await (await client.call("GET", "/api/me")).json()) as { csrfToken: string };
      client.csrfToken = me.csrfToken;
      kit.humans.pass = false;
      const refused = await client.call("POST", "/api/invitations/redeem", { body: { code: "x", turnstileToken: "bad" } });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "human_check_failed" });
      const missing = await client.call("POST", "/api/setup/claim", { body: { token: SETUP_TOKEN } });
      expect(missing.status).toBe(400);
      expect(kit.humans.seen).toEqual(["bad"]);
    });

    it("answers 503 when Turnstile is not configured instead of skipping the check", async () => {
      const bare = apiKit({ humans: undefined });
      const target = bare.client();
      await target.signIn("member");
      const response = await target.call("POST", "/api/invitations/redeem", { body: { code: "x", turnstileToken: "t" } });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured", detail: "turnstile" });
    });

    it("refuses an unknown invitation code with the uniform error", async () => {
      await googleSignIn();
      client.csrfToken = ((await (await client.call("GET", "/api/me")).json()) as { csrfToken: string }).csrfToken;
      const response = await client.call("POST", "/api/invitations/redeem", { body: { code: "no-such-code", turnstileToken: "ok" } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input", detail: "invitation" });
    });

    it("lets a signed-in user redeem an invitation and become pending", async () => {
      const staff = kit.client();
      const { userId } = await staff.signIn("staff");
      await repository.clients.insert({ id: `inv-client-${serial}`, code: `INV${serial}`, corporateName: "Invited", corporateNumber: null, status: "Active", version: 1 });
      const services = (await import("../../../src/app/api/composition")).buildServices({ ...env, ENVIRONMENT: "development" } as never, kit.overrides);
      const staffUser = await repository.users.findById(userId);
      if (staffUser === null) throw new Error("setup");
      const issued = await services.invitations.issue(await services.actors.load(staffUser), { type: "Client", clientId: `inv-client-${serial}` });
      await googleSignIn();
      client.csrfToken = ((await (await client.call("GET", "/api/me")).json()) as { csrfToken: string }).csrfToken;
      const response = await client.call("POST", "/api/invitations/redeem", { body: { code: issued.code, turnstileToken: "ok" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "pending", targetType: "Client" });
      const me = (await (await client.call("GET", "/api/me")).json()) as { memberships: unknown[] };
      expect(me.memberships).toEqual([{ clientId: `inv-client-${serial}`, status: "Pending", code: null, corporateName: null, clientStatus: null }]);
    });
  });
});
