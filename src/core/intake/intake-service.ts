import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import type { Actor, UserActor } from "../model/actor";
import { invalidInput, notFound } from "../model/errors";
import type { FileRecord, Id, KeyEvidence, RejectionReason, UploadBatch } from "../model/types";
import type { FileStore } from "../ports/file-store";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import { ClientResolver, type Resolution } from "./client-resolver";
import type { IntakeJev, IntakeJudgement } from "./classification-service";
import { decideByRules, type TypeDecision } from "./doc-type-decider";
import { stemOf } from "./file-name";
import { validateFile, type IncomingFile } from "./file-validator";
import type { FileWriter } from "./file-writer";
import { extractKeys } from "./key-extractor";
import { sha256Hex } from "./sha256";

export type IntakeResult =
  | { outcome: "rejected"; reason: RejectionReason }
  | { outcome: "duplicate"; existingFileId: Id; existingDisplayName: string; clientId: Id }
  | { outcome: "stored"; file: FileRecord; published: boolean };

/** Publishes a freshly accepted file when the office enabled automatic publishing and the file qualifies. */
export interface AutoPublisher {
  autoPublishIfEligible(fileId: Id): Promise<boolean>;
}

/** Lets Jev choose the type of a file being accepted, when the rules did not decide it. */
export interface IntakeJudge {
  judgeAtIntake(fileId: Id, fileName: string, request: IntakeJev): Promise<IntakeJudgement | null>;
}

export const FILE_KEY_PREFIX = "files/";
const FILE_TARGET = "file";
const BATCH_TARGET = "batch";

export interface IntakeServiceDeps {
  repository: Repository;
  store: FileStore;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  ids: IdGenerator;
  writer: FileWriter;
  cases: CaseService;
  autoPublisher: AutoPublisher;
  judge: IntakeJudge;
}

/** Accepts files one by one: validate, detect duplicates, read identifiers, resolve the client, decide the type. */
export class IntakeService {
  private readonly resolver: ClientResolver;

  constructor(private readonly deps: IntakeServiceDeps) {
    this.resolver = new ClientResolver(deps.repository);
  }

  /** Starts one intake. `hintClientId` is the destination the staff chose, if any. */
  async openBatch(actor: UserActor, hintClientId: Id | null): Promise<UploadBatch> {
    await this.deps.guard.require(actor, "staff.operate", { type: BATCH_TARGET, id: hintClientId ?? "none" });
    if (hintClientId !== null && (await this.deps.repository.clients.findById(hintClientId)) === null) {
      throw notFound("client");
    }
    const batch: UploadBatch = { id: this.deps.ids.newId(), uploadedBy: actor.userId, hintClientId, createdAt: this.deps.writer.now() };
    await this.deps.repository.files.insertBatch(batch);
    await this.deps.audit.record(actor, "batch.open", BATCH_TARGET, batch.id);
    return batch;
  }

  /**
   * Accepts one file of a batch. A rejected file is not stored; the caller continues with the next one.
   * `jev` is the browser's Jev key and model. Without it, a file the rules leave open stays untyped.
   */
  async accept(actor: UserActor, batchId: Id, incoming: IncomingFile, jev: IntakeJev | null = null): Promise<IntakeResult> {
    await this.deps.guard.require(actor, "staff.operate", { type: BATCH_TARGET, id: batchId });
    const batch = await this.deps.repository.files.findBatch(batchId);
    if (batch === null) {
      throw notFound("batch");
    }
    if (batch.uploadedBy !== actor.userId) {
      throw invalidInput("batch_owner");
    }
    const validation = validateFile(incoming);
    if (!validation.ok) {
      await this.deps.metrics.record(actor, "intake.rejected", null, { reason: validation.reason });
      await this.deps.audit.record(actor, "file.reject", BATCH_TARGET, batch.id, "failed");
      return { outcome: "rejected", reason: validation.reason };
    }
    const sha256 = await sha256Hex(incoming.bytes);
    const resolution = await this.resolve(incoming, validation.format, batch.hintClientId);
    const copies = await this.deps.repository.files.findActiveBySha256(sha256);
    const sameClient = copies.find((copy) => resolution.clientId !== null && copy.clientId === resolution.clientId);
    if (sameClient !== undefined && sameClient.clientId !== null) {
      return this.duplicate(actor, sameClient);
    }
    const id = this.deps.ids.newId();
    // Rules first. Jev is asked only when they leave the type open, and before anything is stored, so a refused call leaves nothing behind.
    const rule = decideByRules(
      stemOf(incoming.fileName),
      "Outbound",
      await this.deps.repository.docTypes.list(),
      await this.deps.repository.docTypes.listRules(),
    );
    const judgement = rule.docTypeId === null && jev !== null ? await this.deps.judge.judgeAtIntake(id, incoming.fileName, jev) : null;
    const draft = await this.draft(id, batch, incoming, validation.format, sha256, this.withCopies(resolution, copies), rule, judgement);
    await this.deps.store.put(draft.r2Key, incoming.bytes);
    const written = await this.insertOrRemoveBody(draft);
    if (written.result === "duplicate_content") {
      const winner = (await this.deps.repository.files.findActiveBySha256(sha256)).find((copy) => copy.clientId === draft.clientId);
      if (winner === undefined || winner.clientId === null) {
        throw notFound("file");
      }
      return this.duplicate(actor, winner);
    }
    return this.afterStored(actor, written.file, judgement);
  }

