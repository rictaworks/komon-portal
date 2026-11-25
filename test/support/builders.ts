import type { CaseRecord, CaseType, Client, DocRule, DocType, User } from "../../src/core/model/types";
import type { Clock } from "../../src/core/ports/clock";
import type { IdGenerator } from "../../src/core/ports/id-generator";
import { AccessPolicy } from "../../src/core/access/access-policy";
import { Guard } from "../../src/core/access/guard";
import { AuditRecorder, MetricRecorder } from "../../src/core/audit/recorders";
import type { UserActor } from "../../src/core/model/actor";
import type { FileRecord } from "../../src/core/model/types";
import type { MemoryRepository } from "./memory-repository";

export const NOW = new Date("2026-11-24T03:00:00.000Z");

export class FixedClock implements Clock {
  current: Date;

  constructor(current: Date = NOW) {
    this.current = current;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}

export class SequentialIds implements IdGenerator {
  private counter = 0;

  newId(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }

  randomToken(bytes: number): string {
    this.counter += 1;
    return `token-${this.counter}-${"x".repeat(bytes)}`;
  }
}

export function client(overrides: Partial<Client> = {}): Client {
  return { id: "c1", code: "C0031", corporateName: "Hinode Logistics", corporateNumber: null, status: "Active", version: 1, ...overrides };
}

export function user(overrides: Partial<User> = {}): User {
  return { id: "u1", googleSub: "sub-u1", displayName: "A. Mori", officeRole: null, officeStatus: null, createdAt: NOW, ...overrides };
}

export function caseType(overrides: Partial<CaseType> = {}): CaseType {
  return { id: "t1", kind: "Procedure", label: "Social insurance", ...overrides };
}

export function caseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: "k1", clientId: "c1", caseTypeId: "t1", targetMonth: "2026-11", sequence: 1, referenceCode: "SHAHO-2611-01",
    assigneeId: null, dueOn: null, submittedOn: null, state: "Open", version: 1, createdAt: NOW, ...overrides,
  };
}

export function docType(overrides: Partial<DocType> = {}): DocType {
  return { id: "d1", label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound", caseTypeId: null, ...overrides };
}

export function docRule(overrides: Partial<DocRule> = {}): DocRule {
  return { id: "r1", docTypeId: "d1", keyword: "shaho", ...overrides };
}


export function staffActor(role: "Owner" | "Staff" = "Staff", userId = "u-staff"): UserActor {
  return { kind: "user", userId, officeRole: role, officeStatus: "Active", memberships: [] };
}

export function memberActor(clientIds: string[] = ["c1"], userId = "u-member"): UserActor {
  return {
    kind: "user", userId, officeRole: null, officeStatus: null,
    memberships: clientIds.map((clientId) => ({ clientId, status: "Active" as const, clientStatus: "Active" as const })),
  };
}

export interface CoreKit {
  clock: FixedClock;
  ids: SequentialIds;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  guard: Guard;
}

/** Shared collaborators wired to an in-memory repository. */
export function coreKit(repository: MemoryRepository): CoreKit {
  const clock = new FixedClock();
  const ids = new SequentialIds();
  const audit = new AuditRecorder(repository.audit, clock, ids);
  const metrics = new MetricRecorder(repository.metrics, clock, ids);
  return { clock, ids, audit, metrics, guard: new Guard(new AccessPolicy(), audit) };
}

export function fileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "f1", batchId: "b1", direction: "Outbound", clientId: "c1", caseId: null, docTypeId: null, targetMonth: null,
    displayName: `C0031_UNCLASSIFIED_20261124_${overrides.id ?? "f1"}`, format: "pdf", sha256: "a".repeat(64), sizeBytes: 10,
    r2Key: `files/${overrides.id ?? "f1"}`, state: "Staged", trashedFrom: null, resolutionMethod: "StaffSelected",
    reviewReason: null, reviewDetail: null, unmatchedArrivalNumber: null, typeSource: null, jevModel: null,
    jevConfidence: null, jevCandidateDocTypeId: null, withdrawReason: null, incidentFlag: false,
    incidentClientId: null, incidentReason: null, incidentAt: null, receivedAt: NOW,
    publishedAt: null, acknowledgedAt: null, trashedAt: null, version: 1, ...overrides,
  };
}
