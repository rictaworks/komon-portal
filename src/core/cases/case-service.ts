import type { Guard } from "../access/guard";
import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import { compileArrivalNumberPattern } from "../intake/key-extractor";
import type { Actor } from "../model/actor";
import { conflict, invalidInput, invalidState, notFound } from "../model/errors";
import type { CaseKind, CaseRecord, CaseState, CaseType, Id, LocalDate, YearMonth } from "../model/types";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import { isLocalDate } from "../time/local-date";
import { CANCELLABLE_CASE_STATES, deriveCaseState, TERMINAL_CASE_STATES } from "./case-state";

export interface RegisterCaseInput {
  clientId: Id;
  caseTypeId: Id;
  targetMonth: YearMonth;
  referenceCode: string;
  assigneeId: Id | null;
  dueOn: LocalDate | null;
}

export interface SubmissionInput {
  submittedOn: LocalDate;
  arrivalNumbers: readonly string[];
}

/** What a client member may see of a case: no assignee, due date or reference code. */
export interface ClientCaseView {
  id: Id;
  kind: CaseKind;
  typeLabel: string;
  targetMonth: YearMonth;
  state: CaseState;
}

const TARGET_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const REFERENCE_CODE = /^[A-Za-z0-9-]{1,64}$/;
const WRITE_ATTEMPTS = 3;
const SETTLE_ATTEMPTS = 6;
const CASE_TARGET = "case";
const CLIENT_TARGET = "client";
export const MAX_ARRIVAL_NUMBERS = 20;

type CaseRepositoryPorts = Pick<Repository, "cases" | "caseTypes" | "clients" | "files" | "settings" | "users">;

export interface CaseServiceDeps {
  repository: CaseRepositoryPorts;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  clock: Clock;
  ids: IdGenerator;
}

/** Cases advance from file events; staff only register, record the submission, close and cancel (instructions.md 1.7). */
export class CaseService {
  constructor(private readonly deps: CaseServiceDeps) {}

