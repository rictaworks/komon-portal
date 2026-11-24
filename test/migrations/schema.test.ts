import { beforeAll, describe, expect, it } from "vitest";
import { migrate, rejects, run } from "../support/d1";

const NOW = "2026-11-24T00:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const FILE_COLUMNS =
  "id, batch_id, direction, client_id, display_name, format, sha256, size_bytes, r2_key, state, trashed_from, review_reason, received_at, published_at, trashed_at, version";

function fileSql(): string {
  return `INSERT INTO file_records (${FILE_COLUMNS}) VALUES (?, 'b1', ?, ?, ?, 'pdf', ?, 10, ?, ?, ?, ?, '${NOW}', ?, ?, 1)`;
}

interface FileRow {
  id: string;
  direction?: string;
  clientId?: string | null;
  sha?: string;
  state: string;
  trashedFrom?: string | null;
  reviewReason?: string | null;
  publishedAt?: string | null;
  trashedAt?: string | null;
}

function fileParams(row: FileRow): unknown[] {
  return [
    row.id,
    row.direction ?? "Outbound",
    row.clientId === undefined ? "c1" : row.clientId,
    `name-${row.id}`,
    row.sha ?? SHA_A,
    `key-${row.id}`,
    row.state,
    row.trashedFrom ?? null,
    row.reviewReason ?? null,
    row.publishedAt ?? null,
    row.trashedAt ?? null,
  ];
}

