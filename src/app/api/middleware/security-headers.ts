import type { MiddlewareHandler } from "hono";
import { loadWebAnalyticsToken, WEB_ANALYTICS } from "../../config/app-config";
import type { AppBindings } from "../context";
import { handleError } from "./errors";

const GOOGLE = "https://accounts.google.com";
const TURNSTILE = "https://challenges.cloudflare.com";

/**
 * External scripts are allowed for Google sign-in and Turnstile only (instructions.md 1.10). When
 * Cloudflare Web Analytics is switched on (instructions.md 1.12), its beacon script and its
 * reporting endpoint are allowed as well, and nothing else.
 */
export function contentSecurityPolicy(webAnalyticsToken: string | undefined): string {
  const analytics = webAnalyticsToken !== undefined;
  return [
    "default-src 'self'",
    `script-src 'self' ${GOOGLE} ${TURNSTILE}${analytics ? ` ${WEB_ANALYTICS.scriptOrigin}` : ""}`,
    `frame-src ${GOOGLE} ${TURNSTILE}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${analytics ? ` ${WEB_ANALYTICS.reportOrigin}` : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${GOOGLE}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

const FIXED_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Adds the security headers to every response, including static assets and errors. A malformed
 * Web Analytics token stops the request with an error that still carries the headers.
 */
export function securityHeaders(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let webAnalyticsToken: string | undefined;
    let invalid: Error | undefined;
    try {
      webAnalyticsToken = loadWebAnalyticsToken(c.env);
    } catch (error) {
      invalid = error instanceof Error ? error : new Error(String(error));
    }
    if (invalid === undefined) {
      await next();
    } else {
      c.res = await handleError(invalid, c);
    }
    c.res.headers.set("Content-Security-Policy", contentSecurityPolicy(webAnalyticsToken));
    for (const [name, value] of Object.entries(FIXED_SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      c.res.headers.set("Cache-Control", "no-store");
    }
  };
}
