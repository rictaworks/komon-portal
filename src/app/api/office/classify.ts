import { Hono } from "hono";
import { MAX_CLASSIFICATION_ITEMS } from "../../../core/intake/classification-service";
import { invalidInput } from "../../../core/model/errors";
import { requireAuth, type AppBindings } from "../context";
import { readJson, requireArray, requireString, type JsonObject } from "../input";

/** Header that carries the user's own Jev key for this one request. */
export const JEV_KEY_HEADER = "X-Jev-Key";
const MAX_FILE_NAME_LENGTH = 255;

export function classifyRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/classify", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const items = requireArray(body, "items", MAX_CLASSIFICATION_ITEMS).map((item) => {
      if (typeof item !== "object" || item === null) {
        throw invalidInput("items");
      }
      return { fileId: requireString(item as JsonObject, "fileId"), fileName: requireString(item as JsonObject, "fileName", MAX_FILE_NAME_LENGTH) };
    });
    const report = await c.get("services").classification.classify(actor, {
      model: requireString(body, "model", 64),
      credential: c.req.header(JEV_KEY_HEADER) ?? "",
      items,
    });
    return c.json(report);
  });

  return routes;
}
