import type {
  CaseArrival, CaseKind, CaseRecord, CaseState, CaseType, DocRule, DocType, DocTypeDirection, Id, YearMonth,
} from "../../../core/model/types";
import type { CaseFilter, CaseRepository, CaseTypeRepository, DocTypeRepository, Page } from "../../../core/ports/repository";
import { changes, isUniqueViolation, placeholders, text, textOrNull, toIso, fromIso, whereSql, type Row, type Where } from "./sql";

function toCaseType(row: Row): CaseType {
  return { id: text(row.id), kind: text(row.kind) as CaseKind, label: text(row.label) };
}

export class D1CaseTypeRepository implements CaseTypeRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<CaseType | null> {
    const row = await this.db.prepare("SELECT * FROM case_types WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toCaseType(row);
  }

  async list(): Promise<CaseType[]> {
    const rows = await this.db.prepare("SELECT * FROM case_types ORDER BY kind, label, id").all<Row>();
    return rows.results.map(toCaseType);
  }

  async insert(caseType: CaseType): Promise<void> {
    await this.db.prepare("INSERT INTO case_types (id, kind, label) VALUES (?, ?, ?)").bind(caseType.id, caseType.kind, caseType.label).run();
  }

  async update(caseType: CaseType): Promise<void> {
    await this.db.prepare("UPDATE case_types SET kind = ?, label = ? WHERE id = ?").bind(caseType.kind, caseType.label, caseType.id).run();
  }
}

function toCase(row: Row): CaseRecord {
  return {
    id: text(row.id),
    clientId: text(row.client_id),
    caseTypeId: text(row.case_type_id),
    targetMonth: text(row.target_month),
    sequence: Number(row.sequence),
    referenceCode: text(row.reference_code),
    assigneeId: textOrNull(row.assignee_id),
    dueOn: textOrNull(row.due_on),
    submittedOn: textOrNull(row.submitted_on),
    state: text(row.state) as CaseState,
    version: Number(row.version),
    createdAt: fromIso(row.created_at),
  };
}

const CASE_UPDATE =
  "UPDATE case_records SET reference_code = ?, assignee_id = ?, due_on = ?, submitted_on = ?, state = ?, version = ? WHERE id = ? AND version = ?";

export class D1CaseRepository implements CaseRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<CaseRecord | null> {
    const row = await this.db.prepare("SELECT * FROM case_records WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toCase(row);
  }

  async findByArrivalNumber(arrivalNumber: string): Promise<CaseRecord | null> {
    const row = await this.db
      .prepare("SELECT c.* FROM case_records c JOIN case_arrivals a ON a.case_id = c.id WHERE a.arrival_number = ?")
      .bind(arrivalNumber)
      .first<Row>();
    return row === null ? null : toCase(row);
  }

  async list(filter: CaseFilter, page: Page): Promise<CaseRecord[]> {
    const where: Where = { clauses: [], params: [] };
    if (filter.clientId !== undefined) {
      where.clauses.push("c.client_id = ?");
      where.params.push(filter.clientId);
    }
    if (filter.kind !== undefined) {
      where.clauses.push("t.kind = ?");
      where.params.push(filter.kind);
    }
    if (filter.targetMonth !== undefined) {
      where.clauses.push("c.target_month = ?");
      where.params.push(filter.targetMonth);
    }
    if (filter.states !== undefined) {
      if (filter.states.length === 0) {
        return [];
      }
      where.clauses.push(`c.state IN (${placeholders(filter.states.length)})`);
      where.params.push(...filter.states);
    }
    const rows = await this.db
      .prepare(
        `SELECT c.* FROM case_records c JOIN case_types t ON t.id = c.case_type_id${whereSql(where)} ORDER BY c.created_at DESC, c.id LIMIT ? OFFSET ?`,
      )
      .bind(...where.params, page.limit, page.offset)
      .all<Row>();
    return rows.results.map(toCase);
  }

