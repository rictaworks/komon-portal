import type { Guard } from "../access/guard";
import type { AuditRecorder } from "../audit/recorders";
import { compileArrivalNumberPattern } from "../intake/key-extractor";
import type { Actor } from "../model/actor";
import { conflict, invalidInput, notFound } from "../model/errors";
import {
  CASE_KINDS, DOC_TYPE_DIRECTIONS, type CaseKind, type CaseType, type DocRule, type DocType, type DocTypeDirection, type Id,
  type OfficeSetting,
} from "../model/types";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import { localDateOf } from "../time/local-date";

/** The name is required on every save: once set it can be changed but not cleared. */
export type OfficeSettingInput = Omit<OfficeSetting, "version" | "officeName"> & { officeName: string };

export const JEV_THRESHOLD_MIN = 0.8;
export const JEV_THRESHOLD_MAX = 1;
export const RETRIEVAL_DAYS_MAX = 365;
export const MAX_OFFICE_NAME_LENGTH = 100;
export const MAX_LABEL_LENGTH = 100;
export const MAX_KEYWORD_LENGTH = 100;
const SHORT_CODE = /^[A-Z0-9]{1,16}$/;
const SETTING_TARGET = "setting";
const MASTER_TARGET = "master";

export interface DocTypeInput {
  label: string;
  shortCode: string;
  direction: DocTypeDirection;
  /** The monthly (Payroll) case type submissions of this document type belong to. Omitted or null: none. */
  caseTypeId?: Id | null;
}

export interface SettingsServiceDeps {
  repository: Pick<Repository, "settings" | "docTypes" | "caseTypes">;
  guard: Guard;
  audit: AuditRecorder;
  ids: IdGenerator;
}

/** Office settings (Owner) and master data for document types, rules and case types (staff). */
export class SettingsService {
  constructor(private readonly deps: SettingsServiceDeps) {}

  async updateOffice(actor: Actor, input: OfficeSettingInput, expectedVersion: number): Promise<OfficeSetting> {
    await this.deps.guard.require(actor, "office.settings.update", { type: SETTING_TARGET, id: "office" });
    const officeName = typeof input.officeName === "string" ? input.officeName.trim() : "";
    if (officeName === "" || [...officeName].length > MAX_OFFICE_NAME_LENGTH) {
      throw invalidInput("office_name");
    }
    localDateOf(new Date(0), input.timezone);
    compileArrivalNumberPattern(input.arrivalNumberPattern);
    if (!Number.isInteger(input.retrievalDeadlineDays) || input.retrievalDeadlineDays < 1 || input.retrievalDeadlineDays > RETRIEVAL_DAYS_MAX) {
      throw invalidInput("retrieval_deadline_days");
    }
    // The threshold may be raised but never set below 0.80.
    if (!(input.jevThreshold >= JEV_THRESHOLD_MIN && input.jevThreshold <= JEV_THRESHOLD_MAX)) {
      throw invalidInput("jev_threshold");
    }
    const updated: OfficeSetting = { ...input, officeName, version: expectedVersion + 1 };
    if (!(await this.deps.repository.settings.update(updated, expectedVersion))) {
      throw conflict("stale");
    }
    await this.deps.audit.record(actor, "setting.update", SETTING_TARGET, "office");
    return updated;
  }

  async addDocType(actor: Actor, input: DocTypeInput): Promise<DocType> {
    await this.requireStaff(actor, "doc_type");
    const docType: DocType = { id: this.deps.ids.newId(), ...(await this.validDocType(input)) };
    if (!(await this.deps.repository.docTypes.insert(docType))) {
      throw conflict("short_code_taken");
    }
    await this.deps.audit.record(actor, "doc_type.add", MASTER_TARGET, docType.id);
    return docType;
  }

