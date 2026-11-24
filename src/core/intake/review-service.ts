import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { CaseService } from "../cases/case-service";
import type { Actor } from "../model/actor";
import { conflict, invalidInput, invalidState, notFound } from "../model/errors";
import { CONFIRMATION_REQUIRED_REASONS, type FileRecord, type FileState, type Id } from "../model/types";
import type { Repository } from "../ports/repository";
import type { FileWriter } from "./file-writer";

export interface AssignInput {
  clientId: Id;
  caseId: Id | null;
  /** Omit to keep the current type; null clears it. */
  docTypeId?: Id | null;
  /** Must be true when the review reason is a conflict, a hint mismatch or a duplicate across clients. */
  confirmed: boolean;
}

const FILE_TARGET = "file";
/** States from which staff may move an outbound file to the trash. Published files must be withdrawn first. */
const TRASHABLE_OUTBOUND: readonly FileState[] = ["NeedsReview", "Staged", "Withdrawn"];
const TRASHABLE_INBOUND: readonly FileState[] = ["Acknowledged"];

export interface ReviewServiceDeps {
  repository: Repository;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  writer: FileWriter;
  cases: CaseService;
}

/** Resolves review items by an explicit staff decision, and moves files back or to the trash. */
export class ReviewService {
  constructor(private readonly deps: ReviewServiceDeps) {}

  /** Assigns client, case and type to a file that needs review and stages it. */
  async assign(actor: Actor, fileId: Id, input: AssignInput, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.requireFile(fileId, expectedVersion);
    if (file.direction !== "Outbound" || file.state !== "NeedsReview") {
      throw invalidState("not_in_review");
    }
    const flagged = file.reviewReason !== null && CONFIRMATION_REQUIRED_REASONS.includes(file.reviewReason);
    if ((flagged || (await this.heldByAnotherClient(file, input.clientId))) && !input.confirmed) {
      throw invalidInput("confirmation_required");
    }
    await this.validateTarget(input, file);
    const docTypeId = input.docTypeId === undefined ? file.docTypeId : input.docTypeId;
    const typeChanged = docTypeId !== file.docTypeId;
    const updated = await this.deps.writer.update(
      {
        ...file,
        clientId: input.clientId,
        caseId: input.caseId,
        docTypeId,
        typeSource: typeChanged ? (docTypeId === null ? null : "Staff") : file.typeSource,
        state: "Staged",
        resolutionMethod: "StaffSelected",
        reviewReason: null,
        reviewDetail: null,
      },
      expectedVersion,
      true,
    );
    await this.deps.audit.record(actor, "file.assign", FILE_TARGET, fileId);
    await this.deps.metrics.record("review.assigned", updated.clientId, {
      fileId,
      reason: file.reviewReason,
      clientChanged: file.clientId !== null && file.clientId !== input.clientId,
      typeChanged,
    });
    await this.notifyCases(file.caseId, updated.caseId);
    return updated;
  }

  /** Changes only the document type of a file that is waiting to be published. */
  async setDocType(actor: Actor, fileId: Id, docTypeId: Id | null, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.requireFile(fileId, expectedVersion);
    if (file.direction !== "Outbound" || (file.state !== "Staged" && file.state !== "NeedsReview")) {
      throw invalidState("not_editable");
    }
    await this.requireDocType(docTypeId, file);
    const updated = await this.deps.writer.update(
      { ...file, docTypeId, typeSource: docTypeId === null ? null : "Staff" },
      expectedVersion,
      true,
    );
    await this.deps.audit.record(actor, "file.set_type", FILE_TARGET, fileId);
    await this.deps.metrics.record("review.type_changed", updated.clientId, { fileId, previousSource: file.typeSource });
    return updated;
  }

  /** Sends a staged file back to review. */
  async sendBack(actor: Actor, fileId: Id, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.requireFile(fileId, expectedVersion);
    if (file.direction !== "Outbound" || file.state !== "Staged") {
      throw invalidState("not_staged");
    }
    const updated = await this.deps.writer.update(
      // The earlier routing decision no longer stands: a fresh assignment is needed before publishing.
      { ...file, state: "NeedsReview", reviewReason: "SentBack", reviewDetail: null, resolutionMethod: null },
      expectedVersion,
    );
    await this.deps.audit.record(actor, "file.send_back", FILE_TARGET, fileId);
    await this.deps.metrics.record("review.sent_back", updated.clientId, { fileId });
    await this.notifyCases(file.caseId, updated.caseId);
    return updated;
  }

  /** Moves a file to the trash. Published files cannot be trashed directly. */
  async trash(actor: Actor, fileId: Id, expectedVersion: number): Promise<FileRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: fileId });
    const file = await this.requireFile(fileId, expectedVersion);
    if (file.state === "Published") {
      throw invalidState("published_must_be_withdrawn");
    }
    const allowed = file.direction === "Outbound" ? TRASHABLE_OUTBOUND : TRASHABLE_INBOUND;
    if (!allowed.includes(file.state)) {
      throw invalidState("not_trashable");
    }
    const updated = await this.deps.writer.update(
      { ...file, state: "Trashed", trashedFrom: file.state, trashedAt: this.deps.writer.now() },
      expectedVersion,
    );
    await this.deps.audit.record(actor, "file.trash", FILE_TARGET, fileId);
    await this.deps.metrics.record("file.trashed", updated.clientId, { fileId, from: file.state });
    await this.notifyCases(file.caseId, null);
    return updated;
  }

  /**
   * Whatever the recorded reason says, assigning content that another client already holds needs
   * an explicit confirmation. The copies are looked up now, so a copy that appeared after intake counts too.
   */
  private async heldByAnotherClient(file: FileRecord, clientId: Id): Promise<boolean> {
    const copies = await this.deps.repository.files.findActiveBySha256(file.sha256);
    return copies.some((copy) => copy.id !== file.id && copy.clientId !== null && copy.clientId !== clientId);
  }

  private async validateTarget(input: AssignInput, file: FileRecord): Promise<void> {
    const client = await this.deps.repository.clients.findById(input.clientId);
    if (client === null) {
      throw notFound("client");
    }
    if (client.status !== "Active") {
      throw invalidState("client_not_active");
    }
    if (input.caseId !== null) {
      const linked = await this.deps.repository.cases.findById(input.caseId);
      if (linked === null || linked.clientId !== input.clientId) {
        throw invalidInput("case");
      }
      if (linked.state === "Cancelled" || linked.state === "Closed") {
        throw invalidState("case_terminal");
      }
    }
    if (input.docTypeId !== undefined) {
      await this.requireDocType(input.docTypeId, file);
    }
  }

  private async requireDocType(docTypeId: Id | null, file: FileRecord): Promise<void> {
    if (docTypeId === null) {
      return;
    }
    const docType = await this.deps.repository.docTypes.findById(docTypeId);
    if (docType === null || (docType.direction !== "Both" && docType.direction !== file.direction)) {
      throw invalidInput("doc_type");
    }
  }

  private async notifyCases(before: Id | null, after: Id | null): Promise<void> {
    for (const caseId of new Set([before, after])) {
      if (caseId !== null) {
        await this.deps.cases.onFileEvent(caseId);
      }
    }
  }

  /** Loads the file and refuses to act on a version other than the one the staff member saw. */
  private async requireFile(id: Id, expectedVersion: number): Promise<FileRecord> {
    const file = await this.deps.repository.files.findById(id);
    if (file === null) {
      throw notFound("file");
    }
    if (file.version !== expectedVersion) {
      throw conflict("stale");
    }
    return file;
  }
}
