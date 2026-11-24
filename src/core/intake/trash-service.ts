import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import type { Actor } from "../model/actor";
import { invalidState, notFound } from "../model/errors";
import type { FileRecord, Id } from "../model/types";
import type { FileStore } from "../ports/file-store";
import type { Repository } from "../ports/repository";
import type { FileWriter } from "./file-writer";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_TARGET = "file";
const PURGE_PAGE = { limit: 100, offset: 0 };

export interface PurgeReport {
  purged: number;
  failed: number;
}

export interface TrashServiceDeps {
  repository: Repository;
  store: FileStore;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  writer: FileWriter;
  cases: CaseService;
}

/** Restores trashed files within 30 days and erases them afterwards (instructions.md 1.6.8). */
export class TrashService {
  constructor(private readonly deps: TrashServiceDeps) {}

  /** Moment before which a trashed file is due for erasure. */
  purgeThreshold(): Date {
    return new Date(this.deps.writer.now().getTime() - TRASH_RETENTION_DAYS * DAY_MS);
  }

  /**
   * Restores a trashed file. An office document always returns to review (diagram 6.1);
   * a client submission returns to the state it was trashed from.
   */
  async restore(actor: Actor, fileId: Id, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.deps.repository.files.findById(fileId);
    if (file === null) {
      throw notFound("file");
    }
    if (file.state !== "Trashed" || file.trashedAt === null || file.trashedFrom === null) {
      throw invalidState("not_trashed");
    }
    if (file.trashedAt.getTime() <= this.purgeThreshold().getTime()) {
      throw invalidState("trash_expired");
    }
    const base: FileRecord = { ...file, trashedAt: null, trashedFrom: null };
    const restored: FileRecord =
      file.direction === "Outbound"
        ? { ...base, state: "NeedsReview", reviewReason: "Restored", reviewDetail: null }
        : { ...base, state: file.trashedFrom };
    const updated = await this.deps.writer.update(restored, expectedVersion);
    await this.deps.audit.record(actor, "file.restore", FILE_TARGET, fileId);
    if (file.caseId !== null) {
      await this.deps.cases.onFileEvent(file.caseId);
    }
    return updated;
  }

  /**
   * Erases bodies and records of files trashed more than 30 days ago. Each erasure is written to
   * the audit log. A failure on one file is recorded and the remaining files are still processed.
   */
  async purgeExpired(actor: Actor): Promise<PurgeReport> {
    await this.deps.guard.require(actor, "maintenance.run", { type: FILE_TARGET, id: "purge" });
    const report: PurgeReport = { purged: 0, failed: 0 };
    const attempted = new Set<Id>();
    for (;;) {
      const due = (await this.deps.repository.files.listTrashedBefore(this.purgeThreshold(), PURGE_PAGE)).filter(
        (file) => !attempted.has(file.id),
      );
      if (due.length === 0) {
        return report;
      }
      for (const file of due) {
        attempted.add(file.id);
        try {
          await this.deps.store.delete(file.r2Key);
          await this.deps.repository.files.purge(file.id);
          await this.deps.audit.record(actor, "file.purge", FILE_TARGET, file.id);
          report.purged += 1;
        } catch (error) {
          await this.deps.audit.record(actor, "file.purge", FILE_TARGET, file.id, "failed");
          await this.deps.metrics.record("purge.failed", file.clientId, { fileId: file.id, error: error instanceof Error ? error.name : "unknown" });
          report.failed += 1;
        }
      }
    }
  }
}
