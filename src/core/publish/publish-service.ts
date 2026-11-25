import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import type { AutoPublisher } from "../intake/intake-service";
import type { FileWriter } from "../intake/file-writer";
import { systemActor, type Actor } from "../model/actor";
import { conflict, DomainError, invalidInput, invalidState, notFound } from "../model/errors";
import {
  INCIDENT_WITHDRAW_REASONS, WITHDRAW_REASONS, type FileReceipt, type FileRecord, type Id, type WithdrawReason,
} from "../model/types";
import type { Notifier } from "../ports/notifier";
import type { Repository } from "../ports/repository";

export interface PublishRequest {
  fileId: Id;
  /** Version the staff member saw when choosing the file. */
  version: number;
}

export const PUBLISH_SKIP_REASONS = ["not_found", "not_staged", "client_not_active", "stale"] as const;
export type PublishSkipReason = (typeof PUBLISH_SKIP_REASONS)[number];

export type PublishResult =
  /** `warning` is set when the file is published but recording it (audit, metric, case update) failed. */
  | { fileId: Id; outcome: "published"; clientId: Id; warning?: "followup_failed" }
  | { fileId: Id; outcome: "skipped"; reason: PublishSkipReason };

export const AFTER_WITHDRAW = ["NeedsReview", "Trashed"] as const;
export type AfterWithdraw = (typeof AFTER_WITHDRAW)[number];

export interface WithdrawInput {
  reason: WithdrawReason;
  /** What happens to the file after it is withdrawn. */
  next: AfterWithdraw;
}

/** A mis-delivery as it was when the file was withdrawn, whatever happened to the file afterwards. */
export interface Incident {
  file: FileRecord;
  /** The client that had the file when it was withdrawn. */
  clientId: Id;
  /** The reason given at that withdrawal. */
  reason: WithdrawReason;
  /** When the file was withdrawn. */
  occurredAt: Date;
  /** The views up to the withdrawal. A view after a later publication is not part of the incident. */
  receipts: FileReceipt[];
}

export interface IncidentList {
  /** The most recently withdrawn incidents, up to the requested limit. */
  items: Incident[];
  /** Every incident, including those beyond the limit. */
  total: number;
  /** True when more incidents exist than `items` holds. */
  truncated: boolean;
}

const FILE_TARGET = "file";
/** The most incidents one answer may hold. */
export const MAX_INCIDENTS = 100;

export interface PublishServiceDeps {
  repository: Repository;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  writer: FileWriter;
  cases: CaseService;
  notifier: Notifier;
}

/** Publishing, automatic publishing and withdrawal. Clients only ever see Published files. */
export class PublishService implements AutoPublisher {
  constructor(private readonly deps: PublishServiceDeps) {}

