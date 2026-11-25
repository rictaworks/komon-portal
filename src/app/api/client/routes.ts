import { Hono } from "hono";
import { auditableId } from "../../../core/access/guard";
import type { UserActor } from "../../../core/model/actor";
import { invalidInput, notFound } from "../../../core/model/errors";
import type { FileRecord, Id } from "../../../core/model/types";
import type { Services } from "../composition";
import { requireAuth, type AppBindings, type AppContext } from "../context";
import { readJson, requireInteger } from "../input";
import { uploadedFile } from "../office/files";
import { Lookups, pageOf } from "../office/views";

const HOME_WINDOW = 100;
/** One extra row tells the home view whether anything lies beyond the window. */
const HOME_FETCH = { limit: HOME_WINDOW + 1, offset: 0 };

/** A client the member cannot reach is answered exactly like a client that does not exist. */
async function requireReach(c: AppContext, clientId: Id): Promise<{ actor: UserActor; services: Services }> {
  const { actor } = requireAuth(c);
  const services = c.get("services");
  if (!services.policy.can(actor, "client.read", { clientId }) || services.policy.can(actor, "staff.operate")) {
    await services.audit.record(actor, "client.read", "client", auditableId(clientId), "denied");
    throw notFound("client");
  }
  return { actor, services };
}

/** Published documents of one client that this member may read, with whether this member has opened each. */
async function publishedDocuments(services: Services, actor: UserActor, clientId: Id, c: AppContext, page = pageOf(c)) {
  const docTypeId = c.req.query("docTypeId");
  const targetMonth = c.req.query("targetMonth");
  const files = await services.repository.files.list(
    {
      clientId,
      direction: "Outbound",
      states: ["Published"],
      ...(docTypeId === undefined || docTypeId === "" ? {} : { docTypeId }),
      ...(targetMonth === undefined || targetMonth === "" ? {} : { targetMonth }),
    },
    page,
  );
  const visible = files.filter((file) => services.policy.can(actor, "file.read", { file }));
  const receipts = await services.repository.receipts.listByFiles(visible.map((file) => file.id));
  const opened = new Set(receipts.filter((receipt) => receipt.userId === actor.userId).map((receipt) => receipt.fileId));
  const lookups = new Lookups(services);
  const items = [];
  for (const file of visible) {
    items.push({ ...(await documentView(lookups, file)), opened: opened.has(file.id) });
  }
  return items;
}

/** What a client member sees of a file. No review data, routing method or internal notes. */
async function documentView(lookups: Lookups, file: FileRecord): Promise<Record<string, unknown>> {
  const docType = await lookups.docType(file.docTypeId);
  return {
    id: file.id,
    displayName: file.displayName,
    format: file.format,
    sizeBytes: file.sizeBytes,
    docType: docType === null ? null : { id: docType.id, shortCode: docType.shortCode, label: docType.label },
    targetMonth: file.targetMonth,
    publishedAt: file.publishedAt,
  };
}

export function clientPortalRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:clientId/home", async (c) => {
    const { actor, services } = await requireReach(c, c.req.param("clientId"));
    const documentRows = await publishedDocuments(services, actor, c.req.param("clientId"), c, HOME_FETCH);
    const caseRows = await services.repository.cases.list({ clientId: c.req.param("clientId") }, HOME_FETCH);
    const cases = [];
    for (const record of caseRows.slice(0, HOME_WINDOW)) {
      cases.push(await services.cases.clientView(record));
    }
    // `truncated` is true when more items exist than the window shows.
    return c.json({
      unread: documentRows.slice(0, HOME_WINDOW).filter((document) => !document.opened),
      cases,
      truncated: { documents: documentRows.length > HOME_WINDOW, cases: caseRows.length > HOME_WINDOW },
    });
  });

  routes.get("/:clientId/documents", async (c) => {
    const { actor, services } = await requireReach(c, c.req.param("clientId"));
    return c.json({ items: await publishedDocuments(services, actor, c.req.param("clientId"), c) });
  });

  routes.get("/:clientId/doc-types", async (c) => {
    const { services } = await requireReach(c, c.req.param("clientId"));
    const types = await services.repository.docTypes.list();
    return c.json({
      outbound: types.filter((type) => type.direction !== "Inbound").map((type) => ({ id: type.id, shortCode: type.shortCode, label: type.label })),
      inbound: types.filter((type) => type.direction !== "Outbound").map((type) => ({ id: type.id, shortCode: type.shortCode, label: type.label })),
    });
  });

  routes.get("/:clientId/submissions", async (c) => {
    const { actor, services } = await requireReach(c, c.req.param("clientId"));
    const files = await services.repository.files.list(
      { clientId: c.req.param("clientId"), direction: "Inbound", states: ["Submitted", "Acknowledged"] },
      pageOf(c),
    );
    const lookups = new Lookups(services);
    const items = [];
    for (const file of files.filter((candidate) => services.policy.can(actor, "file.read", { file: candidate }))) {
      const batch = await services.repository.files.findBatch(file.batchId);
      items.push({
        ...(await documentView(lookups, file)),
        state: file.state,
        submittedAt: file.receivedAt,
        acknowledgedAt: file.acknowledgedAt,
        canCancel: services.policy.can(actor, "submission.cancel", { file, submitterId: batch?.uploadedBy ?? "" }),
        version: file.version,
      });
    }
    return c.json({ items });
  });

  routes.post("/:clientId/submissions", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const upload = await uploadedFile(c);
    const docTypeId = upload.form.get("docTypeId");
    const targetMonth = upload.form.get("targetMonth");
    if (typeof docTypeId !== "string" || typeof targetMonth !== "string") {
      throw invalidInput("submission");
    }
    const result = await services.submissions.submit(
      actor,
      { clientId: c.req.param("clientId"), docTypeId, targetMonth },
      { fileName: upload.fileName, bytes: upload.bytes },
    );
    if (result.outcome === "stored") {
      return c.json({ outcome: "stored", file: { ...(await documentView(new Lookups(services), result.file)), state: result.file.state, version: result.file.version } }, 201);
    }
    return c.json(result);
  });

  routes.post("/:clientId/submissions/:id/cancel", async (c) => {
    const { actor, services } = await requireReach(c, c.req.param("clientId"));
    const file = await services.repository.files.findById(c.req.param("id"));
    if (file === null || file.clientId !== c.req.param("clientId")) {
      await services.audit.record(actor, "submission.cancel", "file", auditableId(c.req.param("id")), "denied");
      throw notFound("file");
    }
    const cancelled = await services.submissions.cancel(actor, c.req.param("id"), requireInteger(await readJson(c), "version"));
    return c.json({ id: cancelled.id, state: cancelled.state });
  });

  return routes;
}
