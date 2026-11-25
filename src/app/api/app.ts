import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { notificationRoutes } from "./client/notifications";
import { clientPortalRoutes } from "./client/routes";
import { API_CODES } from "./codes";
import type { AdapterOverrides } from "./composition";
import type { AppBindings } from "./context";
import { fileContentRoutes } from "./files/routes";
import { handleError } from "./middleware/errors";
import { securityHeaders } from "./middleware/security-headers";
import { officeRoutes } from "./office";
import { loadSession, protectStateChanges, withServices } from "./middleware/session";

export type { AppBindings } from "./context";

/** Builds the HTTP application. Handlers stay thin and call the Domain Core. */
export function createApp(overrides: AdapterOverrides = {}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", securityHeaders());
  app.get("/api/health", (c) => c.json({ status: API_CODES.ok }));

  app.use("/api/*", withServices(overrides), loadSession(), protectStateChanges());
  app.route("/api", authRoutes());
  app.route("/api/office", officeRoutes());
  app.route("/api/client", clientPortalRoutes());
  app.route("/api/client", notificationRoutes());
  app.route("/api", fileContentRoutes());

  app.all("/api/*", (c) => c.json({ error: API_CODES.notFound }, 404));
  // Everything else is the single-page application, served through the Worker so that it carries the security headers.
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError(handleError);
  return app;
}
