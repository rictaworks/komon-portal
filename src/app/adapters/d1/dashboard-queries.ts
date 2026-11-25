import type { Id, LocalDate } from "../../../core/model/types";

export interface UnreadFile {
  id: Id;
  clientId: Id;
  displayName: string;
  publishedAt: Date;
}

const DASHBOARD_LIMIT = 100;

/** Read-only queries for the office dashboard. Callers check permission first. */
export class DashboardQueries {
  constructor(private readonly db: D1Database) {}

  /** Published documents that no client member has opened since `before`. */
  async unreadPublishedBefore(before: Date): Promise<UnreadFile[]> {
    const rows = await this.db
      .prepare(
        `SELECT f.id, f.client_id, f.display_name, f.published_at FROM file_records f
         WHERE f.direction = 'Outbound' AND f.state = 'Published' AND f.published_at <= ?
           AND NOT EXISTS (SELECT 1 FROM file_receipts r WHERE r.file_id = f.id)
         ORDER BY f.published_at LIMIT ?`,
      )
      .bind(before.toISOString(), DASHBOARD_LIMIT)
      .all<{ id: string; client_id: string; display_name: string; published_at: string }>();
    return rows.results.map((row) => ({ id: row.id, clientId: row.client_id, displayName: row.display_name, publishedAt: new Date(row.published_at) }));
  }

  /** Submitted cases whose submission date is on or before the given day (candidates for a retrieval warning). */
  async submittedCaseIdsOnOrBefore(day: LocalDate): Promise<Id[]> {
    const rows = await this.db
      .prepare("SELECT id FROM case_records WHERE state = 'Submitted' AND submitted_on IS NOT NULL AND submitted_on <= ? ORDER BY submitted_on LIMIT ?")
      .bind(day, DASHBOARD_LIMIT)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }

  /** Open cases whose due date is on or before the given day. */
  async openCaseIdsDueOnOrBefore(day: LocalDate): Promise<Id[]> {
    const rows = await this.db
      .prepare("SELECT id FROM case_records WHERE state NOT IN ('Closed', 'Cancelled') AND due_on IS NOT NULL AND due_on <= ? ORDER BY due_on LIMIT ?")
      .bind(day, DASHBOARD_LIMIT)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  }
}
