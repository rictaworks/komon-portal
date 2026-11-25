import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { Actor } from "../model/actor";
import { DomainError, invalidInput, invalidState } from "../model/errors";
import type { DocType, FileRecord, Id } from "../model/types";
import { ClassifierError, type ClassifierAnswer, type ClassifierPort } from "../ports/classifier";
import type { Repository } from "../ports/repository";
import { classifierTitle, isFixedModelName } from "./classifier-input";
import type { FileWriter } from "./file-writer";

export interface ClassificationItem {
  fileId: Id;
  /** File name as the browser still knows it right after intake. Used for this call only, never stored. */
  fileName: string;
}

export interface ClassificationRequest {
  model: string;
  /** The user's own key, used for the provider calls of this request only. */
  credential: string;
  items: readonly ClassificationItem[];
}

export const CLASSIFICATION_SKIP_REASONS = ["not_found", "not_unclassified", "no_title", "stale"] as const;
export type ClassificationSkipReason = (typeof CLASSIFICATION_SKIP_REASONS)[number];

export type ClassificationResult =
  | { fileId: Id; outcome: "classified"; docTypeId: Id; confidence: number }
  | { fileId: Id; outcome: "below_threshold"; candidateDocTypeId: Id; confidence: number }
  | { fileId: Id; outcome: "skipped"; reason: ClassificationSkipReason };

export interface ClassificationReport {
  /** Model name reported by the provider, or null when no call was needed. */
  model: string | null;
  results: ClassificationResult[];
}

/** Questions sent in one provider call (instructions.md 1.9). */
export const CLASSIFIER_BATCH_SIZE = 50;
export const MAX_CLASSIFICATION_ITEMS = 500;
const FILE_TARGET = "file";

interface Candidate {
  file: FileRecord;
  title: string;
}

export interface ClassificationServiceDeps {
  repository: Repository;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  writer: FileWriter;
  classifier: ClassifierPort;
}

/**
 * Labels the document type of unclassified files with the classifier. It never decides the client,
 * and a failure leaves every file as it was: routing and publishing do not depend on it.
 */
export class ClassificationService {
  constructor(private readonly deps: ClassificationServiceDeps) {}

  async classify(actor: Actor, request: ClassificationRequest): Promise<ClassificationReport> {
    await this.deps.guard.require(actor, "staff.operate", { type: FILE_TARGET, id: "classify" });
    if (!isFixedModelName(request.model)) {
      throw invalidInput("model");
    }
    if (request.credential === "") {
      throw invalidInput("credential");
    }
    if (request.items.length === 0 || request.items.length > MAX_CLASSIFICATION_ITEMS) {
      throw invalidInput("items");
    }
    const choices = (await this.deps.repository.docTypes.list()).filter((docType) => docType.direction !== "Inbound");
    if (choices.length === 0) {
      throw invalidState("no_doc_types");
    }
    const results: ClassificationResult[] = [];
    const candidates = await this.candidates(request.items, results);
    let model: string | null = null;
    for (let start = 0; start < candidates.length; start += CLASSIFIER_BATCH_SIZE) {
      const batch = candidates.slice(start, start + CLASSIFIER_BATCH_SIZE);
      // A provider error stops here and is reported as it is. There is no retry with another model or method.
      const response = await this.deps.classifier.choose({
        model: request.model,
        credential: request.credential,
        items: batch.map((candidate) => ({ id: candidate.file.id, text: candidate.title })),
        choices: choices.map((docType) => ({ id: docType.id, label: docType.label })),
      });
      model = response.model;
      for (const candidate of batch) {
        results.push(await this.apply(actor, candidate.file, this.answerFor(candidate.file.id, response.answers, choices), response.model));
      }
    }
    return { model, results };
  }

  private async candidates(items: readonly ClassificationItem[], results: ClassificationResult[]): Promise<Candidate[]> {
    const setting = await this.deps.repository.settings.get();
    const clientCodes = (await this.deps.repository.clients.listAll()).map((client) => client.code);
    const candidates: Candidate[] = [];
    const seen = new Set<Id>();
    for (const item of items) {
      if (seen.has(item.fileId)) {
        continue;
      }
      seen.add(item.fileId);
      const file = await this.deps.repository.files.findById(item.fileId);
      if (file === null) {
        results.push({ fileId: item.fileId, outcome: "skipped", reason: "not_found" });
      } else if (file.direction !== "Outbound" || file.docTypeId !== null || (file.state !== "Staged" && file.state !== "NeedsReview")) {
        results.push({ fileId: item.fileId, outcome: "skipped", reason: "not_unclassified" });
      } else {
        const title = classifierTitle(item.fileName, { arrivalNumberPattern: setting.arrivalNumberPattern, clientCodes });
        if (title === "") {
          results.push({ fileId: item.fileId, outcome: "skipped", reason: "no_title" });
        } else {
          candidates.push({ file, title });
        }
      }
    }
    return candidates;
  }

  private answerFor(fileId: Id, answers: readonly ClassifierAnswer[], choices: readonly DocType[]): ClassifierAnswer {
    const answer = answers.find((candidate) => candidate.itemId === fileId);
    const valid =
      answer !== undefined &&
      choices.some((docType) => docType.id === answer.choiceId) &&
      Number.isFinite(answer.confidence) &&
      answer.confidence >= 0 &&
      answer.confidence <= 1;
    if (answer === undefined || !valid) {
      throw new ClassifierError("invalid_response");
    }
    return answer;
  }

  private async apply(actor: Actor, file: FileRecord, answer: ClassifierAnswer, model: string): Promise<ClassificationResult> {
    const threshold = (await this.deps.repository.settings.get()).jevThreshold;
    const accepted = answer.confidence >= threshold;
    const change: FileRecord = accepted
      ? { ...file, docTypeId: answer.choiceId, typeSource: "Jev", jevModel: model, jevConfidence: answer.confidence, jevCandidateDocTypeId: null }
      : { ...file, jevModel: model, jevConfidence: answer.confidence, jevCandidateDocTypeId: answer.choiceId };
    try {
      await this.deps.writer.update(change, file.version, accepted);
    } catch (error) {
      if (error instanceof DomainError && error.detail === "stale") {
        return { fileId: file.id, outcome: "skipped", reason: "stale" };
      }
      throw error;
    }
    await this.deps.audit.record(actor, "file.classify", FILE_TARGET, file.id);
    await this.deps.metrics.record("jev.classified", file.clientId, { fileId: file.id, model, confidence: answer.confidence, accepted });
    return accepted
      ? { fileId: file.id, outcome: "classified", docTypeId: answer.choiceId, confidence: answer.confidence }
      : { fileId: file.id, outcome: "below_threshold", candidateDocTypeId: answer.choiceId, confidence: answer.confidence };
  }
}
