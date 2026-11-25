import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { notificationRoutes } from "./client/notifications";
import { clientPortalRoutes } from "./client/routes";
import { loadWebAnalyticsToken, WEB_ANALYTICS } from "../config/app-config";
import { API_CODES } from "./codes";
import type { AdapterOverrides } from "./composition";
import type { AppBindings } from "./context";
import { fileContentRoutes } from "./files/routes";
import { handleError } from "./middleware/errors";
import { securityHeaders } from "./middleware/security-headers";
import { officeRoutes } from "./office";
import { loadSession, protectStateChanges, recordActivity, withServices } from "./middleware/session";

export type { AppBindings } from "./context";

/**
 * Adds the Cloudflare Web Analytics beacon to an HTML page. The script is a plain element in the
 * head, so the Content Security Policy needs no inline allowance; the token is letters and digits only.
 */
function withWebAnalyticsBeacon(page: Response, token: string): Response {
  const settings = JSON.stringify({ token }).replaceAll('"', "&quot;");
  const beacon = `<script defer src="${WEB_ANALYTICS.scriptUrl}" data-cf-beacon="${settings}"></script>`;
  // The page now depends on the configuration, so it must not be revalidated against the unchanged asset.
  page.headers.delete("ETag");
  page.headers.delete("Last-Modified");
  return new HTMLRewriter()
    .on("head", {
      element(head) {
        head.append(beacon, { html: true });
      },
    })
    .transform(page);
}

function isHtml(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").startsWith("text/html");
}

/**
 * A page request without its cache validators. While Web Analytics is on, pages are always sent in
 * full, so a copy a browser kept from before the token was set is replaced by the page with the beacon.
 */
function withoutValidators(request: Request): Request {
  if (!(request.headers.get("Accept") ?? "").includes("text/html")) {
    return request;
  }
  const fresh = new Request(request);
  fresh.headers.delete("If-None-Match");
  fresh.headers.delete("If-Modified-Since");
  return fresh;
}

/** Builds the HTTP application. Handlers stay thin and call the Domain Core. */
export function createApp(overrides: AdapterOverrides = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", securityHeaders());
  app.get("/api/health", (c) => c.json({ status: API_CODES.ok }));

  app.use("/api/*", withServices(overrides), loadSession(), protectStateChanges(), recordActivity());
  app.route("/api", authRoutes());
  app.route("/api/office", officeRoutes());
  app.route("/api/client", clientPortalRoutes());
  app.route("/api/client", notificationRoutes());
  app.route("/api", fileContentRoutes());

  app.all("/api/*", (c) => c.json({ error: API_CODES.notFound }, 404));
  // Everything else is the single-page application, served through the Worker so that it carries the security headers.
  app.all("*", async (c) => {
    const webAnalyticsToken = loadWebAnalyticsToken(c.env);
    const asset = await c.env.ASSETS.fetch(webAnalyticsToken === undefined ? c.req.raw : withoutValidators(c.req.raw));
    // Responses from the asset binding are immutable; copy so that the security headers can be added.
    const response = new Response(asset.body, asset);
    return webAnalyticsToken !== undefined && isHtml(response) ? withWebAnalyticsBeacon(response, webAnalyticsToken) : response;
  });

  app.onError(handleError);
  return app;
}
