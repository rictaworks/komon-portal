import { UNASSIGNED_CODE } from "../../../core/intake/display-name";
import type {
  AuditEntry, FileDirection, FileFormat, FileReceipt, FileRecord, FileState, Id, KeyEvidence, LocalDate, MetricEvent,
  ResolutionMethod, ReviewReason, TypeSource, UploadBatch, WithdrawReason,
} from "../../../core/model/types";
import type {
  AuditRepository, CaseFileSummary, FileFilter, FileRepository, FileWriteResult, MetricRepository, Page, ReceiptRepository,
} from "../../../core/ports/repository";
import {
  changes, chunk, fromIso, fromIsoOrNull, IN_CHUNK, isUniqueViolation, numberOrNull, placeholders, text, textOrNull,
  toIso, toIsoOrNull, whereSql, type Row, type Where,
} from "./sql";

const FILE_COLUMNS = [
  "id", "batch_id", "direction", "client_id", "case_id", "doc_type_id", "target_month", "display_name", "format", "sha256",
  "size_bytes", "r2_key", "state", "trashed_from", "resolution_method", "review_reason", "review_detail",
  "unmatched_arrival_number", "type_source", "jev_model", "jev_confidence", "jev_candidate_doc_type_id", "withdraw_reason",
  "incident_flag", "received_at", "published_at", "acknowledged_at", "trashed_at", "version",
] as const;
/** Columns that never change after insert. */
const IMMUTABLE = new Set(["id", "batch_id", "direction", "format", "sha256", "size_bytes", "r2_key", "received_at"]);
const MUTABLE_COLUMNS = FILE_COLUMNS.filter((column) => !IMMUTABLE.has(column));

function toFile(row: Row): FileRecord {
  const detail = textOrNull(row.review_detail);
  return {
    id: text(row.id),
    batchId: text(row.batch_id),
    direction: text(row.direction) as FileDirection,
    clientId: textOrNull(row.client_id),
    caseId: textOrNull(row.case_id),
    docTypeId: textOrNull(row.doc_type_id),
    targetMonth: textOrNull(row.target_month),
    displayName: text(row.display_name),
    format: text(row.format) as FileFormat,
    sha256: text(row.sha256),
    sizeBytes: Number(row.size_bytes),
    r2Key: text(row.r2_key),
    state: text(row.state) as FileState,
    trashedFrom: textOrNull(row.trashed_from) as FileState | null,
    resolutionMethod: textOrNull(row.resolution_method) as ResolutionMethod | null,
    reviewReason: textOrNull(row.review_reason) as ReviewReason | null,
    reviewDetail: detail === null ? null : (JSON.parse(detail) as KeyEvidence[]),
    unmatchedArrivalNumber: textOrNull(row.unmatched_arrival_number),
    typeSource: textOrNull(row.type_source) as TypeSource | null,
    jevModel: textOrNull(row.jev_model),
    jevConfidence: numberOrNull(row.jev_confidence),
    jevCandidateDocTypeId: textOrNull(row.jev_candidate_doc_type_id),
    withdrawReason: textOrNull(row.withdraw_reason) as WithdrawReason | null,
    incidentFlag: Number(row.incident_flag) === 1,
    receivedAt: fromIso(row.received_at),
    publishedAt: fromIsoOrNull(row.published_at),
    acknowledgedAt: fromIsoOrNull(row.acknowledged_at),
    trashedAt: fromIsoOrNull(row.trashed_at),
    version: Number(row.version),
  };
}

function columnValue(file: FileRecord, column: (typeof FILE_COLUMNS)[number]): unknown {
  switch (column) {
    case "id": return file.id;
    case "batch_id": return file.batchId;
    case "direction": return file.direction;
    case "client_id": return file.clientId;
    case "case_id": return file.caseId;
    case "doc_type_id": return file.docTypeId;
    case "target_month": return file.targetMonth;
    case "display_name": return file.displayName;
    case "format": return file.format;
    case "sha256": return file.sha256;
    case "size_bytes": return file.sizeBytes;
    case "r2_key": return file.r2Key;
    case "state": return file.state;
    case "trashed_from": return file.trashedFrom;
    case "resolution_method": return file.resolutionMethod;
    case "review_reason": return file.reviewReason;
    case "review_detail": return file.reviewDetail === null ? null : JSON.stringify(file.reviewDetail);
    case "unmatched_arrival_number": return file.unmatchedArrivalNumber;
    case "type_source": return file.typeSource;
    case "jev_model": return file.jevModel;
    case "jev_confidence": return file.jevConfidence;
    case "jev_candidate_doc_type_id": return file.jevCandidateDocTypeId;
    case "withdraw_reason": return file.withdrawReason;
    case "incident_flag": return file.incidentFlag ? 1 : 0;
    case "received_at": return toIso(file.receivedAt);
    case "published_at": return toIsoOrNull(file.publishedAt);
    case "acknowledged_at": return toIsoOrNull(file.acknowledgedAt);
    case "trashed_at": return toIsoOrNull(file.trashedAt);
    case "version": return file.version;
  }
}

