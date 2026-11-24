import type { Guard } from "../access/guard";
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

/** Opens file bodies. Permission is checked on every call and a denial looks exactly like a missing file. */
export class ViewService {
  constructor(private readonly deps: ViewServiceDeps) {}

  async open(actor: UserActor, fileId: Id, mode: OpenMode): Promise<OpenedFile> {
    const found = await this.deps.repository.files.findById(fileId);
    if (found === null || !this.deps.guard.allows(actor, "file.read", { file: found })) {
      await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, fileId, "denied");
      throw notFound("file");
    }
    const body = await this.deps.store.get(found.r2Key);
    if (body === null) {
      await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, fileId, "failed");
      throw invalidState("body_missing");
    }
    const file = this.deps.guard.allows(actor, "staff.operate") ? await this.acknowledge(actor, found) : await this.receive(actor, found);
    await this.deps.audit.record(actor, `file.${mode}`, FILE_TARGET, fileId);
    return { file, body, downloadName: `${file.displayName}.${EXTENSIONS[file.format]}` };
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
      if (file.caseId !== null) {
        await this.deps.cases.onFileEvent(file.caseId);
      }
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