  async nextSequence(clientId: Id, caseTypeId: Id, targetMonth: YearMonth): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM case_records WHERE client_id = ? AND case_type_id = ? AND target_month = ?")
      .bind(clientId, caseTypeId, targetMonth)
      .first<{ next: number }>();
    return row?.next ?? 1;
  }

  async insert(record: CaseRecord): Promise<boolean> {
    try {
      await this.db
        .prepare(
          "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, assignee_id, due_on, submitted_on, state, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          record.id, record.clientId, record.caseTypeId, record.targetMonth, record.sequence, record.referenceCode, record.assigneeId,
          record.dueOn, record.submittedOn, record.state, record.version, toIso(record.createdAt),
        )
        .run();
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "case_records.client_id, case_records.case_type_id")) {
        return false;
      }
      throw error;
    }
  }

  private updateStatement(record: CaseRecord, expectedVersion: number): D1PreparedStatement {
    return this.db
      .prepare(CASE_UPDATE)
      .bind(record.referenceCode, record.assigneeId, record.dueOn, record.submittedOn, record.state, record.version, record.id, expectedVersion);
  }

  async update(record: CaseRecord, expectedVersion: number): Promise<boolean> {
    return changes(await this.updateStatement(record, expectedVersion).run()) === 1;
  }

  async updateWithArrivals(record: CaseRecord, expectedVersion: number, arrivals: readonly CaseArrival[]): Promise<"ok" | "stale" | "arrival_taken"> {
    // One transaction. The arrivals go in first, each only while the case still has the expected
    // version; the guarded case update comes last. With a stale version nothing at all is written.
    const inserts = arrivals.map((arrival) =>
      this.db
        .prepare("INSERT INTO case_arrivals (id, case_id, arrival_number) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM case_records WHERE id = ? AND version = ?)")
        .bind(arrival.id, arrival.caseId, arrival.arrivalNumber, record.id, expectedVersion),
    );
    try {
      const results = await this.db.batch([...inserts, this.updateStatement(record, expectedVersion)]);
      const updated = results[results.length - 1];
      return updated !== undefined && changes(updated) === 1 ? "ok" : "stale";
    } catch (error) {
      if (isUniqueViolation(error, "case_arrivals.arrival_number")) {
        return "arrival_taken";
      }
      throw error;
    }
  }

  async listArrivals(caseId: Id): Promise<CaseArrival[]> {
    const rows = await this.db.prepare("SELECT * FROM case_arrivals WHERE case_id = ? ORDER BY arrival_number").bind(caseId).all<Row>();
    return rows.results.map((row) => ({ id: text(row.id), caseId: text(row.case_id), arrivalNumber: text(row.arrival_number) }));
  }

  async addArrival(arrival: CaseArrival): Promise<boolean> {
    try {
      await this.db
        .prepare("INSERT INTO case_arrivals (id, case_id, arrival_number) VALUES (?, ?, ?)")
        .bind(arrival.id, arrival.caseId, arrival.arrivalNumber)
        .run();
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "case_arrivals.arrival_number")) {
        return false;
      }
      throw error;
    }
  }
}

function toDocType(row: Row): DocType {
  return { id: text(row.id), label: text(row.label), shortCode: text(row.short_code), direction: text(row.direction) as DocTypeDirection };
}

export class D1DocTypeRepository implements DocTypeRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<DocType | null> {
    const row = await this.db.prepare("SELECT * FROM doc_types WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toDocType(row);
  }

  async list(): Promise<DocType[]> {
    const rows = await this.db.prepare("SELECT * FROM doc_types ORDER BY short_code").all<Row>();
    return rows.results.map(toDocType);
  }

  async insert(docType: DocType): Promise<boolean> {
    try {
      await this.db
        .prepare("INSERT INTO doc_types (id, label, short_code, direction) VALUES (?, ?, ?, ?)")
        .bind(docType.id, docType.label, docType.shortCode, docType.direction)
        .run();
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "doc_types.short_code")) {
        return false;
      }
      throw error;
    }
  }

  async update(docType: DocType): Promise<boolean> {
    try {
      const result = await this.db
        .prepare("UPDATE doc_types SET label = ?, short_code = ?, direction = ? WHERE id = ?")
        .bind(docType.label, docType.shortCode, docType.direction, docType.id)
        .run();
      return changes(result) === 1;
    } catch (error) {
      if (isUniqueViolation(error, "doc_types.short_code")) {
        return false;
      }
      throw error;
    }
  }

  async listRules(): Promise<DocRule[]> {
    const rows = await this.db.prepare("SELECT * FROM doc_rules ORDER BY doc_type_id, keyword, id").all<Row>();
    return rows.results.map((row) => ({ id: text(row.id), docTypeId: text(row.doc_type_id), keyword: text(row.keyword) }));
  }

  async insertRule(rule: DocRule): Promise<void> {
    await this.db.prepare("INSERT INTO doc_rules (id, doc_type_id, keyword) VALUES (?, ?, ?)").bind(rule.id, rule.docTypeId, rule.keyword).run();
  }

  async deleteRule(id: Id): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM doc_rules WHERE id = ?").bind(id).run();
    return result.meta.changes > 0;
  }
}
