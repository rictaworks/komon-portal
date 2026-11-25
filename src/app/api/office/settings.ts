import { Hono } from "hono";
import { CASE_KINDS, DOC_TYPE_DIRECTIONS } from "../../../core/model/types";
import { requireAuth, type AppBindings } from "../context";
import { readJson, requireBoolean, requireEnum, requireInteger, requireNumber, requireString } from "../input";
import { Lookups, pageOf } from "./views";

export function settingsRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/settings", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "setting", id: "office" });
    return c.json({
      office: await services.repository.settings.get(),
      canEditOffice: services.policy.can(actor, "office.settings.update"),
      docTypes: await services.repository.docTypes.list(),
      docRules: await services.repository.docTypes.listRules(),
      caseTypes: await services.repository.caseTypes.list(),
      // Only the on/off state: the VAPID keys themselves never leave the server through this route.
      notifications: { pushConfigured: services.pushConfigured },
    });
  });

  routes.put("/settings/office", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const updated = await c.get("services").settings.updateOffice(
      actor,
      {
        timezone: requireString(body, "timezone", 64),
        arrivalNumberPattern: requireString(body, "arrivalNumberPattern", 100),
        retrievalDeadlineDays: requireInteger(body, "retrievalDeadlineDays"),
        autoPublishEnabled: requireBoolean(body, "autoPublishEnabled"),
        jevThreshold: requireNumber(body, "jevThreshold"),
      },
      requireInteger(body, "version"),
    );
    return c.json(updated);
  });

  routes.post("/doc-types", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const created = await c.get("services").settings.addDocType(actor, {
      label: requireString(body, "label"),
      shortCode: requireString(body, "shortCode", 16),
      direction: requireEnum(body, "direction", DOC_TYPE_DIRECTIONS),
    });
    return c.json(created, 201);
  });

  routes.put("/doc-types/:id", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const updated = await c.get("services").settings.updateDocType(actor, c.req.param("id"), {
      label: requireString(body, "label"),
      shortCode: requireString(body, "shortCode", 16),
      direction: requireEnum(body, "direction", DOC_TYPE_DIRECTIONS),
    });
    return c.json(updated);
  });

  routes.post("/doc-rules", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const created = await c.get("services").settings.addRule(actor, { docTypeId: requireString(body, "docTypeId"), keyword: requireString(body, "keyword") });
    return c.json(created, 201);
  });

  routes.delete("/doc-rules/:id", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").settings.removeRule(actor, c.req.param("id"));
    return c.json({ status: "ok" });
  });

  routes.post("/case-types", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const created = await c.get("services").settings.addCaseType(actor, { kind: requireEnum(body, "kind", CASE_KINDS), label: requireString(body, "label") });
    return c.json(created, 201);
  });

  routes.put("/case-types/:id", async (c) => {
    const { actor } = requireAuth(c);
    const updated = await c.get("services").settings.renameCaseType(actor, c.req.param("id"), requireString(await readJson(c), "label"));
    return c.json(updated);
  });

  routes.get("/audit", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "audit.read", { type: "audit", id: "log" });
    const lookups = new Lookups(services);
    const items = [];
    for (const entry of await services.repository.audit.list(pageOf(c))) {
      items.push({ ...entry, actorDisplayName: await lookups.displayName(entry.actorUserId) });
    }
    return c.json({ items });
  });

  return routes;
}
