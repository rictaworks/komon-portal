/** Aggregated figures for the developer. Only counts and averages leave the database: no names, no file names, no IDs. */

export interface MetricsSummary {
  windowDays: number;
  /** Event counts by name, for the whole window. */
  events: { name: string; count: number }[];
  /** Distinct clients with at least one event, per ISO week (YYYY-WW). */
  activeClientsByWeek: { week: string; clients: number }[];
  /** Accepted documents by the way they were matched to a client. */
  acceptedByMethod: { method: string; count: number }[];
  /** Withdrawals by reason, and how many were incidents (mis-deliveries). */
  withdrawalsByReason: { reason: string; count: number; incidents: number }[];
  /** Hours from publication to the first view by a client member. */
  publishToFirstViewHours: { count: number; averageHours: number | null };
}

export const WINDOW_DAYS = 30;

export async function metricsSummary(db: D1Database, now: Date): Promise<MetricsSummary> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const events = await db
    .prepare("SELECT name, COUNT(*) AS count FROM metric_events WHERE occurred_at >= ? GROUP BY name ORDER BY name")
    .bind(since)
    .all<{ name: string; count: number }>();
  const weekly = await db
    .prepare(
      "SELECT strftime('%Y-%W', occurred_at) AS week, COUNT(DISTINCT client_id) AS clients FROM metric_events WHERE occurred_at >= ? AND client_id IS NOT NULL GROUP BY week ORDER BY week",
    )
    .bind(since)
    .all<{ week: string; clients: number }>();
  const accepted = await db
    .prepare(
      "SELECT COALESCE(json_extract(attributes, '$.method'), 'none') AS method, COUNT(*) AS count FROM metric_events WHERE name = 'intake.accepted' AND occurred_at >= ? GROUP BY method ORDER BY method",
    )
    .bind(since)
    .all<{ method: string; count: number }>();
  const withdrawals = await db
    .prepare(
      "SELECT COALESCE(json_extract(attributes, '$.reason'), 'none') AS reason, COUNT(*) AS count, SUM(CASE WHEN json_extract(attributes, '$.incident') = 1 THEN 1 ELSE 0 END) AS incidents FROM metric_events WHERE name = 'file.withdrawn' AND occurred_at >= ? GROUP BY reason ORDER BY reason",
    )
    .bind(since)
    .all<{ reason: string; count: number; incidents: number }>();
  const firstView = await db
    .prepare(
      "SELECT COUNT(*) AS count, AVG((julianday(r.first_viewed_at) - julianday(f.published_at)) * 24) AS averageHours FROM file_receipts r JOIN file_records f ON f.id = r.file_id WHERE f.published_at IS NOT NULL AND r.first_viewed_at >= ?",
    )
    .bind(since)
    .first<{ count: number; averageHours: number | null }>();
  return {
    windowDays: WINDOW_DAYS,
    events: events.results,
    activeClientsByWeek: weekly.results,
    acceptedByMethod: accepted.results,
    withdrawalsByReason: withdrawals.results.map((row) => ({ reason: row.reason, count: row.count, incidents: row.incidents ?? 0 })),
    publishToFirstViewHours: { count: firstView?.count ?? 0, averageHours: firstView?.averageHours ?? null },
  };
}