describe("D1 schema", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = await migrate();
    await run(db, "INSERT INTO users (id, google_sub, display_name, office_role, office_status, created_at) VALUES ('u1', 'sub1', 'A', 'Owner', 'Active', ?)", NOW);
    await run(db, "INSERT INTO users (id, google_sub, display_name, created_at) VALUES ('u2', 'sub2', 'B', ?)", NOW);
    await run(db, "INSERT INTO clients (id, code, corporate_name, corporate_number, status, version) VALUES ('c1', 'C0031', 'One', NULL, 'Active', 1)");
    await run(db, "INSERT INTO clients (id, code, corporate_name, corporate_number, status, version) VALUES ('c2', 'C0142', 'Two', '1234567890123', 'Active', 1)");
    await run(db, "INSERT INTO case_types (id, kind, label) VALUES ('t1', 'Procedure', 'Social insurance')");
    await run(db, "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, state, version, created_at) VALUES ('k1', 'c1', 't1', '2026-11', 1, 'SHAHO-2611-01', 'Open', 1, ?)", NOW);
    await run(db, "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, state, version, created_at) VALUES ('k2', 'c2', 't1', '2026-11', 1, 'SHAHO-2611-01', 'Open', 1, ?)", NOW);
    await run(db, "INSERT INTO upload_batches (id, uploaded_by, created_at) VALUES ('b1', 'u1', ?)", NOW);
  });

  it("creates every table of the ER diagram", async () => {
    const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>();
    expect(rows.results.map((row) => row.name)).toEqual([
      "audit_log", "case_arrivals", "case_records", "case_types", "clients", "doc_rules", "doc_types", "file_receipts",
      "file_records", "invitations", "memberships", "metric_events", "office_setting", "push_subscriptions", "sessions",
      "upload_batches", "users",
    ]);
  });

  it("stores no email, original file name or IP address column", async () => {
    const rows = await db.prepare("SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'").all<{ tbl: string; col: string }>();
    const forbidden = rows.results.filter((row) => /mail|original|file_name|filename|ip_addr|^ip$|birth|phone|address/i.test(row.col));
    expect(forbidden).toEqual([]);
  });

  it("seeds one settings row with the documented defaults and keeps it single", async () => {
    const row = await db.prepare("SELECT * FROM office_setting").first();
    expect(row).toMatchObject({ id: 1, timezone: "Asia/Tokyo", retrieval_deadline_days: 90, auto_publish_enabled: 0, jev_threshold: 0.9 });
    expect(await rejects(db, "INSERT INTO office_setting VALUES (2, 'Asia/Tokyo', 'x', 90, 0, 0.9, 1)")).toBe(true);
    expect(await rejects(db, "UPDATE office_setting SET jev_threshold = 0.79")).toBe(true);
  });

  it("restricts state columns", async () => {
    expect(await rejects(db, "UPDATE clients SET status = 'Deleted' WHERE id = 'c1'")).toBe(true);
    expect(await rejects(db, "UPDATE case_records SET state = 'Done' WHERE id = 'k1'")).toBe(true);
    expect(await rejects(db, "UPDATE users SET office_role = 'Admin' WHERE id = 'u1'")).toBe(true);
    expect(await rejects(db, "UPDATE users SET office_role = 'Staff' WHERE id = 'u2'")).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "bad-state", state: "Unknown" }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "bad-dir", direction: "Inbound", state: "Staged" }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "bad-dir2", state: "Submitted" }))).toBe(true);
  });

  it("requires a client for published and staged files and a reason for review", async () => {
    expect(await rejects(db, fileSql(), ...fileParams({ id: "p0", clientId: null, state: "Published", publishedAt: NOW, sha: SHA_B }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "s0", clientId: null, state: "Staged", sha: SHA_B }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "r0", clientId: null, state: "NeedsReview", sha: SHA_B }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "r1", clientId: null, state: "NeedsReview", reviewReason: "NoKey", sha: SHA_B }))).toBe(false);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "p1", state: "Published", sha: "c".repeat(64) }))).toBe(true);
  });

  it("keeps client and content unique except for trashed rows", async () => {
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f1", state: "Staged" }))).toBe(false);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f2", state: "Staged" }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f3", clientId: "c2", state: "Staged" }))).toBe(false);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f4", state: "Trashed", trashedFrom: "Staged", trashedAt: NOW }))).toBe(false);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f5", state: "Trashed", trashedFrom: "Staged", trashedAt: NOW }))).toBe(false);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "f6", state: "Trashed" }))).toBe(true);
  });

  it("keeps arrival numbers globally unique", async () => {
    expect(await rejects(db, "INSERT INTO case_arrivals (id, case_id, arrival_number) VALUES ('a1', 'k1', '202611240912345678')")).toBe(false);
    expect(await rejects(db, "INSERT INTO case_arrivals (id, case_id, arrival_number) VALUES ('a2', 'k2', '202611240912345678')")).toBe(true);
  });

  it("allows one ongoing membership per user and client", async () => {
    const sql = "INSERT INTO memberships (id, user_id, client_id, status, created_at) VALUES (?, 'u2', 'c1', ?, ?)";
    expect(await rejects(db, sql, "m1", "Pending", NOW)).toBe(false);
    expect(await rejects(db, sql, "m2", "Active", NOW)).toBe(true);
    await run(db, "UPDATE memberships SET status = 'Rejected' WHERE id = 'm1'");
    expect(await rejects(db, sql, "m3", "Pending", NOW)).toBe(false);
    await run(db, "UPDATE memberships SET status = 'Revoked' WHERE id = 'm3'");
    expect(await rejects(db, sql, "m4", "Active", NOW)).toBe(false);
  });

  it("records one receipt per file and user", async () => {
    const sql = "INSERT INTO file_receipts (id, file_id, user_id, first_viewed_at) VALUES (?, 'f1', 'u2', ?)";
    expect(await rejects(db, sql, "x1", NOW)).toBe(false);
    expect(await rejects(db, sql, "x2", NOW)).toBe(true);
  });

  it("makes the audit log append-only", async () => {
    await run(db, "INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, result, occurred_at) VALUES ('l1', 'u1', 'file.publish', 'file', 'f1', 'ok', ?)", NOW);
    await run(db, "INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, result, occurred_at) VALUES ('l2', NULL, 'file.purge', 'file', 'f9', 'ok', ?)", NOW);
    expect(await rejects(db, "UPDATE audit_log SET result = 'denied' WHERE id = 'l1'")).toBe(true);
    expect(await rejects(db, "DELETE FROM audit_log WHERE id = 'l1'")).toBe(true);
    expect(await rejects(db, "INSERT OR REPLACE INTO audit_log (id, actor_user_id, action, target_type, target_id, result, occurred_at) VALUES ('l1', 'u1', 'x', 'file', 'f1', 'denied', ?)", NOW)).toBe(true);
    const kept = await db.prepare("SELECT result FROM audit_log WHERE id = 'l1'").first<{ result: string }>();
    expect(kept?.result).toBe("ok");
    const count = await db.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("validates identifiers that must not carry free text", async () => {
    const caseSql = "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, state, version, created_at) VALUES (?, 'c1', 't1', ?, ?, ?, 'Open', 1, ?)";
    expect(await rejects(db, caseSql, "k3", "2026-11", 2, "Taro Yamada", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "k4", "2026-11", 2, "", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "k5", "2026/11", 2, "OK-1", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "k6", "2026-11", 1, "OK-1", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "k7", "2026-11", 2, "OK-1", NOW)).toBe(false);
    expect(await rejects(db, "INSERT INTO clients (id, code, corporate_name, status, version) VALUES ('c3', 'C0031', 'Dup', 'Active', 1)")).toBe(true);
    expect(await rejects(db, "INSERT INTO clients (id, code, corporate_name, corporate_number, status, version) VALUES ('c4', 'C9', 'Bad', '12345', 'Active', 1)")).toBe(true);
    expect(await rejects(db, "INSERT INTO metric_events (id, name, attributes, occurred_at) VALUES ('e1', 'intake', 'not json', ?)", NOW)).toBe(true);
  });

  it("ties invitations to exactly one target", async () => {
    const sql = "INSERT INTO invitations (id, code_hash, target_type, client_id, office_role, issued_by, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'u1', ?, 'Issued', ?)";
    expect(await rejects(db, sql, "i1", "h1", "Client", "c1", null, NOW, NOW)).toBe(false);
    expect(await rejects(db, sql, "i2", "h2", "Office", null, "Staff", NOW, NOW)).toBe(false);
    expect(await rejects(db, sql, "i3", "h3", "Client", null, null, NOW, NOW)).toBe(true);
    expect(await rejects(db, sql, "i4", "h4", "Office", "c1", "Staff", NOW, NOW)).toBe(true);
    expect(await rejects(db, sql, "i5", "h1", "Client", "c1", null, NOW, NOW)).toBe(true);
  });

  it("rejects invalid months, statuses and trash origins", async () => {
    const caseSql = "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, state, version, created_at) VALUES (?, 'c1', 't1', ?, 9, 'OK-9', 'Open', 1, ?)";
    expect(await rejects(db, caseSql, "km1", "2026-00", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "km2", "2026-13", NOW)).toBe(true);
    expect(await rejects(db, caseSql, "km3", "2026-12", NOW)).toBe(false);
    expect(await rejects(db, "INSERT INTO memberships (id, user_id, client_id, status, created_at) VALUES ('mx', 'u2', 'c2', 'Banned', ?)", NOW)).toBe(true);
    expect(await rejects(db, "UPDATE invitations SET status = 'Lost'")).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "t1", state: "Trashed", trashedFrom: "Published", trashedAt: NOW, sha: "d".repeat(64) }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "t2", state: "Trashed", trashedFrom: "Submitted", trashedAt: NOW, sha: "d".repeat(64) }))).toBe(true);
    expect(await rejects(db, fileSql(), ...fileParams({ id: "t3", direction: "Inbound", state: "Trashed", trashedFrom: "Submitted", trashedAt: NOW, sha: "d".repeat(64) }))).toBe(false);
  });

  it("requires a reason for withdrawn files and a time for acknowledged ones", async () => {
    await run(db, fileSql(), ...fileParams({ id: "w1", state: "Published", publishedAt: NOW, sha: "e".repeat(64) }));
    expect(await rejects(db, "UPDATE file_records SET state = 'Withdrawn' WHERE id = 'w1'")).toBe(true);
    expect(await rejects(db, "UPDATE file_records SET state = 'Withdrawn', withdraw_reason = 'WrongFile' WHERE id = 'w1'")).toBe(false);
    await run(db, fileSql(), ...fileParams({ id: "w2", direction: "Inbound", state: "Submitted", sha: "f".repeat(64) }));
    expect(await rejects(db, "UPDATE file_records SET state = 'Acknowledged' WHERE id = 'w2'")).toBe(true);
    expect(await rejects(db, "UPDATE file_records SET state = 'Acknowledged', acknowledged_at = ? WHERE id = 'w2'", NOW)).toBe(false);
  });

  it("links a file only to a case of its own client", async () => {
    expect(await rejects(db, "UPDATE file_records SET case_id = 'k2' WHERE id = 'f1'")).toBe(true);
    expect(await rejects(db, "UPDATE file_records SET case_id = 'k1' WHERE id = 'f1'")).toBe(false);
    expect(await rejects(db, "UPDATE file_records SET case_id = 'missing' WHERE id = 'f1'")).toBe(true);
  });

  it("removes receipts together with a purged file", async () => {
    await run(db, "DELETE FROM file_records WHERE id = 'f1'");
    const left = await db.prepare("SELECT COUNT(*) AS n FROM file_receipts WHERE file_id = 'f1'").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("enforces foreign keys", async () => {
    expect(await rejects(db, "INSERT INTO memberships (id, user_id, client_id, status, created_at) VALUES ('m9', 'nobody', 'c1', 'Pending', ?)", NOW)).toBe(true);
  });
});
