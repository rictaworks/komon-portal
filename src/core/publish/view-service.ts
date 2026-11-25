import { auditableId, type Guard } from "../access/guard";
import { secretsEqual } from "../access/secret-compare";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import type { FileWriter } from "../intake/file-writer";
import type { UserActor } from "../model/actor";
import { DomainError, invalidState, notFound } from "../model/errors";
import type { FileFormat, FileRecord, Id } from "../model/types";
import type { FileStore, StoredFile } from "../ports/file-store";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";

export const OPEN_MODES = ["view", "download"] as const;
export type OpenMode = (typeof OPEN_MODES)[number];

export interface OpenedFile {
  file: FileRecord;
  body: StoredFile;
  /** Generated name for the download. Never the original file name. */
  downloadName: string;
}

const EXTENSIONS: Readonly<Record<FileFormat, string>> = {
  pdf: "pdf", zip: "zip", xml: "xml", csv: "csv", xlsx: "xlsx", docx: "docx", txt: "txt", png: "png", jpeg: "jpg",
};
const FILE_TARGET = "file";
const DOWNLOAD_ACTION = "file.download";
/** How long the download may follow its open. Long enough for the browser to start it, no longer. */
export const OPEN_TICKET_SECONDS = 60;
const TICKET_PATTERN = /^(\d{1,15})\.([0-9a-f]{64})$/;

export interface OpenGrant {
  file: FileRecord;
  /** Proof of this open for the download that follows. Valid in the same session, for this file, for a short time. */
  ticket: string;
}

/**
 * Signs "this user opened this file, good until then" with the session's secret, so the proof
 * cannot be made outside the session and nothing has to be stored for the download to check it.
 */
async function signTicket(sessionSecret: string, userId: Id, fileId: Id, expiresAt: number): Promise<string> {
  if (sessionSecret === "") {
    throw new Error("a session secret is required to open a file");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify([userId, fileId, expiresAt])));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export interface ViewServiceDeps {
  repository: Repository;
  store: FileStore;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  ids: IdGenerator;
  writer: FileWriter;
  cases: CaseService;
}

/**
 * Opens file bodies in two steps. `open` records the view (a receipt or an acknowledgement, and the
 * audit entry) and answers with a ticket; `download` hands out the body for that ticket only.
 * Permission is checked on every call and a denial looks exactly like a missing file.
 */
export class ViewService {
  constructor(private readonly deps: ViewServiceDeps) {}

  /**
   * Records that the actor opens the file. The body is not returned: the ticket for it is made
   * last, so an open that failed part way permits no download.
   */
  async open(actor: UserActor, fileId: Id, mode: OpenMode, sessionSecret: string): Promise<OpenGrant> {
    // Signed before anything is written: a session that cannot be given a ticket records nothing.
    const expiresAt = this.deps.writer.now().getTime() + OPEN_TICKET_SECONDS * 1000;
    const signature = await signTicket(sessionSecret, actor.userId, fileId, expiresAt);
    const found = await this.readable(actor, fileId, `file.${mode}`);
    const body = await this.deps.store.get(found.r2Key);
    if (body === null) {
      await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, fileId, "failed");
      throw invalidState("body_missing");
    }
    await body.body.cancel();
    const file = this.deps.guard.allows(actor, "staff.operate") ? await this.acknowledge(actor, found) : await this.receive(actor, found);
    // The file may have been withdrawn while the receipt was being written: check again before confirming the open.
    const current = await this.deps.repository.files.findById(fileId);
    if (current === null || !this.deps.guard.allows(actor, "file.read", { file: current })) {
      await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, auditableId(fileId), "denied");
      throw notFound("file");
    }
    await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, fileId);
    return { file, ticket: `${expiresAt}.${signature}` };
  }

  /**
   * Hands out the body of a file for the ticket of an open that this session just completed.
   * Without that ticket the request is refused and writes nothing, whoever asks and whatever the
   * file, so no body leaves without the records and the audit entry of its open. Writes nothing on success.
   */
  async download(actor: UserActor, fileId: Id, sessionSecret: string, ticket: string | null): Promise<OpenedFile> {
    if (sessionSecret === "") {
      throw new Error("a session secret is required to download a file");
    }
    const file = await this.readable(actor, fileId, DOWNLOAD_ACTION);
    if (!(await this.ticketValid(actor, fileId, sessionSecret, ticket))) {
      throw invalidState("not_opened");
    }
    const body = await this.deps.store.get(file.r2Key);
    if (body === null) {
      await this.deps.audit.record(actor, DOWNLOAD_ACTION, FILE_TARGET, fileId, "failed");
      throw invalidState("body_missing");
    }
    return { file, body, downloadName: `${file.displayName}.${EXTENSIONS[file.format]}` };
  }

  private async readable(actor: UserActor, fileId: Id, action: string): Promise<FileRecord> {
    const found = await this.deps.repository.files.findById(fileId);
    if (found === null || !this.deps.guard.allows(actor, "file.read", { file: found })) {
      await this.deps.audit.record(actor, action, FILE_TARGET, auditableId(fileId), "denied");
      throw notFound("file");
    }
    return found;
  }

  /** Whether the ticket was issued by `open` to this session and user for this file, and has not run out. */
  private async ticketValid(actor: UserActor, fileId: Id, sessionSecret: string, ticket: string | null): Promise<boolean> {
    const parts = ticket === null ? null : TICKET_PATTERN.exec(ticket);
    if (parts === null) {
      return false;
    }
    const expiresAt = Number(parts[1]);
    if (expiresAt <= this.deps.writer.now().getTime()) {
      return false;
    }
    return secretsEqual(parts[2] ?? "", await signTicket(sessionSecret, actor.userId, fileId, expiresAt));
  }

  /** Records the first time this client member opened a published file. Staff views are never receipts. */
  private async receive(actor: UserActor, file: FileRecord): Promise<FileRecord> {
    if (file.direction !== "Outbound") {
      return file;
    }
    const now = this.deps.writer.now();
    const first = await this.deps.repository.receipts.insertIfAbsent({
      id: this.deps.ids.newId(),
      fileId: file.id,
      userId: actor.userId,
      firstViewedAt: now,
    });
    if (first) {
      await this.deps.audit.record(actor, "file.receive", FILE_TARGET, file.id);
      await this.deps.metrics.record(actor, "file.first_viewed", file.clientId, {
        fileId: file.id,
        secondsSincePublished: file.publishedAt === null ? null : Math.round((now.getTime() - file.publishedAt.getTime()) / 1000),
      });
    }
    // Settled on every open, so a case is confirmed even if an earlier attempt failed after the receipt was written.
    if (file.caseId !== null) {
      await this.deps.cases.onFileEvent(file.caseId);
    }
    return file;
  }

  /** The first staff member to open a client's submission acknowledges it. */
  private async acknowledge(actor: UserActor, file: FileRecord): Promise<FileRecord> {
    if (file.direction !== "Inbound" || file.state !== "Submitted") {
      return file;
    }
    try {
      const updated = await this.deps.writer.update({ ...file, state: "Acknowledged", acknowledgedAt: this.deps.writer.now() }, file.version);
      await this.deps.audit.record(actor, "file.acknowledge", FILE_TARGET, file.id);
      await this.deps.metrics.record(actor, "submission.acknowledged", file.clientId, { fileId: file.id });
      return updated;
    } catch (error) {
      // Another staff member acknowledged it at the same moment: read the settled record.
      if (error instanceof DomainError && error.detail === "stale") {
        const current = await this.deps.repository.files.findById(file.id);
        if (current !== null) {
          return current;
        }
      }
      throw error;
    }
  }
}
