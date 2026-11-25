import { auditableId, type Guard } from "../access/guard";
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
 * Opens file bodies in two steps. `open` records the view (a receipt or an acknowledgement) and
 * `download` only reads. Permission is checked on every call and a denial looks exactly like a missing file.
 */
export class ViewService {
  constructor(private readonly deps: ViewServiceDeps) {}

  /** Records that the actor opens the file. The only step that changes anything; the body is not returned. */
  async open(actor: UserActor, fileId: Id, mode: OpenMode): Promise<FileRecord> {
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
    return file;
  }

  /**
   * Hands out the body of a file the actor has opened. Writes nothing on success: a file whose
   * open is not on record yet is refused, so a body never leaves without its receipt or acknowledgement.
   */
  async download(actor: UserActor, fileId: Id): Promise<OpenedFile> {
    const file = await this.readable(actor, fileId, DOWNLOAD_ACTION);
    if (!(await this.openRecorded(actor, file))) {
      throw invalidState("not_opened");
    }
    const body = await this.deps.store.get(file.r2Key);
    if (body === null) {
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

  /** Whether `open` has left its record: staff must have acknowledged a submission, a member must hold a receipt. */
  private async openRecorded(actor: UserActor, file: FileRecord): Promise<boolean> {
    if (this.deps.guard.allows(actor, "staff.operate")) {
      return !(file.direction === "Inbound" && file.state === "Submitted");
    }
    return file.direction !== "Outbound" || (await this.deps.repository.receipts.hasOpened(file.id, actor.userId));
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
      await this.deps.metrics.record("file.first_viewed", file.clientId, {
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
      await this.deps.metrics.record("submission.acknowledged", file.clientId, { fileId: file.id });
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
