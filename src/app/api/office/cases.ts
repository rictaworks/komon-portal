import { Hono } from "hono";
import type { Services } from "../composition";
import { DUE_CAUTION_DAYS, RETRIEVAL_CAUTION_DAYS } from "../../../core/cases/deadline-calculator";
import { MAX_ARRIVAL_NUMBERS } from "../../../core/cases/case-service";
import { invalidInput, notFound } from "../../../core/model/errors";
import { CASE_KINDS, CASE_STATES, type CaseRecord, type CaseState } from "../../../core/model/types";
import type { CaseFilter } from "../../../core/ports/repository";
import { addDays } from "../../../core/time/local-date";
import { requireAuth, type AppBindings } from "../context";
import { optionalString, readJson, requireArray, requireInteger, requireString } from "../input";
import { caseView, Lookups, pageOf } from "./views";

const UNREAD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

async function deadlinesOf(services: Services, record: CaseRecord) {
  const setting = await services.repository.settings.get();
  return { retrieval: services.deadlines.retrievalLevel(record, setting), due: services.deadlines.dueLevel(record, setting) };
}

async function casesByIds(services: Services, lookups: Lookups, ids: readonly string[]): Promise<Record<string, unknown>[]> {
  const views = [];
  for (const id of ids) {
    const record = await services.repository.cases.findById(id);
    if (record !== null) {
      views.push(await caseView(lookups, record, await deadlinesOf(services, record)));
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
    const setting = await services.repository.settings.get();
    const today = services.deadlines.today(setting);
    const lookups = new Lookups(services);
    const unread = [];
    for (const file of await services.dashboard.unreadPublishedBefore(new Date(services.clock.now().getTime() - UNREAD_DAYS * DAY_MS))) {
      unread.push({ id: file.id, displayName: file.displayName, publishedAt: file.publishedAt, client: await lookups.client(file.clientId) });
    }
    const retrievalFrom = addDays(today, RETRIEVAL_CAUTION_DAYS - setting.retrievalDeadlineDays);
    return c.json({
      today,
      needsReview: await services.repository.files.count({ direction: "Outbound", states: ["NeedsReview"] }),
      staged: await services.repository.files.count({ direction: "Outbound", states: ["Staged"] }),
      submitted: await services.repository.files.count({ direction: "Inbound", states: ["Submitted"] }),
      unread,
      retrieval: await casesByIds(services, lookups, await services.dashboard.submittedCaseIdsOnOrBefore(retrievalFrom)),
      due: await casesByIds(services, lookups, await services.dashboard.openCaseIdsDueOnOrBefore(addDays(today, DUE_CAUTION_DAYS))),
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
      items.push(await caseView(lookups, record, await deadlinesOf(services, record)));
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
    return c.json(await caseView(new Lookups(services), created, await deadlinesOf(services, created), []), 201);
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
    return c.json(await caseView(new Lookups(services), record, await deadlinesOf(services, record), arrivals));
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
    return c.json(await caseView(new Lookups(services), updated, await deadlinesOf(services, updated), arrivals));
  });

  routes.post("/cases/:id/close", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const updated = await services.cases.close(actor, c.req.param("id"), requireInteger(await readJson(c), "version"));
    return c.json(await caseView(new Lookups(services), updated, await deadlinesOf(services, updated)));
  });

  routes.post("/cases/:id/cancel", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const updated = await services.cases.cancel(actor, c.req.param("id"), requireInteger(await readJson(c), "version"));
    return c.json(await caseView(new Lookups(services), updated, await deadlinesOf(services, updated)));
  });

  return routes;
}
