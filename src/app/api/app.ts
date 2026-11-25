import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { API_CODES } from "./codes";
import type { AdapterOverrides } from "./composition";
import type { AppBindings } from "./context";
import { handleError } from "./middleware/errors";
import { securityHeaders } from "./middleware/security-headers";
import { loadSession, protectStateChanges, withServices } from "./middleware/session";

export type { AppBindings } from "./context";

/** Builds the HTTP application. Handlers stay thin and call the Domain Core. */
export function createApp(overrides: AdapterOverrides = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", securityHeaders());
  app.get("/api/health", (c) => c.json({ status: API_CODES.ok }));

  app.use("/api/*", withServices(overrides), loadSession(), protectStateChanges());
  app.route("/api", authRoutes());

  app.all("/api/*", (c) => c.json({ error: API_CODES.notFound }, 404));
  // Everything else is the single-page application, served through the Worker so that it carries the security headers.
  app.all("*", async (c) => {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    // Responses from the asset binding are immutable; copy so that the security headers can be added.
    return new Response(asset.body, asset);
  });

  app.onError(handleError);
  return app;
}
