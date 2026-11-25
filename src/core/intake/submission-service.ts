import { auditableId, type Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import { TERMINAL_CASE_STATES } from "../cases/case-state";
import type { Actor, UserActor } from "../model/actor";
import { conflict, invalidInput, invalidState, notFound } from "../model/errors";
import { CASE_STATES, type DocType, type FileRecord, type Id, type RejectionReason, type YearMonth } from "../model/types";
import type { FileStore } from "../ports/file-store";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import { validateFile, type IncomingFile } from "./file-validator";
import type { FileWriter } from "./file-writer";
import { FILE_KEY_PREFIX } from "./intake-service";
import { sha256Hex } from "./sha256";

export interface SubmissionInput {
  clientId: Id;
  docTypeId: Id;
  targetMonth: YearMonth;
}

export type SubmissionResult =
  | { outcome: "rejected"; reason: RejectionReason }
  /** `existingFileId` is given only when the submitter is allowed to see that file. */
  | { outcome: "duplicate"; existingFileId: Id | null }
  | { outcome: "stored"; file: FileRecord };

const TARGET_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FILE_TARGET = "file";
const CLIENT_TARGET = "client";
const OPEN_CASE_STATES = CASE_STATES.filter((state) => !TERMINAL_CASE_STATES.includes(state));
/** The monthly case of instructions.md 1.6.7: the only kind a submission moves on (MaterialsReceived). */
const MONTHLY_CASE_KIND = "Payroll";
/** Two rows are enough to tell "exactly one" from "several". */
const CASE_PAGE = { limit: 2, offset: 0 };

export interface SubmissionServiceDeps {
  repository: Repository;
  store: FileStore;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  ids: IdGenerator;
  writer: FileWriter;
  cases: CaseService;
}

/** Files sent by client members to the office (instructions.md 1.6.7). The destination is always the submitter's own client. */
export class SubmissionService {
  constructor(private readonly deps: SubmissionServiceDeps) {}

  async submit(actor: UserActor, input: SubmissionInput, incoming: IncomingFile): Promise<SubmissionResult> {
    await this.requireReach(actor, "client.submit", input.clientId);
    const docType = await this.validate(input);
    const validation = validateFile(incoming);
    if (!validation.ok) {
      await this.deps.metrics.record("submission.rejected", input.clientId, { reason: validation.reason });
      return { outcome: "rejected", reason: validation.reason };
    }
    const sha256 = await sha256Hex(incoming.bytes);
    const copies = await this.deps.repository.files.findActiveBySha256(sha256);
    const own = copies.find((copy) => copy.clientId === input.clientId);
    if (own !== undefined) {
      return this.duplicate(actor, own);
    }
    const now = this.deps.writer.now();
    const batchId = this.deps.ids.newId();
    await this.deps.repository.files.insertBatch({ id: batchId, uploadedBy: actor.userId, hintClientId: input.clientId, createdAt: now });
    const id = this.deps.ids.newId();
    const draft: FileRecord = {
      id, batchId, direction: "Inbound", clientId: input.clientId, caseId: await this.matchingCase(input, docType),
      docTypeId: input.docTypeId, targetMonth: input.targetMonth, displayName: "", format: validation.format, sha256,
      sizeBytes: incoming.bytes.length, r2Key: `${FILE_KEY_PREFIX}${id}`, state: "Submitted", trashedFrom: null,
      resolutionMethod: null, reviewReason: null, reviewDetail: null, unmatchedArrivalNumber: null, typeSource: null,
      jevModel: null, jevConfidence: null, jevCandidateDocTypeId: null, withdrawReason: null, incidentFlag: false,
      receivedAt: now, publishedAt: null, acknowledgedAt: null, trashedAt: null, version: 1,
    };
    await this.deps.store.put(draft.r2Key, incoming.bytes);
    let written: Awaited<ReturnType<FileWriter["insert"]>>;
    try {
      written = await this.deps.writer.insert(draft);
    } catch (error) {
      // A body must never stay in the store without a record.
      await this.deps.store.delete(draft.r2Key);
      throw error;
    }
    if (written.result === "duplicate_content") {
      await this.deps.store.delete(draft.r2Key);
      const winner = (await this.deps.repository.files.findActiveBySha256(sha256)).find((copy) => copy.clientId === input.clientId);
      return this.duplicate(actor, winner ?? null);
    }
    await this.deps.audit.record(actor, "file.submit", FILE_TARGET, written.file.id);
    await this.deps.metrics.record("submission.received", input.clientId, {
      fileId: written.file.id,
      linked: written.file.caseId !== null,
      heldByOtherClient: copies.some((copy) => copy.clientId !== null),
    });
    if (written.file.caseId !== null) {
      await this.deps.cases.onFileEvent(written.file.caseId);
    }
    return { outcome: "stored", file: written.file };
  }

  /** The submitter withdraws a submission that the office has not opened yet. */
  async cancel(actor: UserActor, fileId: Id, expectedVersion: number): Promise<FileRecord> {
    const file = await this.deps.repository.files.findById(fileId);
    const batch = file === null ? null : await this.deps.repository.files.findBatch(file.batchId);
    if (file === null || batch === null || !this.deps.guard.allows(actor, "file.read", { file })) {
      await this.deps.audit.record(actor, "submission.cancel", FILE_TARGET, auditableId(fileId), "denied");
      throw notFound("file");
    }
    if (!this.deps.guard.allows(actor, "submission.cancel", { file, submitterId: batch.uploadedBy })) {
      await this.deps.audit.record(actor, "submission.cancel", FILE_TARGET, auditableId(fileId), "denied");
      throw invalidState("not_cancellable");
    }
    if (file.version !== expectedVersion) {
      throw conflict("stale");
    }
    const updated = await this.deps.writer.update(
      { ...file, state: "Trashed", trashedFrom: "Submitted", trashedAt: this.deps.writer.now() },
      expectedVersion,
    );
    await this.deps.audit.record(actor, "submission.cancel", FILE_TARGET, fileId);
    await this.deps.metrics.record("submission.cancelled", file.clientId, { fileId });
    if (file.caseId !== null) {
      await this.deps.cases.onFileEvent(file.caseId);
    }
    return updated;
  }

  /** Staff link a submission to a case, or remove the link, when it could not be matched automatically. */
  async linkCase(actor: Actor, fileId: Id, caseId: Id | null, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.deps.repository.files.findById(fileId);
    if (file === null) {
      throw notFound("file");
    }
    if (file.version !== expectedVersion) {
      throw conflict("stale");
    }
    if (file.direction !== "Inbound" || file.state === "Trashed") {
      throw invalidState("not_a_submission");
    }
    if (caseId !== null) {
      const target = await this.deps.repository.cases.findById(caseId);
      if (target === null || target.clientId !== file.clientId) {
        throw invalidInput("case");
      }
      if (TERMINAL_CASE_STATES.includes(target.state)) {
        throw invalidState("case_terminal");
      }
    }
    const updated = await this.deps.writer.update({ ...file, caseId }, expectedVersion);
    await this.deps.audit.record(actor, "submission.link_case", FILE_TARGET, fileId);
    for (const affected of new Set([file.caseId, caseId])) {
      if (affected !== null) {
        await this.deps.cases.onFileEvent(affected);
      }
    }
    return updated;
  }

  /**
   * Linked only when the document type names a case type and exactly one open monthly (Payroll) case of
   * that client, that month and that case type exists (instructions.md 1.6.7); otherwise staff decide.
   */
  private async matchingCase(input: SubmissionInput, docType: DocType): Promise<Id | null> {
    if (docType.caseTypeId === null) {
      return null;
    }
    const candidates = await this.deps.repository.cases.list(
      { clientId: input.clientId, caseTypeId: docType.caseTypeId, kind: MONTHLY_CASE_KIND, targetMonth: input.targetMonth, states: OPEN_CASE_STATES },
      CASE_PAGE,
    );
    const [only, ...others] = candidates;
    return only === undefined || others.length > 0 ? null : only.id;
  }

  private async validate(input: SubmissionInput): Promise<DocType> {
    if (!TARGET_MONTH.test(input.targetMonth)) {
      throw invalidInput("target_month");
    }
    const docType = await this.deps.repository.docTypes.findById(input.docTypeId);
    if (docType === null || docType.direction === "Outbound") {
      throw invalidInput("doc_type");
    }
    return docType;
  }

  private async duplicate(actor: UserActor, existing: FileRecord | null): Promise<SubmissionResult> {
    const visible = existing !== null && this.deps.guard.allows(actor, "file.read", { file: existing });
    return { outcome: "duplicate", existingFileId: visible && existing !== null ? existing.id : null };
  }

  /** A client the member cannot reach is reported exactly like a client that does not exist. */
  private async requireReach(actor: UserActor, action: "client.submit" | "client.read", clientId: Id): Promise<void> {
    if (!this.deps.guard.allows(actor, action, { clientId })) {
      await this.deps.audit.record(actor, action, CLIENT_TARGET, auditableId(clientId), "denied");
      throw notFound("client");
    }
  }
}