function uniqueConflict(error: unknown): FileWriteResult | null {
  if (isUniqueViolation(error, "file_records.display_name")) {
    return "name_taken";
  }
  if (isUniqueViolation(error, "file_records.sha256")) {
    return "duplicate_content";
  }
  return null;
}

function fileWhere(filter: FileFilter): Where | null {
  const where: Where = { clauses: [], params: [] };
  const equals = (column: string, value: unknown): void => {
    if (value !== undefined) {
      where.clauses.push(`${column} = ?`);
      where.params.push(value);
    }
  };
  equals("direction", filter.direction);
  equals("client_id", filter.clientId);
  equals("case_id", filter.caseId);
  equals("doc_type_id", filter.docTypeId);
  equals("target_month", filter.targetMonth);
  equals("review_reason", filter.reviewReason);
  if (filter.incidentOnly === true) {
    where.clauses.push("incident_flag = 1");
  }
  if (filter.states !== undefined) {
    if (filter.states.length === 0) {
      return null;
    }
    where.clauses.push(`state IN (${placeholders(filter.states.length)})`);
    where.params.push(...filter.states);
  }
  return where;
}

export class D1FileRepository implements FileRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<FileRecord | null> {
    const row = await this.db.prepare("SELECT * FROM file_records WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toFile(row);
  }

  async findActiveBySha256(sha256: string): Promise<FileRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM file_records WHERE sha256 = ? AND state <> 'Trashed' ORDER BY received_at, id").bind(sha256).all<Row>();
    return rows.results.map(toFile);
  }

  async list(filter: FileFilter, page: Page): Promise<FileRecord[]> {
    const where = fileWhere(filter);
    if (where === null) {
      return [];
    }
    const rows = await this.db
      .prepare(`SELECT * FROM file_records${whereSql(where)} ORDER BY received_at DESC, id LIMIT ? OFFSET ?`)
      .bind(...where.params, page.limit, page.offset)
      .all<Row>();
    return rows.results.map(toFile);
  }

  async count(filter: FileFilter): Promise<number> {
    const where = fileWhere(filter);
    if (where === null) {
      return 0;
    }
    const row = await this.db.prepare(`SELECT COUNT(*) AS n FROM file_records${whereSql(where)}`).bind(...where.params).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async nextDisplaySequence(clientId: Id | null, receivedOn: LocalDate): Promise<number> {
    // Display names are unique across all files, so the sequence follows the name prefix, not the current client.
    const code = clientId === null ? UNASSIGNED_CODE : (await this.db.prepare("SELECT code FROM clients WHERE id = ?").bind(clientId).first<{ code: string }>())?.code;
    if (code === undefined) {
      throw new Error("client of the file does not exist");
    }
    // A range on the unique index: every name of this client starts with "{code}_", and the
    // backtick is the character right after the underscore.
    const compact = `_${receivedOn.replaceAll("-", "")}_`;
    const rows = await this.db
      .prepare("SELECT display_name FROM file_records WHERE display_name >= ? AND display_name < ?")
      .bind(`${code}_`, `${code}\``)
      .all<{ display_name: string }>();
    const used = rows.results
      .filter((row) => row.display_name.includes(compact))
      .map((row) => Number(row.display_name.slice(row.display_name.lastIndexOf("_") + 1)))
      .filter((value) => Number.isFinite(value));
    return Math.max(0, ...used) + 1;
  }

  async insert(file: FileRecord): Promise<FileWriteResult> {
    try {
      await this.db
        .prepare(`INSERT INTO file_records (${FILE_COLUMNS.join(", ")}) VALUES (${placeholders(FILE_COLUMNS.length)})`)
        .bind(...FILE_COLUMNS.map((column) => columnValue(file, column)))
        .run();
      return "ok";
    } catch (error) {
      const conflict = uniqueConflict(error);
      if (conflict !== null) {
        return conflict;
      }
      throw error;
    }
  }

  async update(file: FileRecord, expectedVersion: number): Promise<FileWriteResult> {
    try {
      const result = await this.db
        .prepare(`UPDATE file_records SET ${MUTABLE_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND version = ?`)
        .bind(...MUTABLE_COLUMNS.map((column) => columnValue(file, column)), file.id, expectedVersion)
        .run();
      return changes(result) === 1 ? "ok" : "stale";
    } catch (error) {
      const conflict = uniqueConflict(error);
      if (conflict !== null) {
        return conflict;
      }
      throw error;
    }
  }

  async summarizeForCase(caseId: Id): Promise<CaseFileSummary> {
    const row = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(direction = 'Outbound'), 0) AS outbound,
           COALESCE(SUM(direction = 'Outbound' AND state = 'Published'), 0) AS published,
           COALESCE(SUM(direction = 'Outbound' AND state = 'Published'
                        AND EXISTS (SELECT 1 FROM file_receipts r WHERE r.file_id = file_records.id)), 0) AS opened,
           COALESCE(SUM(direction = 'Inbound'), 0) AS inbound
         FROM file_records WHERE case_id = ? AND state <> 'Trashed'`,
      )
      .bind(caseId)
      .first<{ outbound: number; published: number; opened: number; inbound: number }>();
    return {
      outbound: row?.outbound ?? 0,
      published: row?.published ?? 0,
      publishedAndOpened: row?.opened ?? 0,
      inbound: row?.inbound ?? 0,
    };
  }

  async listTrashedBefore(threshold: Date, page: Page): Promise<FileRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM file_records WHERE state = 'Trashed' AND trashed_at <= ? ORDER BY trashed_at, id LIMIT ? OFFSET ?")
      .bind(toIso(threshold), page.limit, page.offset)
      .all<Row>();
    return rows.results.map(toFile);
  }

  async purge(id: Id, trashedBefore: Date, audit: AuditEntry): Promise<boolean> {
    // One transaction. The audit row is written only while the file is still due, and the same
    // condition guards the delete, so either both happen or neither does.
    const due = "id = ? AND state = 'Trashed' AND trashed_at <= ?";
    const threshold = toIso(trashedBefore);
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, result, occurred_at)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM file_records WHERE ${due})`,
        )
        .bind(audit.id, audit.actorUserId, audit.action, audit.targetType, audit.targetId, audit.result, toIso(audit.occurredAt), id, threshold),
      this.db.prepare(`DELETE FROM file_records WHERE ${due}`).bind(id, threshold),
    ]);
    const recorded = results[0];
    return recorded !== undefined && changes(recorded) === 1;
  }

  async insertBatch(batch: UploadBatch): Promise<void> {
    await this.db
      .prepare("INSERT INTO upload_batches (id, uploaded_by, hint_client_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(batch.id, batch.uploadedBy, batch.hintClientId, toIso(batch.createdAt))
      .run();
  }

  async findBatch(id: Id): Promise<UploadBatch | null> {
    const row = await this.db.prepare("SELECT * FROM upload_batches WHERE id = ?").bind(id).first<Row>();
    return row === null
      ? null
      : { id: text(row.id), uploadedBy: text(row.uploaded_by), hintClientId: textOrNull(row.hint_client_id), createdAt: fromIso(row.created_at) };
  }
}