  /**
   * Publishes the chosen files one by one. Each file is re-checked at the moment of publishing;
   * a file that fails the check is skipped with a reason and the others are still published.
   */
  async publish(actor: Actor, requests: readonly PublishRequest[]): Promise<PublishResult[]> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: "publish" });
    const results: PublishResult[] = [];
    for (const request of requests) {
      results.push(await this.publishOne(actor, request, "file.publish"));
    }
    await this.notifyClients(results);
    return results;
  }

  /** Publishes right after intake when the office enabled it and the file meets all three conditions. */
  async autoPublishIfEligible(fileId: Id): Promise<boolean> {
    const setting = await this.deps.repository.settings.get();
    const file = await this.deps.repository.files.findById(fileId);
    if (!setting.autoPublishEnabled || file === null || file.resolutionMethod !== "ArrivalNumber" || file.docTypeId === null) {
      return false;
    }
    const result = await this.publishOne(systemActor(), { fileId, version: file.version }, "file.auto_publish");
    await this.notifyClients([result]);
    return result.outcome === "published";
  }

  /**
   * Withdraws a published file. From this moment clients can neither see nor download it.
   * The file is hidden first and receipts are read afterwards, so a member who opens it at the
   * same moment is either refused or counted. Calling it again for a file left in `Withdrawn`
   * finishes the move to review or trash.
   */
  async withdraw(actor: Actor, fileId: Id, input: WithdrawInput, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    if (!WITHDRAW_REASONS.includes(input.reason) || !AFTER_WITHDRAW.includes(input.next)) {
      throw invalidInput("withdraw");
    }
    const file = await this.deps.repository.files.findById(fileId);
    if (file === null) {
      throw notFound("file");
    }
    if (file.direction !== "Outbound" || (file.state !== "Published" && file.state !== "Withdrawn")) {
      throw invalidState("not_published");
    }
    const hidden =
      file.state === "Withdrawn"
        ? file
        : await this.deps.writer.update({ ...file, state: "Withdrawn", withdrawReason: input.reason }, expectedVersion);
    if (hidden.version !== (file.state === "Withdrawn" ? expectedVersion : expectedVersion + 1)) {
      throw conflict("stale");
    }
    const reason = hidden.withdrawReason ?? input.reason;
    const receipts = await this.deps.repository.receipts.listByFile(fileId);
    const incident = receipts.length > 0 && INCIDENT_WITHDRAW_REASONS.includes(reason);
    // The incident is recorded with the client, reason and time of this withdrawal, in the same
    // write that settles the file, so a later assignment to another client cannot rewrite it.
    const flagged: FileRecord = incident
      ? { ...hidden, incidentFlag: true, incidentClientId: file.clientId, incidentReason: reason, incidentAt: this.deps.writer.now() }
      : hidden;
    const settled = await this.settleWithdrawn(flagged, input.next);
    await this.bestEffort(async () => {
      await this.deps.audit.record(actor, "file.withdraw", FILE_TARGET, fileId);
      await this.deps.metrics.record("file.withdrawn", file.clientId, { fileId, reason, incident, opened: receipts.length });
    });
    if (file.caseId !== null) {
      await this.deps.cases.onFileEvent(file.caseId);
    }
    return settled;
  }

  /**
   * Withdrawn files that had already been opened by a client member, with the client that had
   * each one, who opened it before the withdrawal and when. Owner only. The most recently
   * withdrawn come first; at most `limit` are returned and `total` counts all of them.
   */
  async listIncidents(actor: Actor, limit: number): Promise<IncidentList> {
    await this.deps.guard.require(actor, "incident.read", { type: FILE_TARGET, id: "incidents" });
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INCIDENTS) {
      throw invalidInput("limit");
    }
    const total = await this.deps.repository.files.count({ incidentOnly: true });
    const files = await this.deps.repository.files.listIncidents({ limit, offset: 0 });
    const receipts = await this.deps.repository.receipts.listByFiles(files.map((file) => file.id));
    const items = files.map((file): Incident => {
      const { incidentClientId: clientId, incidentReason: reason, incidentAt: occurredAt } = file;
      if (clientId === null || reason === null || occurredAt === null) {
        throw invalidState("incident_record");
      }
      const opened = receipts.filter((receipt) => receipt.fileId === file.id && receipt.firstViewedAt.getTime() <= occurredAt.getTime());
      return { file, clientId, reason, occurredAt, receipts: opened };
    });
    return { items, total, truncated: total > items.length };
  }

  private async settleWithdrawn(withdrawn: FileRecord, next: AfterWithdraw): Promise<FileRecord> {
    const change: FileRecord =
      next === "NeedsReview"
        ? { ...withdrawn, state: "NeedsReview", reviewReason: "Withdrawn", reviewDetail: null }
        : { ...withdrawn, state: "Trashed", trashedFrom: "Withdrawn", trashedAt: this.deps.writer.now() };
    return this.deps.writer.update(change, withdrawn.version);
  }

  private async publishOne(actor: Actor, request: PublishRequest, action: string): Promise<PublishResult> {
    const skip = (reason: PublishSkipReason): PublishResult => ({ fileId: request.fileId, outcome: "skipped", reason });
    const file = await this.deps.repository.files.findById(request.fileId);
    if (file === null) {
      return skip("not_found");
    }
    if (file.direction !== "Outbound" || file.state !== "Staged" || file.clientId === null) {
      return skip("not_staged");
    }
    const client = await this.deps.repository.clients.findById(file.clientId);
    if (client === null || client.status !== "Active") {
      return skip("client_not_active");
    }
    if (file.version !== request.version) {
      return skip("stale");
    }
    const publishedAt = this.deps.writer.now();
    try {
      await this.deps.writer.update({ ...file, state: "Published", publishedAt }, request.version);
    } catch (error) {
      if (error instanceof DomainError && error.detail === "stale") {
        return skip("stale");
      }
      throw error;
    }
    // The file is published from here on. A failure while recording it must not report the
    // file as failed or stop the remaining files; it is returned as a warning instead.
    const recorded = await this.bestEffort(async () => {
      await this.deps.audit.record(actor, action, FILE_TARGET, file.id);
      await this.deps.metrics.record("file.published", file.clientId, {
        fileId: file.id,
        method: file.resolutionMethod,
        automatic: actor.kind === "system",
        secondsSinceReceived: Math.round((publishedAt.getTime() - file.receivedAt.getTime()) / 1000),
      });
      if (file.caseId !== null) {
        await this.deps.cases.onFileEvent(file.caseId);
      }
    });
    return recorded
      ? { fileId: file.id, outcome: "published", clientId: file.clientId }
      : { fileId: file.id, outcome: "published", clientId: file.clientId, warning: "followup_failed" };
  }

  /** Runs follow-up work whose failure must not change the outcome. Returns whether it succeeded. */
  private async bestEffort(work: () => Promise<void>): Promise<boolean> {
    try {
      await work();
      return true;
    } catch {
      return false;
    }
  }

  /** One notification per client. A notification failure is recorded and never undoes or blocks publishing. */
  private async notifyClients(results: readonly PublishResult[]): Promise<void> {
    const clientIds = new Set(results.flatMap((result) => (result.outcome === "published" ? [result.clientId] : [])));
    for (const clientId of clientIds) {
      try {
        await this.deps.notifier.notifyNewDocument(clientId);
      } catch (error) {
        await this.bestEffort(() => this.deps.metrics.record("notify.failed", clientId, { error: error instanceof Error ? error.name : "unknown" }));
      }
    }
  }
}