  async register(actor: Actor, input: RegisterCaseInput): Promise<CaseRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: CLIENT_TARGET, id: input.clientId });
    await this.validateRegistration(input);
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const record: CaseRecord = {
        id: this.deps.ids.newId(),
        clientId: input.clientId,
        caseTypeId: input.caseTypeId,
        targetMonth: input.targetMonth,
        sequence: await this.deps.repository.cases.nextSequence(input.clientId, input.caseTypeId, input.targetMonth),
        referenceCode: input.referenceCode,
        assigneeId: input.assigneeId,
        dueOn: input.dueOn,
        submittedOn: null,
        state: "Open",
        version: 1,
        createdAt: this.deps.clock.now(),
      };
      if (await this.deps.repository.cases.insert(record)) {
        await this.deps.audit.record(actor, "case.register", CASE_TARGET, record.id);
        await this.deps.metrics.record("case.state_changed", record.clientId, { caseId: record.id, from: null, to: "Open" });
        return record;
      }
    }
    throw conflict("case_sequence");
  }

  async markSubmitted(actor: Actor, caseId: Id, input: SubmissionInput, expectedVersion: number): Promise<CaseRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: CASE_TARGET, id: caseId });
    const record = await this.requireCase(caseId);
    if (TERMINAL_CASE_STATES.includes(record.state)) {
      throw invalidState("case_terminal");
    }
    if ((await this.requireCaseType(record.caseTypeId)).kind !== "Procedure") {
      throw invalidState("not_a_procedure");
    }
    if (!isLocalDate(input.submittedOn)) {
      throw invalidInput("submitted_on");
    }
    const arrivalNumbers = await this.validateArrivalNumbers(caseId, input.arrivalNumbers);
    const changed: CaseRecord = { ...record, submittedOn: input.submittedOn };
    const updated: CaseRecord = { ...changed, state: await this.derive(changed), version: expectedVersion + 1 };
    const arrivals = arrivalNumbers.map((arrivalNumber) => ({ id: this.deps.ids.newId(), caseId, arrivalNumber }));
    const outcome = await this.deps.repository.cases.updateWithArrivals(updated, expectedVersion, arrivals);
    if (outcome !== "ok") {
      throw conflict(outcome === "stale" ? "stale" : "arrival_number_taken");
    }
    await this.deps.audit.record(actor, "case.submit", CASE_TARGET, caseId);
    if (record.state !== updated.state) {
      await this.recordStateChange(record, updated.state);
    }
    return updated;
  }

  async close(actor: Actor, caseId: Id, expectedVersion: number): Promise<CaseRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: CASE_TARGET, id: caseId });
    const record = await this.requireCase(caseId);
    if (TERMINAL_CASE_STATES.includes(record.state)) {
      throw invalidState("case_terminal");
    }
    return this.write(actor, { ...record, state: "Closed" }, expectedVersion, "case.close");
  }

  async cancel(actor: Actor, caseId: Id, expectedVersion: number): Promise<CaseRecord> {
    await this.deps.guard.require(actor, "staff.operate", { type: CASE_TARGET, id: caseId });
    const record = await this.requireCase(caseId);
    // Judge by the facts, not by a stored state that a pending file event may not have updated yet.
    if (!CANCELLABLE_CASE_STATES.includes(await this.derive(record))) {
      throw invalidState("case_not_cancellable");
    }
    return this.write(actor, { ...record, state: "Cancelled" }, expectedVersion, "case.cancel");
  }

  /**
   * Recomputes the case state after something happened to a linked file. Safe to call
   * repeatedly; a concurrent change is retried because the result depends only on facts.
   */
  async onFileEvent(caseId: Id): Promise<CaseRecord> {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      const record = await this.requireCase(caseId);
      const next = await this.derive(record);
      if (next === record.state) {
        return record;
      }
      const updated: CaseRecord = { ...record, state: next, version: record.version + 1 };
      if (await this.deps.repository.cases.update(updated, record.version)) {
        await this.recordStateChange(record, next);
      }
      // Loop again: the files may have changed while this write was in flight, so the stored
      // state is only final once a fresh derivation agrees with it.
    }
    throw conflict("stale");
  }

  async clientView(record: CaseRecord): Promise<ClientCaseView> {
    const caseType = await this.requireCaseType(record.caseTypeId);
    return { id: record.id, kind: caseType.kind, typeLabel: caseType.label, targetMonth: record.targetMonth, state: record.state };
  }

  private async derive(record: CaseRecord): Promise<CaseState> {
    const caseType = await this.requireCaseType(record.caseTypeId);
    return deriveCaseState(record, caseType.kind, await this.deps.repository.files.summarizeForCase(record.id));
  }

  /** Writes staff changes with optimistic locking, then settles the derived state. */
  private async write(actor: Actor, changed: CaseRecord, expectedVersion: number, action: string): Promise<CaseRecord> {
    const before = await this.requireCase(changed.id);
    const state = await this.derive(changed);
    const updated: CaseRecord = { ...changed, state, version: expectedVersion + 1 };
    if (!(await this.deps.repository.cases.update(updated, expectedVersion))) {
      throw conflict("stale");
    }
    await this.deps.audit.record(actor, action, CASE_TARGET, changed.id);
    if (before.state !== state) {
      await this.recordStateChange(before, state);
    }
    return updated;
  }

  private async recordStateChange(before: CaseRecord, to: CaseState): Promise<void> {
    await this.deps.metrics.record("case.state_changed", before.clientId, { caseId: before.id, from: before.state, to });
  }

  private async validateRegistration(input: RegisterCaseInput): Promise<void> {
    const client = await this.deps.repository.clients.findById(input.clientId);
    if (client === null) {
      throw notFound("client");
    }
    if (client.status === "Closed") {
      throw invalidState("client_closed");
    }
    await this.requireCaseType(input.caseTypeId);
    if (!TARGET_MONTH.test(input.targetMonth)) {
      throw invalidInput("target_month");
    }
    if (!REFERENCE_CODE.test(input.referenceCode)) {
      throw invalidInput("reference_code");
    }
    if (input.dueOn !== null && !isLocalDate(input.dueOn)) {
      throw invalidInput("due_on");
    }
    if (input.assigneeId !== null) {
      const assignee = await this.deps.repository.users.findById(input.assigneeId);
      if (assignee === null || assignee.officeStatus !== "Active") {
        throw invalidInput("assignee");
      }
    }
  }

  /** Returns the numbers that still have to be added. Rejects malformed ones and ones owned by another case. */
  private async validateArrivalNumbers(caseId: Id, arrivalNumbers: readonly string[]): Promise<string[]> {
    const setting = await this.deps.repository.settings.get();
    const pattern = compileArrivalNumberPattern(setting.arrivalNumberPattern);
    const toAdd: string[] = [];
    if (new Set(arrivalNumbers).size > MAX_ARRIVAL_NUMBERS) {
      throw invalidInput("arrival_number_count");
    }
    for (const arrivalNumber of new Set(arrivalNumbers)) {
      const matches = [...arrivalNumber.matchAll(pattern)].map((match) => match[0]);
      if (matches.length !== 1 || matches[0] !== arrivalNumber) {
        throw invalidInput("arrival_number");
      }
      const owner = await this.deps.repository.cases.findByArrivalNumber(arrivalNumber);
      if (owner !== null && owner.id !== caseId) {
        throw conflict("arrival_number_taken");
      }
      if (owner === null) {
        toAdd.push(arrivalNumber);
      }
    }
    return toAdd;
  }

  private async requireCase(id: Id): Promise<CaseRecord> {
    const record = await this.deps.repository.cases.findById(id);
    if (record === null) {
      throw notFound("case");
    }
    return record;
  }

  private async requireCaseType(id: Id): Promise<CaseType> {
    const caseType = await this.deps.repository.caseTypes.findById(id);
    if (caseType === null) {
      throw notFound("case_type");
    }
    return caseType;
  }
}
