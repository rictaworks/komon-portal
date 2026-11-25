import { Hono } from "hono";
import { invalidInput } from "../../../core/model/errors";
import type { FileFormat } from "../../../core/model/types";
import { OPEN_MODES } from "../../../core/publish/view-service";
import { requireAuth, type AppBindings } from "../context";
import { readJson, requireString } from "../input";

const BINARY = "application/octet-stream";
/** Types a browser never executes. Text formats are sent as opaque bytes so they cannot run as markup or script. */
const CONTENT_TYPES: Readonly<Record<FileFormat, string>> = {
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpeg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xml: BINARY,
  csv: BINARY,
  txt: BINARY,
};

/**
 * File bodies are relayed by the Worker after a permission check on every request. They are
 * always sent as attachments with a generated name, never cached, and never given a URL of their own.
 * Opening is two requests: the POST records the view behind the same-origin and CSRF checks, and
 * the GET that follows only reads.
 */
export function fileContentRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/files/:id/open", async (c) => {
    const { actor } = requireAuth(c);
    const requested = requireString(await readJson(c), "mode");
    const mode = OPEN_MODES.find((candidate) => candidate === requested);
    if (mode === undefined) {
      throw invalidInput("mode");
    }
    const file = await c.get("services").view.open(actor, c.req.param("id"), mode);
    return c.json({ id: file.id });
  });

  routes.get("/files/:id/content", async (c) => {
    const { actor } = requireAuth(c);
    const opened = await c.get("services").view.download(actor, c.req.param("id"));
    return new Response(opened.body.body, {
      headers: {
        "Content-Type": CONTENT_TYPES[opened.file.format],
        "Content-Length": String(opened.body.sizeBytes),
        "Content-Disposition": `attachment; filename="${opened.downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return routes;
}
