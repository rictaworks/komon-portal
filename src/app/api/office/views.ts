import type { DeadlineStatus } from "../../../core/cases/deadline-calculator";
import { invalidInput } from "../../../core/model/errors";
import type { CaseRecord, CaseType, Client, DocType, FileReceipt, FileRecord, Id, OfficeSetting, User } from "../../../core/model/types";
import type { Incident } from "../../../core/publish/publish-service";
import type { Services } from "../composition";
import type { AppContext } from "../context";

export interface Page {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Paging parameters. Out-of-range or malformed values are refused, never replaced with defaults. */
export function pageOf(c: AppContext): Page {
  return { limit: integerParameter(c, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT), offset: integerParameter(c, "offset", 0, 0, Number.MAX_SAFE_INTEGER) };
}

function integerParameter(c: AppContext, name: string, fallback: number, min: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw invalidInput(name);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw invalidInput(name);
  }
  return value;
}

/** Looks records up once per request and reuses them while building a response. */
export class Lookups {
  private readonly clients = new Map<Id, Client | null>();
  private readonly users = new Map<Id, User | null>();
  private docTypes: Map<Id, DocType> | null = null;
  private officeSetting: OfficeSetting | null = null;
  private caseTypes: Map<Id, CaseType> | null = null;

  constructor(private readonly services: Services) {}

  /** The office setting, read once per request. */
  async setting(): Promise<OfficeSetting> {
    if (this.officeSetting === null) {
      this.officeSetting = await this.services.repository.settings.get();
    }
    return this.officeSetting;
  }

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
    trashedFrom: file.trashedFrom,
    readers,
    version: file.version,
  };
}

/**
 * A mis-delivery for the Owner: the file with the client, reason and readers of the withdrawal
 * that raised it. They are not the file's current ones once it was assigned and published again.
 */
export async function incidentView(lookups: Lookups, incident: Incident): Promise<Record<string, unknown>> {
  return {
    ...(await fileView(lookups, incident.file, incident.receipts)),
    client: await lookups.client(incident.clientId),
    withdrawReason: incident.reason,
    withdrawnAt: incident.occurredAt,
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
