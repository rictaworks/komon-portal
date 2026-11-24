import { Hono } from "hono";
import type { AppEnv } from "../env";
import { API_CODES } from "./codes";

export type AppBindings = { Bindings: AppEnv };

/** Builds the HTTP application. Handlers stay thin and call the Domain Core. */
export function createApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get("/api/health", (c) => c.json({ status: API_CODES.ok }));

  app.notFound((c) => c.json({ error: API_CODES.notFound }, 404));

  app.onError((error, c) => {
    console.error(JSON.stringify({ event: "unhandled_error", path: new URL(c.req.url).pathname, message: error.message }));
    return c.json({ error: API_CODES.internalError }, 500);
  });

  return app;
}
