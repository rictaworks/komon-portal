import { Hono } from "hono";
import type { Services } from "../composition";
import { MAX_ARRIVAL_NUMBERS } from "../../../core/cases/case-service";
import { invalidInput, notFound } from "../../../core/model/errors";
import { CASE_KINDS, CASE_STATES, type CaseRecord, type CaseState } from "../../../core/model/types";
import type { CaseFilter } from "../../../core/ports/repository";
import { dueWindowEnd, retrievalWindowEnd, unreadCutoff } from "../../../core/office/dashboard-windows";
import { requireAuth, type AppBindings } from "../context";
import { optionalString, readJson, requireArray, requireInteger, requireString } from "../input";
import { caseView, Lookups, pageOf } from "./views";

async function deadlinesOf(services: Services, lookups: Lookups, record: CaseRecord) {
  const setting = await lookups.setting();
  return { retrieval: services.deadlines.retrievalLevel(record, setting), due: services.deadlines.dueLevel(record, setting) };
}

async function casesByIds(services: Services, lookups: Lookups, ids: readonly string[]): Promise<Record<string, unknown>[]> {
  const views = [];
  for (const id of ids) {
    const record = await services.repository.cases.findById(id);
    if (record !== null) {
      views.push(await caseView(lookups, record, await deadlinesOf(services, lookups, record)));
    }
  }
  return views;
}

export function caseRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/dashboard", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "dashboard", id: "office" });
    const lookups = new Lookups(services);
    const setting = await lookups.setting();
    const today = services.deadlines.today(setting);
    const unreadFiles = await services.dashboard.unreadPublishedBefore(unreadCutoff(services.clock.now()));
    const unread = [];
    for (const file of unreadFiles.items) {
      unread.push({ id: file.id, displayName: file.displayName, publishedAt: file.publishedAt, client: await lookups.client(file.clientId) });
    }
    const retrievalIds = await services.dashboard.submittedCaseIdsOnOrBefore(retrievalWindowEnd(today, setting.retrievalDeadlineDays));
    const dueIds = await services.dashboard.openCaseIdsDueOnOrBefore(dueWindowEnd(today));
    return c.json({
      today,
      needsReview: await services.repository.files.count({ direction: "Outbound", states: ["NeedsReview"] }),
      staged: await services.repository.files.count({ direction: "Outbound", states: ["Staged"] }),
      submitted: await services.repository.files.count({ direction: "Inbound", states: ["Submitted"] }),
      unread,
      // `truncated` is true when more items matched than the 100 shown.
      truncated: { unread: unreadFiles.truncated, retrieval: retrievalIds.truncated, due: dueIds.truncated },
      retrieval: await casesByIds(services, lookups, retrievalIds.items),
      due: await casesByIds(services, lookups, dueIds.items),
      // Mis-deliveries are shown to the Owner only.
      incidents: services.policy.can(actor, "incident.read") ? (await services.publish.listIncidents(actor)).length : null,
    });
  });

  routes.get("/cases", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "case", id: "list" });
    const filter: CaseFilter = {};
    const clientId = c.req.query("clientId");
    const targetMonth = c.req.query("targetMonth");
    const kind = c.req.query("kind");
    const states = c.req.query("states");
    if (clientId !== undefined && clientId !== "") filter.clientId = clientId;
    if (targetMonth !== undefined && targetMonth !== "") filter.targetMonth = targetMonth;
    if (kind !== undefined && kind !== "") {
      const match = CASE_KINDS.find((candidate) => candidate === kind);
      if (match === undefined) throw invalidInput("kind");
      filter.kind = match;
    }
    if (states !== undefined && states !== "") {
      const parsed = states.split(",");
      if (!parsed.every((state): state is CaseState => (CASE_STATES as readonly string[]).includes(state))) throw invalidInput("states");
      filter.states = parsed;
    }
    const lookups = new Lookups(services);
    const items = [];
    for (const record of await services.repository.cases.list(filter, pageOf(c))) {
      items.push(await caseView(lookups, record, await deadlinesOf(services, lookups, record)));
    }
    return c.json({ items });
  });

  routes.post("/cases", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const body = await readJson(c);
    const created = await services.cases.register(actor, {
      clientId: requireString(body, "clientId"),
      caseTypeId: requireString(body, "caseTypeId"),
      targetMonth: requireString(body, "targetMonth", 7),
      referenceCode: requireString(body, "referenceCode", 64),
      assigneeId: optionalString(body, "assigneeId"),
      dueOn: optionalString(body, "dueOn", 10),
    });
    const lookups = new Lookups(services);
    return c.json(await caseView(lookups, created, await deadlinesOf(services, lookups, created), []), 201);
  });

  routes.get("/cases/:id", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "case", id: c.req.param("id") });
    const record = await services.repository.cases.findById(c.req.param("id"));
    if (record === null) {
      throw notFound("case");
    }
    const arrivals = (await services.repository.cases.listArrivals(record.id)).map((arrival) => arrival.arrivalNumber);
    const lookups = new Lookups(services);
    return c.json(await caseView(lookups, record, await deadlinesOf(services, lookups, record), arrivals));
  });

  routes.post("/cases/:id/submit", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const body = await readJson(c);
    const arrivalNumbers = requireArray(body, "arrivalNumbers", MAX_ARRIVAL_NUMBERS).map((value) => {
      if (typeof value !== "string") throw invalidInput("arrivalNumbers");
      return value;
    });
    const updated = await services.cases.markSubmitted(
      actor,
      c.req.param("id"),
      { submittedOn: requireString(body, "submittedOn", 10), arrivalNumbers },
      requireInteger(body, "version"),
    );
    const arrivals = (await services.repository.cases.listArrivals(updated.id)).map((arrival) => arrival.arrivalNumber);
    const lookups = new Lookups(services);
    return c.json(await caseView(lookups, updated, await deadlinesOf(services, lookups, updated), arrivals));
  });

  routes.post("/cases/:id/close", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const updated = await services.cases.close(actor, c.req.param("id"), requireInteger(await readJson(c), "version"));
    const lookups = new Lookups(services);
    return c.json(await caseView(lookups, updated, await deadlinesOf(services, lookups, updated)));
  });

  routes.post("/cases/:id/cancel", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const updated = await services.cases.cancel(actor, c.req.param("id"), requireInteger(await readJson(c), "version"));
    const lookups = new Lookups(services);
    return c.json(await caseView(lookups, updated, await deadlinesOf(services, lookups, updated)));
  });

  return routes;
}