function toReceipt(row: Row): FileReceipt {
  return { id: text(row.id), fileId: text(row.file_id), userId: text(row.user_id), firstViewedAt: fromIso(row.first_viewed_at) };
}

export class D1ReceiptRepository implements ReceiptRepository {
  constructor(private readonly db: D1Database) {}

  async insertIfAbsent(receipt: FileReceipt): Promise<boolean> {
    const result = await this.db
      .prepare("INSERT INTO file_receipts (id, file_id, user_id, first_viewed_at) VALUES (?, ?, ?, ?) ON CONFLICT (file_id, user_id) DO NOTHING")
      .bind(receipt.id, receipt.fileId, receipt.userId, toIso(receipt.firstViewedAt))
      .run();
    return changes(result) === 1;
  }

  async listByFile(fileId: Id): Promise<FileReceipt[]> {
    const rows = await this.db.prepare("SELECT * FROM file_receipts WHERE file_id = ? ORDER BY first_viewed_at, id").bind(fileId).all<Row>();
    return rows.results.map(toReceipt);
  }

  async listByFiles(fileIds: readonly Id[]): Promise<FileReceipt[]> {
    const receipts: FileReceipt[] = [];
    for (const ids of chunk(fileIds, IN_CHUNK)) {
      const rows = await this.db
        .prepare(`SELECT * FROM file_receipts WHERE file_id IN (${placeholders(ids.length)}) ORDER BY first_viewed_at, id`)
        .bind(...ids)
        .all<Row>();
      receipts.push(...rows.results.map(toReceipt));
    }
    return receipts;
  }

  async hasOpened(fileId: Id, userId: Id): Promise<boolean> {
    const row = await this.db.prepare("SELECT 1 AS found FROM file_receipts WHERE file_id = ? AND user_id = ?").bind(fileId, userId).first<Row>();
    return row !== null;
  }
}

export class D1AuditRepository implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db
      .prepare("INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, result, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(entry.id, entry.actorUserId, entry.action, entry.targetType, entry.targetId, entry.result, toIso(entry.occurredAt))
      .run();
  }

  async list(page: Page): Promise<AuditEntry[]> {
    const rows = await this.db.prepare("SELECT * FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?").bind(page.limit, page.offset).all<Row>();
    return rows.results.map((row) => ({
      id: text(row.id),
      actorUserId: textOrNull(row.actor_user_id),
      action: text(row.action),
      targetType: text(row.target_type),
      targetId: text(row.target_id),
      result: text(row.result) as AuditEntry["result"],
      occurredAt: fromIso(row.occurred_at),
    }));
  }
}

export class D1MetricRepository implements MetricRepository {
  constructor(private readonly db: D1Database) {}

  async append(event: MetricEvent): Promise<void> {
    await this.db
      .prepare("INSERT INTO metric_events (id, name, client_id, attributes, occurred_at) VALUES (?, ?, ?, ?, ?)")
      .bind(event.id, event.name, event.clientId, JSON.stringify(event.attributes), toIso(event.occurredAt))
      .run();
  }
}