  async updateDocType(actor: Actor, id: Id, input: DocTypeInput): Promise<DocType> {
    await this.requireStaff(actor, id);
    const valid = await this.validDocType(input);
    if ((await this.deps.repository.docTypes.findById(id)) === null) {
      throw notFound("doc_type");
    }
    const docType: DocType = { id, ...valid };
    if (!(await this.deps.repository.docTypes.update(docType))) {
      throw conflict("short_code_taken");
    }
    await this.deps.audit.record(actor, "doc_type.update", MASTER_TARGET, id);
    return docType;
  }

  async addRule(actor: Actor, input: { docTypeId: Id; keyword: string }): Promise<DocRule> {
    await this.requireStaff(actor, input.docTypeId);
    const keyword = input.keyword.trim();
    if (keyword === "" || keyword.length > MAX_KEYWORD_LENGTH) {
      throw invalidInput("keyword");
    }
    if ((await this.deps.repository.docTypes.findById(input.docTypeId)) === null) {
      throw notFound("doc_type");
    }
    const rule: DocRule = { id: this.deps.ids.newId(), docTypeId: input.docTypeId, keyword };
    await this.deps.repository.docTypes.insertRule(rule);
    await this.deps.audit.record(actor, "doc_rule.add", MASTER_TARGET, rule.id);
    return rule;
  }

  async removeRule(actor: Actor, ruleId: Id): Promise<void> {
    await this.requireStaff(actor, ruleId);
    if (!(await this.deps.repository.docTypes.deleteRule(ruleId))) {
      throw notFound("doc_rule");
    }
    await this.deps.audit.record(actor, "doc_rule.remove", MASTER_TARGET, ruleId);
  }

  async addCaseType(actor: Actor, input: { kind: CaseKind; label: string }): Promise<CaseType> {
    await this.requireStaff(actor, "case_type");
    this.validateCaseType(input);
    const caseType: CaseType = { id: this.deps.ids.newId(), ...input };
    await this.deps.repository.caseTypes.insert(caseType);
    await this.deps.audit.record(actor, "case_type.add", MASTER_TARGET, caseType.id);
    return caseType;
  }

  /** The label can change; the kind cannot, because existing cases were classified by it. */
  async renameCaseType(actor: Actor, id: Id, label: string): Promise<CaseType> {
    await this.requireStaff(actor, id);
    const current = await this.deps.repository.caseTypes.findById(id);
    if (current === null) {
      throw notFound("case_type");
    }
    this.validateCaseType({ kind: current.kind, label });
    const updated: CaseType = { ...current, label };
    await this.deps.repository.caseTypes.update(updated);
    await this.deps.audit.record(actor, "case_type.update", MASTER_TARGET, id);
    return updated;
  }

  private async requireStaff(actor: Actor, id: Id): Promise<void> {
    await this.deps.guard.require(actor, "staff.operate", { type: MASTER_TARGET, id });
  }

  /**
   * The case type is optional; when given it must be an existing monthly (Payroll) case type, the only kind a
   * submission is linked to (instructions.md 1.6.7). Without one, submissions of the type are never linked automatically.
   */
  private async validDocType(input: DocTypeInput): Promise<Omit<DocType, "id">> {
    if (input.label.trim() === "" || input.label.length > MAX_LABEL_LENGTH) {
      throw invalidInput("label");
    }
    if (!SHORT_CODE.test(input.shortCode)) {
      throw invalidInput("short_code");
    }
    if (!DOC_TYPE_DIRECTIONS.includes(input.direction)) {
      throw invalidInput("direction");
    }
    const caseTypeId = input.caseTypeId ?? null;
    if (caseTypeId !== null) {
      const caseType = await this.deps.repository.caseTypes.findById(caseTypeId);
      if (caseType === null || caseType.kind !== "Payroll") {
        throw invalidInput("case_type");
      }
    }
    return { label: input.label, shortCode: input.shortCode, direction: input.direction, caseTypeId };
  }

  private validateCaseType(input: { kind: CaseKind; label: string }): void {
    if (input.label.trim() === "" || input.label.length > MAX_LABEL_LENGTH) {
      throw invalidInput("label");
    }
    if (!CASE_KINDS.includes(input.kind)) {
      throw invalidInput("kind");
    }
  }
}
