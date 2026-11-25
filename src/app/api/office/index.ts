import { Hono } from "hono";
import type { AppBindings } from "../context";
import { caseRoutes } from "./cases";
import { classifyRoutes } from "./classify";
import { clientRoutes } from "./clients";
import { fileRoutes } from "./files";
import { settingsRoutes } from "./settings";

/** Office-side API. Every handler validates input and calls the Domain Core; rules live in the core. */
export function officeRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  routes.route("/", fileRoutes());
  routes.route("/", clientRoutes());
  routes.route("/", caseRoutes());
  routes.route("/", settingsRoutes());
  routes.route("/", classifyRoutes());
  return routes;
}
