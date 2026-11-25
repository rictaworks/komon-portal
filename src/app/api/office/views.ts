import type { DeadlineStatus } from "../../../core/cases/deadline-calculator";
import type { CaseRecord, CaseType, Client, DocType, FileReceipt, FileRecord, Id, User } from "../../../core/model/types";
import type { Services } from "../composition";
import type { AppContext } from "../context";

export interface Page {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function pageOf(c: AppContext): Page {
  const limit = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const offset = Number(c.req.query("offset") ?? 0);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
  };
}

/** Looks records up once per request and reuses them while building a response. */
export class Lookups {
  private readonly clients = new Map<Id, Client | null>();
  private readonly users = new Map<Id, User | null>();
  private docTypes: Map<Id, DocType> | null = null;
  private caseTypes: Map<Id, CaseType> | null = null;

  constructor(private readonly services: Services) {}

  async client(id: Id | null): Promise<{ id: Id; code: string; corporateName: string; status: Client["status"] } | null> {
    if (id === null) {
      return null;
    }
    if (!this.clients.has(id)) {
      this.clients.set(id, await this.services.repository.clients.findById(id));
    }
    const client = this.clients.get(id) ?? null;
    return client === null ? null : { id: client.id, code: client.code, corporateName: client.corporateName, status: client.status };
  }

  async displayName(userId: Id | null): Promise<string | null> {
    if (userId === null) {
      return null;
    }
    if (!this.users.has(userId)) {
      this.users.set(userId, await this.services.repository.users.findById(userId));
    }
    return this.users.get(userId)?.displayName ?? null;
  }

  async docType(id: Id | null): Promise<DocType | null> {
    if (this.docTypes === null) {
      this.docTypes = new Map((await this.services.repository.docTypes.list()).map((docType) => [docType.id, docType]));
    }
    return id === null ? null : (this.docTypes.get(id) ?? null);
  }

  async caseType(id: Id): Promise<CaseType | null> {
    if (this.caseTypes === null) {
      this.caseTypes = new Map((await this.services.repository.caseTypes.list()).map((caseType) => [caseType.id, caseType]));
    }
    return this.caseTypes.get(id) ?? null;
  }
}

export async function fileView(lookups: Lookups, file: FileRecord, receipts: readonly FileReceipt[]): Promise<Record<string, unknown>> {
  const docType = await lookups.docType(file.docTypeId);
  const candidate = await lookups.docType(file.jevCandidateDocTypeId);
  const evidence = [];
  for (const item of file.reviewDetail ?? []) {
    evidence.push({ kind: item.kind, client: await lookups.client(item.clientId) });
  }
  const readers = [];
  for (const receipt of receipts.filter((entry) => entry.fileId === file.id)) {
    readers.push({ displayName: await lookups.displayName(receipt.userId), firstViewedAt: receipt.firstViewedAt });
  }
  return {
    id: file.id,
    direction: file.direction,
    displayName: file.displayName,
    format: file.format,
    sizeBytes: file.sizeBytes,
    state: file.state,
    client: await lookups.client(file.clientId),
    caseId: file.caseId,
    docType: docType === null ? null : { id: docType.id, shortCode: docType.shortCode, label: docType.label },
    targetMonth: file.targetMonth,
    resolutionMethod: file.resolutionMethod,
    reviewReason: file.reviewReason,
    evidence,
    unmatchedArrivalNumber: file.unmatchedArrivalNumber,
    typeSource: file.typeSource,
    jev: file.jevModel === null ? null : { model: file.jevModel, confidence: file.jevConfidence, candidate: candidate === null ? null : { id: candidate.id, shortCode: candidate.shortCode } },
    withdrawReason: file.withdrawReason,
    incident: file.incidentFlag,
    receivedAt: file.receivedAt,
    publishedAt: file.publishedAt,
    acknowledgedAt: file.acknowledgedAt,
    trashedAt: file.trashedAt,
    readers,
    version: file.version,
  };
}

export async function caseView(
  lookups: Lookups,
  record: CaseRecord,
  deadlines: { retrieval: DeadlineStatus; due: DeadlineStatus },
  arrivalNumbers?: readonly string[],
): Promise<Record<string, unknown>> {
  const caseType = await lookups.caseType(record.caseTypeId);
  return {
    id: record.id,
    client: await lookups.client(record.clientId),
    caseType: caseType === null ? null : { id: caseType.id, kind: caseType.kind, label: caseType.label },
    targetMonth: record.targetMonth,
    sequence: record.sequence,
    referenceCode: record.referenceCode,
    assignee: record.assigneeId === null ? null : { id: record.assigneeId, displayName: await lookups.displayName(record.assigneeId) },
    dueOn: record.dueOn,
    submittedOn: record.submittedOn,
    state: record.state,
    retrieval: deadlines.retrieval,
    due: deadlines.due,
    ...(arrivalNumbers === undefined ? {} : { arrivalNumbers }),
    version: record.version,
  };
}
