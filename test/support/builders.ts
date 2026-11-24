import type { CaseRecord, CaseType, Client, DocRule, DocType, User } from "../../src/core/model/types";
import type { Clock } from "../../src/core/ports/clock";
import type { IdGenerator } from "../../src/core/ports/id-generator";

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
  return { id: "d1", label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound", ...overrides };
}

export function docRule(overrides: Partial<DocRule> = {}): DocRule {
  return { id: "r1", docTypeId: "d1", keyword: "shaho", ...overrides };
}
