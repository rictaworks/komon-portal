import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import { actorUserId, type Actor } from "../model/actor";
import { conflict, invalidState, notFound } from "../model/errors";
import type { FileRecord, Id } from "../model/types";
import type { FileStore } from "../ports/file-store";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import type { FileWriter } from "./file-writer";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_TARGET = "file";
const PURGE_PAGE = { limit: 100, offset: 0 };

export interface PurgeReport {
  purged: number;
  /** Listed as due but restored or already gone when its turn came. */
  skipped: number;
  failed: number;
}

export interface TrashServiceDeps {
  repository: Repository;
  store: FileStore;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  ids: IdGenerator;
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
    if (file.version !== expectedVersion) {
      throw conflict("stale");
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
   * Erases files trashed more than 30 days ago. The record goes first, together with its audit
   * entry and only if the file is still due, so a file restored at the last moment is never
   * erased; the body is removed afterwards. A failure on one file is recorded and the remaining
   * files are still processed.
   */
  async purgeExpired(actor: Actor): Promise<PurgeReport> {
    await this.deps.guard.require(actor, "maintenance.run", { type: FILE_TARGET, id: "purge" });
    const report: PurgeReport = { purged: 0, skipped: 0, failed: 0 };
    const threshold = this.purgeThreshold();
    for (;;) {
      // Files that failed stay in the listing, so later pages are reached by skipping them.
      const due = await this.deps.repository.files.listTrashedBefore(threshold, { limit: PURGE_PAGE.limit, offset: report.failed });
      if (due.length === 0) {
        return report;
      }
      for (const file of due) {
        report[await this.purgeOne(actor, file, threshold)] += 1;
      }
    }
  }

  private async purgeOne(actor: Actor, file: FileRecord, threshold: Date): Promise<keyof PurgeReport> {
    try {
      const erased = await this.deps.repository.files.purge(file.id, threshold, {
        id: this.deps.ids.newId(),
        actorUserId: actorUserId(actor),
        action: "file.purge",
        targetType: FILE_TARGET,
        targetId: file.id,
        result: "ok",
        occurredAt: this.deps.writer.now(),
      });
      if (!erased) {
        // Restored or already gone in the meantime: nothing to do and nothing failed.
        return "skipped";
      }
      await this.deps.store.delete(file.r2Key);
      return "purged";
    } catch (error) {
      await this.recordFailure(actor, file, error);
      return "failed";
    }
  }

  /** Recording a failure must not abort the job. */
  private async recordFailure(actor: Actor, file: FileRecord, error: unknown): Promise<void> {
    try {
      await this.deps.audit.record(actor, "file.purge", FILE_TARGET, file.id, "failed");
      await this.deps.metrics.record("purge.failed", file.clientId, { fileId: file.id, error: error instanceof Error ? error.name : "unknown" });
    } catch {
      // The failure is still counted in the report returned to the caller.
    }
  }
}
