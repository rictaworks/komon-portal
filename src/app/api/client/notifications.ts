import { Hono } from "hono";
import { auditableId } from "../../../core/access/guard";
import { invalidInput, notFound } from "../../../core/model/errors";
import type { Services } from "../composition";
import { requireAuth, type AppBindings, type AppContext } from "../context";
import { readJson, requireString, type JsonObject } from "../input";

const MAX_ENDPOINT_LENGTH = 1000;

/** Only an active member of a reachable client manages notifications. Anyone else sees "not found". */
async function requireMember(c: AppContext): Promise<{ userId: string; services: Services }> {
  const { actor } = requireAuth(c);
  const services = c.get("services");
  const clientId = c.req.param("clientId") ?? "";
  if (!services.policy.can(actor, "client.read", { clientId }) || services.policy.can(actor, "staff.operate")) {
    await services.audit.record(actor, "client.read", "client", auditableId(clientId), "denied");
    throw notFound("client");
  }
  return { userId: actor.userId, services };
}

export function notificationRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:clientId/notifications", async (c) => {
    const { userId, services } = await requireMember(c);
    return c.json({
      available: services.pushConfigured,
      vapidPublicKey: services.pushConfigured ? (services.config.vapidPublicKey ?? null) : null,
      subscriptions: await services.pushSubscriptions.countForUser(userId),
    });
  });

  routes.post("/:clientId/notifications/subscriptions", async (c) => {
    const { userId, services } = await requireMember(c);
    const body = await readJson(c);
    const keys = body.keys;
    if (typeof keys !== "object" || keys === null) {
      throw invalidInput("keys");
    }
    await services.pushSubscriptions.save(
      services.ids.newId(),
      userId,
      {
        endpoint: requireString(body, "endpoint", MAX_ENDPOINT_LENGTH),
        keys: { p256dh: requireString(keys as JsonObject, "p256dh"), auth: requireString(keys as JsonObject, "auth") },
      },
      services.clock.now(),
    );
    return c.json({ status: "ok" }, 201);
  });

  routes.delete("/:clientId/notifications/subscriptions", async (c) => {
    const { userId, services } = await requireMember(c);
    const removed = await services.pushSubscriptions.remove(userId, requireString(await readJson(c), "endpoint", MAX_ENDPOINT_LENGTH));
    return c.json({ status: "ok", removed });
  });

  return routes;
}
