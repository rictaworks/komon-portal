import type { AppEnv } from "../env";

export const ENVIRONMENTS = ["development", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface AppConfig {
  environment: Environment;
  isDevelopment: boolean;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  turnstileSiteKey: string | undefined;
  turnstileSecretKey: string | undefined;
  setupToken: string | undefined;
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  /** Operator contact sent to push services (mailto: or https: URL). */
  vapidSubject: string | undefined;
  /** Cloudflare Web Analytics site token; page views are counted only when it is set. */
  webAnalyticsToken: string | undefined;
}

/** Cloudflare Web Analytics (instructions.md 1.12): the beacon script and the endpoint it reports to. It sets no cookie. */
export const WEB_ANALYTICS = {
  scriptOrigin: "https://static.cloudflareinsights.com",
  scriptUrl: "https://static.cloudflareinsights.com/beacon.min.js",
  reportOrigin: "https://cloudflareinsights.com",
} as const;

const WEB_ANALYTICS_TOKEN_PATTERN = /^[A-Za-z0-9]{1,128}$/;

export const SESSION = {
  cookieName: "__Host-kp_session",
  idleMinutes: 60,
  lifetimeHours: 12,
  tokenBytes: 32,
  /** The last-seen time is rewritten at most this often. */
  touchSeconds: 60,
} as const;

export const OIDC = {
  cookieName: "__Host-kp_oidc",
  cookieMaxAgeSeconds: 600,
  scope: "openid profile",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
} as const;

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const CSRF_HEADER = "X-CSRF-Token";

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Reads the Web Analytics token. Unset or empty means the measurement is off. A value that is not
 * letters and digits is an error: it is written into the page, so it is never passed on unchecked.
 */
export function loadWebAnalyticsToken(env: Pick<AppEnv, "WEB_ANALYTICS_TOKEN">): string | undefined {
  const token = emptyToUndefined(env.WEB_ANALYTICS_TOKEN);
  if (token !== undefined && !WEB_ANALYTICS_TOKEN_PATTERN.test(token)) {
    throw new Error("WEB_ANALYTICS_TOKEN must contain only letters and digits");
  }
  return token;
}

/** Reads the configuration. An unknown environment name is an error, never silently treated as production or development. */
export function loadConfig(env: AppEnv): AppConfig {
  const environment = ENVIRONMENTS.find((candidate) => candidate === env.ENVIRONMENT);
  if (environment === undefined) {
    throw new Error("ENVIRONMENT must be development or production");
  }
  return {
    environment,
    isDevelopment: environment === "development",
    googleClientId: emptyToUndefined(env.GOOGLE_CLIENT_ID),
    googleClientSecret: emptyToUndefined(env.GOOGLE_CLIENT_SECRET),
    turnstileSiteKey: emptyToUndefined(env.TURNSTILE_SITE_KEY),
    turnstileSecretKey: emptyToUndefined(env.TURNSTILE_SECRET_KEY),
    setupToken: emptyToUndefined(env.SETUP_TOKEN),
    vapidPublicKey: emptyToUndefined(env.VAPID_PUBLIC_KEY),
    vapidPrivateKey: emptyToUndefined(env.VAPID_PRIVATE_KEY),
    vapidSubject: emptyToUndefined(env.VAPID_SUBJECT),
    webAnalyticsToken: loadWebAnalyticsToken(env),
  };
}
