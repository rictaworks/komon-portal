import { env } from "cloudflare:test";
import type { Hono } from "hono";
import type { HumanVerifier, Identity, IdentityProvider } from "../../src/app/adapters/identity-provider";
import { IdentityError } from "../../src/app/adapters/identity-provider";
import { CryptoIdGenerator } from "../../src/app/adapters/system-clock";
import { createApp, type AppBindings } from "../../src/app/api/app";
import type { AdapterOverrides } from "../../src/app/api/composition";
import type { AppEnv } from "../../src/app/env";
import { FixedClock } from "./builders";
import { RecordingNotifier } from "./intake-kit";

export const ORIGIN = "https://portal.test";

export class StubIdentity implements IdentityProvider {
  identity: Identity = { sub: "google-sub-1", displayName: "K. Tanabe" };
  lastExchange: { code: string; codeVerifier: string; redirectUri: string; expectedNonce: string } | null = null;
  fail = false;

  authorizationUrl(request: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...request, scope: "openid profile" }).toString()}`;
  }

  async exchange(exchange: { code: string; codeVerifier: string; redirectUri: string; expectedNonce: string }): Promise<Identity> {
    this.lastExchange = exchange;
    if (this.fail) {
      throw new IdentityError("id_token_invalid");
    }
    return this.identity;
  }
}

export class StubHumans implements HumanVerifier {
  pass = true;
  seen: string[] = [];

  async verify(token: string): Promise<boolean> {
    this.seen.push(token);
    return this.pass;
  }
}

export interface CallOptions {
  body?: unknown;
  /** Raw body for uploads. */
  form?: FormData;
  origin?: string | null;
  csrf?: string | null;
  headers?: Record<string, string>;
  env?: Partial<AppEnv>;
}

/** A browser-like client: keeps cookies, sends Origin and the CSRF token. */
export class ApiClient {
  cookies = new Map<string, string>();
  csrfToken: string | null = null;

  constructor(
    private readonly app: Hono<AppBindings>,
    private readonly baseEnv: Partial<AppEnv> = {},
  ) {}

  async call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (this.cookies.size > 0) {
      headers.set("Cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    if (method !== "GET") {
      const origin = options.origin === undefined ? ORIGIN : options.origin;
      if (origin !== null) {
        headers.set("Origin", origin);
      }
      const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
      if (csrf !== null) {
        headers.set("X-CSRF-Token", csrf);
      }
    }
    let body: BodyInit | null = null;
    if (options.form !== undefined) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    const response = await this.app.request(`${ORIGIN}${path}`, { method, headers, body, redirect: "manual" }, { ...env, ...this.baseEnv, ...options.env });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = (pair ?? "").indexOf("=");
      const name = (pair ?? "").slice(0, separator);
      const value = (pair ?? "").slice(separator + 1);
      if (value === "" || /max-age=0/i.test(cookie)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    return response;
  }

  /** Signs in through the development sign-in and loads the CSRF token. */
  async signIn(role: "owner" | "staff" | "member"): Promise<{ userId: string }> {
    const response = await this.call("POST", "/api/dev/login", { body: { role }, csrf: null });
    if (response.status !== 200) {
      throw new Error(`development sign-in failed: ${response.status}`);
    }
    const me = (await (await this.call("GET", "/api/me")).json()) as { user: { id: string }; csrfToken: string };
    this.csrfToken = me.csrfToken;
    return { userId: me.user.id };
  }
}

export interface ApiKit {
  app: Hono<AppBindings>;
  clock: FixedClock;
  identity: StubIdentity;
  humans: StubHumans;
  notifier: RecordingNotifier;
  overrides: AdapterOverrides;
  client(baseEnv?: Partial<AppEnv>): ApiClient;
}

export function apiKit(extra: AdapterOverrides = {}): ApiKit {
  const clock = new FixedClock();
  const identity = new StubIdentity();
  const humans = new StubHumans();
  const notifier = new RecordingNotifier();
  const overrides: AdapterOverrides = { clock, ids: new CryptoIdGenerator(), identity, humans, notifier, ...extra };
  const app = createApp(overrides);
  return { app, clock, identity, humans, notifier, overrides, client: (baseEnv = {}) => new ApiClient(app, baseEnv) };
}
