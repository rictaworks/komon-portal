import { Hono } from "hono";
import { invalidInput } from "../../../core/model/errors";
import type { FileFormat } from "../../../core/model/types";
import { OPEN_MODES } from "../../../core/publish/view-service";
import { HttpError, requireAuth, type AppBindings } from "../context";

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
 */
export function fileContentRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/files/:id/content", async (c) => {
    // Opening a file records an acknowledgement or a receipt, so a cross-site navigation must not reach it.
    if (c.req.header("Sec-Fetch-Site") === "cross-site") {
      throw new HttpError(403, "bad_origin");
    }
    const { actor } = requireAuth(c);
    const requested = c.req.query("mode") ?? "download";
    const mode = OPEN_MODES.find((candidate) => candidate === requested);
    if (mode === undefined) {
      throw invalidInput("mode");
    }
    const opened = await c.get("services").view.open(actor, c.req.param("id"), mode);
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
