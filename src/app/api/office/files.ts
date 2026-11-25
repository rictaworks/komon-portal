import { Hono } from "hono";
import { MAX_FILE_BYTES } from "../../../core/intake/limits";
import { invalidInput, notFound } from "../../../core/model/errors";
import {
  FILE_DIRECTIONS, FILE_STATES, REVIEW_REASONS, WITHDRAW_REASONS, type FileState, type Id,
} from "../../../core/model/types";
import type { FileFilter } from "../../../core/ports/repository";
import { AFTER_WITHDRAW, MAX_INCIDENTS } from "../../../core/publish/publish-service";
import { requireAuth, type AppBindings, type AppContext } from "../context";
import { optionalBoolean, optionalString, readJson, requireArray, requireEnum, requireInteger, requireString, type JsonObject } from "../input";
import { fileView, Lookups, pageOf } from "./views";

const MAX_PUBLISH_ITEMS = 200;
/** Multipart overhead allowed on top of the largest file. */
const UPLOAD_OVERHEAD_BYTES = 1024 * 1024;
const TARGET_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function queryEnum<T extends string>(c: AppContext, key: string, allowed: readonly T[]): T | undefined {
  const value = c.req.query(key);
  if (value === undefined || value === "") {
    return undefined;
  }
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw invalidInput(key);
  }
  return match;
}

function fileFilter(c: AppContext): FileFilter {
  const filter: FileFilter = {};
  const states = c.req.query("states");
  if (states !== undefined && states !== "") {
    const parsed = states.split(",");
    if (!parsed.every((state): state is FileState => (FILE_STATES as readonly string[]).includes(state))) {
      throw invalidInput("states");
    }
    filter.states = parsed;
  }
  const direction = queryEnum(c, "direction", FILE_DIRECTIONS);
  const reviewReason = queryEnum(c, "reviewReason", REVIEW_REASONS);
  const assign = <K extends keyof FileFilter>(key: K, value: FileFilter[K] | undefined): void => {
    if (value !== undefined && value !== "") {
      filter[key] = value;
    }
  };
  assign("direction", direction);
  assign("reviewReason", reviewReason);
  assign("clientId", c.req.query("clientId"));
  assign("caseId", c.req.query("caseId"));
  assign("docTypeId", c.req.query("docTypeId"));
  const targetMonth = c.req.query("targetMonth");
  // A month written another way matches nothing; it is refused so it cannot pass for an empty shelf.
  if (targetMonth !== undefined && targetMonth !== "" && !TARGET_MONTH.test(targetMonth)) {
    throw invalidInput("targetMonth");
  }
  assign("targetMonth", targetMonth);
  return filter;
}

export interface UploadedFile {
  fileName: string;
  bytes: Uint8Array;
  /** The other fields of the same form. */
  form: FormData;
}

/** Reads the single uploaded file of a request. The name is used in memory only and never stored. */
export async function uploadedFile(c: AppContext): Promise<UploadedFile> {
  const limit = MAX_FILE_BYTES + UPLOAD_OVERHEAD_BYTES;
  const declaredText = c.req.header("Content-Length");
  if (declaredText !== undefined) {
    const declared = Number(declaredText);
    if (!Number.isFinite(declared) || declared < 0) {
      throw invalidInput("content_length");
    }
    if (declared > limit) {
      throw invalidInput("file_too_large");
    }
  }
  // The body is counted while it streams, so a request without Content-Length is also stopped at the limit.
  let tooLarge = false;
  let seen = 0;
  const body = c.req.raw.body;
  const counted = body === null ? null : body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          tooLarge = true;
          controller.error(new Error("body too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  let form: FormData;
  try {
    form = await new Response(counted, { headers: c.req.raw.headers }).formData();
  } catch {
    throw invalidInput(tooLarge ? "file_too_large" : "body");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw invalidInput("file");
  }
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), form };
}

function version(body: JsonObject): number {
  return requireInteger(body, "version");
}