  /** A body must never stay in the store without a record: it is removed whenever the record is not written. */
  private async insertOrRemoveBody(draft: FileRecord): Promise<Awaited<ReturnType<FileWriter["insert"]>>> {
    let written: Awaited<ReturnType<FileWriter["insert"]>>;
    try {
      written = await this.deps.writer.insert(draft);
    } catch (error) {
      await this.deps.store.delete(draft.r2Key);
      throw error;
    }
    if (written.result === "duplicate_content") {
      await this.deps.store.delete(draft.r2Key);
    }
    return written;
  }

  private async resolve(incoming: IncomingFile, format: FileRecord["format"], hintClientId: Id | null): Promise<Resolution> {
    const setting = await this.deps.repository.settings.get();
    const clients = await this.deps.repository.clients.listAll();
    const keys = extractKeys(
      { fileName: incoming.fileName, format, bytes: incoming.bytes },
      { arrivalNumberPattern: setting.arrivalNumberPattern, clientCodes: clients.map((client) => client.code) },
    );
    return this.resolver.resolve(keys, hintClientId);
  }

  /** Same content held for another client turns the file into a review item. */
  private withCopies(resolution: Resolution, copies: readonly FileRecord[]): Resolution {
    const elsewhere = [...new Set(copies.map((copy) => copy.clientId).filter((id): id is Id => id !== null && id !== resolution.clientId))];
    if (elsewhere.length === 0) {
      return resolution;
    }
    const evidence: KeyEvidence[] = [...resolution.evidence, ...elsewhere.map((clientId) => ({ kind: "ExistingCopy" as const, clientId }))];
    if (resolution.reviewReason !== null) {
      return { ...resolution, evidence };
    }
    return { clientId: null, caseId: null, method: null, reviewReason: "DuplicateAcrossClients", unmatchedArrivalNumber: null, evidence };
  }

  private async draft(
    id: Id,
    batch: UploadBatch,
    incoming: IncomingFile,
    format: FileRecord["format"],
    sha256: string,
    resolution: Resolution,
    type: TypeDecision,
    judgement: IntakeJudgement | null,
  ): Promise<FileRecord> {
    const needsReview = resolution.reviewReason !== null;
    // A type is set by Jev only when its confidence reached the threshold. Otherwise the answer is kept as a candidate.
    const jevAccepted = judgement !== null && judgement.accepted;
    return {
      id,
      batchId: batch.id,
      direction: "Outbound",
      clientId: resolution.clientId,
      caseId: resolution.caseId,
      docTypeId: type.docTypeId ?? (jevAccepted ? judgement.choiceId : null),
      // A document linked to a case is filed under that case's month.
      targetMonth: resolution.caseId === null ? null : ((await this.deps.repository.cases.findById(resolution.caseId))?.targetMonth ?? null),
      displayName: "",
      format,
      sha256,
      sizeBytes: incoming.bytes.length,
      r2Key: `${FILE_KEY_PREFIX}${id}`,
      state: needsReview ? "NeedsReview" : "Staged",
      trashedFrom: null,
      resolutionMethod: resolution.method,
      reviewReason: resolution.reviewReason,
      reviewDetail: needsReview ? resolution.evidence : null,
      unmatchedArrivalNumber: resolution.unmatchedArrivalNumber,
      typeSource: type.source ?? (jevAccepted ? "Jev" : null),
      jevModel: judgement?.model ?? null,
      jevConfidence: judgement?.confidence ?? null,
      jevCandidateDocTypeId: judgement !== null && !judgement.accepted ? judgement.choiceId : null,
      withdrawReason: null,
      incidentFlag: false,
      incidentClientId: null,
      incidentReason: null,
      incidentAt: null,
      receivedAt: this.deps.writer.now(),
      publishedAt: null,
      acknowledgedAt: null,
      trashedAt: null,
      version: 1,
    };
  }

  private async afterStored(actor: Actor, file: FileRecord, judgement: IntakeJudgement | null): Promise<IntakeResult> {
    await this.deps.audit.record(actor, "file.accept", FILE_TARGET, file.id);
    if (judgement !== null) {
      await this.deps.audit.record(actor, "file.classify", FILE_TARGET, file.id);
      await this.deps.metrics.record(actor, "jev.classified", file.clientId, {
        fileId: file.id,
        model: judgement.model,
        confidence: judgement.confidence,
        accepted: judgement.accepted,
      });
    }
    await this.deps.metrics.record(actor, "intake.accepted", file.clientId, {
      fileId: file.id,
      state: file.state,
      method: file.resolutionMethod,
      reviewReason: file.reviewReason,
      typeSource: file.typeSource,
    });
    if (file.caseId !== null) {
      await this.deps.cases.onFileEvent(file.caseId);
    }
    const published = file.state === "Staged" && (await this.deps.autoPublisher.autoPublishIfEligible(file.id));
    const current = published ? await this.deps.repository.files.findById(file.id) : file;
    return { outcome: "stored", file: current ?? file, published };
  }

  private async duplicate(actor: Actor, existing: FileRecord & { clientId: Id | null }): Promise<IntakeResult> {
    if (existing.clientId === null) {
      throw notFound("file");
    }
    await this.deps.audit.record(actor, "file.duplicate", FILE_TARGET, existing.id);
    await this.deps.metrics.record(actor, "intake.duplicate", existing.clientId, { fileId: existing.id });
    return { outcome: "duplicate", existingFileId: existing.id, existingDisplayName: existing.displayName, clientId: existing.clientId };
  }
}
