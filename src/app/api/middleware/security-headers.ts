import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../context";

const GOOGLE = "https://accounts.google.com";
const TURNSTILE = "https://challenges.cloudflare.com";

/** External scripts are allowed for Google sign-in and Turnstile only (instructions.md 1.10). */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${GOOGLE} ${TURNSTILE}`,
  `frame-src ${GOOGLE} ${TURNSTILE}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${GOOGLE}`,
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Adds the security headers to every response, including static assets and errors. */
export function securityHeaders(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      c.res.headers.set("Cache-Control", "no-store");
    }
  };
}