export function fileRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/batches", async (c) => {
    const { actor } = requireAuth(c);
    const batch = await c.get("services").intake.openBatch(actor, optionalString(await readJson(c), "hintClientId"));
    return c.json({ id: batch.id, hintClientId: batch.hintClientId }, 201);
  });

  routes.post("/batches/:batchId/files", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "batch", id: c.req.param("batchId") });
    const result = await services.intake.accept(actor, c.req.param("batchId"), await uploadedFile(c));
    if (result.outcome === "stored") {
      return c.json({ outcome: "stored", published: result.published, file: await fileView(new Lookups(services), result.file, []) }, 201);
    }
    if (result.outcome === "duplicate") {
      const existing = await services.repository.files.findById(result.existingFileId);
      return c.json({ outcome: "duplicate", existing: existing === null ? null : await fileView(new Lookups(services), existing, []) });
    }
    return c.json(result);
  });

  routes.get("/files", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "file", id: "list" });
    const filter = fileFilter(c);
    const files = await services.repository.files.list(filter, pageOf(c));
    const receipts = await services.repository.receipts.listByFiles(files.map((file) => file.id));
    const lookups = new Lookups(services);
    const items = [];
    for (const file of files) {
      items.push(await fileView(lookups, file, receipts));
    }
    return c.json({ items, total: await services.repository.files.count(filter) });
  });

  routes.get("/files/:id", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "file", id: c.req.param("id") });
    const file = await services.repository.files.findById(c.req.param("id"));
    if (file === null) {
      throw notFound("file");
    }
    return c.json(await fileView(new Lookups(services), file, await services.repository.receipts.listByFile(file.id)));
  });

  const respond = async (c: AppContext, fileId: Id): Promise<Response> => {
    const services = c.get("services");
    const file = await services.repository.files.findById(fileId);
    if (file === null) {
      throw notFound("file");
    }
    return c.json(await fileView(new Lookups(services), file, await services.repository.receipts.listByFile(fileId)));
  };

  routes.post("/files/:id/assign", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const docTypeId = body.docTypeId === undefined ? {} : { docTypeId: optionalString(body, "docTypeId") };
    await c.get("services").review.assign(
      actor,
      c.req.param("id"),
      { clientId: requireString(body, "clientId"), caseId: optionalString(body, "caseId"), confirmed: optionalBoolean(body, "confirmed"), ...docTypeId },
      version(body),
    );
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/doc-type", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    await c.get("services").review.setDocType(actor, c.req.param("id"), optionalString(body, "docTypeId"), version(body));
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/send-back", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").review.sendBack(actor, c.req.param("id"), version(await readJson(c)));
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/trash", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").review.trash(actor, c.req.param("id"), version(await readJson(c)));
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/restore", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").trash.restore(actor, c.req.param("id"), version(await readJson(c)));
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/withdraw", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    await c.get("services").publish.withdraw(
      actor,
      c.req.param("id"),
      { reason: requireEnum(body, "reason", WITHDRAW_REASONS), next: requireEnum(body, "next", AFTER_WITHDRAW) },
      version(body),
    );
    return respond(c, c.req.param("id"));
  });

  routes.post("/files/:id/link-case", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    await c.get("services").submissions.linkCase(actor, c.req.param("id"), optionalString(body, "caseId"), version(body));
    return respond(c, c.req.param("id"));
  });

  routes.post("/publish", async (c) => {
    const { actor } = requireAuth(c);
    const items = requireArray(await readJson(c), "items", MAX_PUBLISH_ITEMS).map((item) => {
      if (typeof item !== "object" || item === null) {
        throw invalidInput("items");
      }
      return { fileId: requireString(item as JsonObject, "fileId"), version: requireInteger(item as JsonObject, "version") };
    });
    return c.json({ results: await c.get("services").publish.publish(actor, items) });
  });

  routes.get("/incidents", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const lookups = new Lookups(services);
    const raw = c.req.query("limit");
    // The service checks the role first and then refuses a limit that is not a whole number from 1 to MAX_INCIDENTS.
    const limit = raw === undefined ? MAX_INCIDENTS : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    const incidents = await services.publish.listIncidents(actor, limit);
    const items = [];
    for (const incident of incidents.items) {
      items.push(await fileView(lookups, incident.file, incident.receipts));
    }
    // `total` counts every incident; `truncated` is true when more exist than the items shown.
    return c.json({ items, total: incidents.total, truncated: incidents.truncated });
  });

  return routes;
}
