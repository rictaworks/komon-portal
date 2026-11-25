/** Aggregated figures for the developer. Only counts and averages leave the database: no names, no file names, no IDs. */

export interface MetricsSummary {
  windowDays: number;
  /** Event counts by name, for the whole window. */
  events: { name: string; count: number }[];
  /**
   * Per ISO week (YYYY-Www): distinct clients with at least one event that a person caused, and
   * distinct staff members who caused at least one event. Events of the scheduled jobs count for neither.
   */
  activeByWeek: { week: string; clients: number; staff: number }[];
  /** Accepted documents by the way they were matched to a client. */
  acceptedByMethod: { method: string; count: number }[];
  /** Accepted documents that needed a review, by the reason. */
  reviewByReason: { reason: string; count: number }[];
  /** Documents published in the window, and the average hours from their intake to their publication. */
  intakeToPublishHours: { count: number; averageHours: number | null };
  /** Jev judgments: how many were applied or stayed below the office's threshold, and how the confidence was spread. */
  jev: { accepted: number; belowThreshold: number; confidence: { range: string; count: number }[] };
  /** Cases recorded in the window as having entered the retrieval warning period, by the state they are in now. */
  retrievalWarnings: { cases: number; byState: { state: string; count: number }[] };
  /** Runs of the daily job in the window, and what the most recent run (of any age) reported. */
  dailyJob: { runs: number; failedRuns: number; last: DailyJobRun | null };
  /** Withdrawals by reason, and how many were incidents (mis-deliveries). */
  withdrawalsByReason: { reason: string; count: number; incidents: number }[];
  /** Documents published in the window: how many were viewed, and the average hours from publication to a member's first view of each. */
  publishToFirstViewHours: { count: number; averageHours: number | null };
}

export interface DailyJobRun {
  ranAt: string;
  result: "ok" | "failed";
  /** Names of the steps that failed; empty for a run that completed. */
  failedSteps: string[];
  purged: number;
  purgeSkipped: number;
  purgeFailed: number;
  expiredInvitations: number;
  removedSessions: number;
  retrievalWarnings: number;
}

export const WINDOW_DAYS = 30;

/** Confidence ranges of the Jev distribution: lower bound (inclusive) and label, in ascending order. */
const CONFIDENCE_RANGES = [
  { from: 0, range: "0.00-0.49" },
  { from: 0.5, range: "0.50-0.69" },
  { from: 0.7, range: "0.70-0.79" },
  { from: 0.8, range: "0.80-0.89" },
  { from: 0.9, range: "0.90-1.00" },
] as const;

/** Reads the stored report of a run. A report that is not in the recorded shape is an error, not a row of zeros. */
function dailyJobRun(ranAt: string, attributes: string): DailyJobRun {
  const report = JSON.parse(attributes) as Record<string, unknown>;
  const result = report.result;
  const failedSteps = report.failedSteps;
  if ((result !== "ok" && result !== "failed") || typeof failedSteps !== "string") {
    throw new Error("maintenance report is not in the recorded shape");
  }
  const count = (key: Exclude<keyof DailyJobRun, "ranAt" | "result" | "failedSteps">): number => {
    const value = report[key];
    if (typeof value !== "number") {
      throw new Error("maintenance report is not in the recorded shape");
    }
    return value;
  };
  return {
    ranAt,
    result,
    failedSteps: failedSteps === "" ? [] : failedSteps.split(","),
    purged: count("purged"),
    purgeSkipped: count("purgeSkipped"),
    purgeFailed: count("purgeFailed"),
    expiredInvitations: count("expiredInvitations"),
    removedSessions: count("removedSessions"),
    retrievalWarnings: count("retrievalWarnings"),
  };
}

export async function metricsSummary(db: D1Database, now: Date): Promise<MetricsSummary> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const events = await db
    .prepare("SELECT name, COUNT(*) AS count FROM metric_events WHERE occurred_at >= ? GROUP BY name ORDER BY name")
    .bind(since)
    .all<{ name: string; count: number }>();
  const weekly = await db
    .prepare(
      // Events recorded before the actor was stored have no kind; they count for the client as they did then.
      "SELECT strftime('%G-W%V', occurred_at) AS week, COUNT(DISTINCT client_id) AS clients, COUNT(DISTINCT CASE WHEN actor_kind = 'staff' THEN actor_user_id END) AS staff FROM metric_events WHERE occurred_at >= ? AND (actor_kind IS NULL OR actor_kind <> 'system') AND (client_id IS NOT NULL OR actor_kind = 'staff') GROUP BY week ORDER BY week",
    )
    .bind(since)
    .all<{ week: string; clients: number; staff: number }>();
  const review = await db
    .prepare(
      "SELECT json_extract(attributes, '$.reviewReason') AS reason, COUNT(*) AS count FROM metric_events WHERE name = 'intake.accepted' AND occurred_at >= ? AND json_extract(attributes, '$.reviewReason') IS NOT NULL GROUP BY reason ORDER BY reason",
    )
    .bind(since)
    .all<{ reason: string; count: number }>();
  const intakeToPublish = await db
    .prepare(
      "SELECT COUNT(*) AS count, AVG((julianday(published_at) - julianday(received_at)) * 24) AS averageHours FROM file_records WHERE published_at IS NOT NULL AND published_at >= ?",
    )
    .bind(since)
    .first<{ count: number; averageHours: number | null }>();
  const jevOutcome = await db
    .prepare(
      "SELECT SUM(CASE WHEN json_extract(attributes, '$.accepted') = 1 THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN json_extract(attributes, '$.accepted') = 1 THEN 0 ELSE 1 END) AS belowThreshold FROM metric_events WHERE name = 'jev.classified' AND occurred_at >= ?",
    )
    .bind(since)
    .first<{ accepted: number | null; belowThreshold: number | null }>();
  const jevConfidence = await db
    .prepare(
      `SELECT (${CONFIDENCE_RANGES.map(() => "(json_extract(attributes, '$.confidence') >= ?)").join(" + ")}) - 1 AS position, COUNT(*) AS count FROM metric_events WHERE name = 'jev.classified' AND occurred_at >= ? GROUP BY position`,
    )
    .bind(...CONFIDENCE_RANGES.map((entry) => entry.from), since)
    .all<{ position: number; count: number }>();
  const warned = await db
    .prepare(
      "SELECT c.state AS state, COUNT(DISTINCT c.id) AS count FROM metric_events m JOIN case_records c ON c.id = json_extract(m.attributes, '$.caseId') WHERE m.name = 'case.retrieval_warned' AND m.occurred_at >= ? GROUP BY c.state ORDER BY c.state",
    )
    .bind(since)
    .all<{ state: string; count: number }>();
  const jobRuns = await db
    .prepare(
      "SELECT COUNT(*) AS runs, SUM(CASE WHEN json_extract(attributes, '$.result') = 'ok' THEN 0 ELSE 1 END) AS failedRuns FROM metric_events WHERE name = 'maintenance.finished' AND occurred_at >= ?",
    )
    .bind(since)
    .first<{ runs: number; failedRuns: number | null }>();
  const lastRun = await db
    .prepare("SELECT occurred_at AS ranAt, attributes FROM metric_events WHERE name = 'maintenance.finished' ORDER BY occurred_at DESC LIMIT 1")
    .first<{ ranAt: string; attributes: string }>();
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
      // One row per document: its earliest view, so a document opened by many members counts once.
      "SELECT COUNT(*) AS count, AVG(hours) AS averageHours FROM (SELECT (julianday(MIN(r.first_viewed_at)) - julianday(f.published_at)) * 24 AS hours FROM file_records f JOIN file_receipts r ON r.file_id = f.id WHERE f.published_at IS NOT NULL AND f.published_at >= ? GROUP BY f.id)",
    )
    .bind(since)
    .first<{ count: number; averageHours: number | null }>();
  return {
    windowDays: WINDOW_DAYS,
    events: events.results,
    activeByWeek: weekly.results,
    acceptedByMethod: accepted.results,
    reviewByReason: review.results,
    intakeToPublishHours: { count: intakeToPublish?.count ?? 0, averageHours: intakeToPublish?.averageHours ?? null },
    jev: {
      accepted: jevOutcome?.accepted ?? 0,
      belowThreshold: jevOutcome?.belowThreshold ?? 0,
      confidence: CONFIDENCE_RANGES.map((entry, position) => ({
        range: entry.range,
        count: jevConfidence.results.find((row) => row.position === position)?.count ?? 0,
      })),
    },
    retrievalWarnings: { cases: warned.results.reduce((total, row) => total + row.count, 0), byState: warned.results },
    dailyJob: {
      runs: jobRuns?.runs ?? 0,
      failedRuns: jobRuns?.failedRuns ?? 0,
      last: lastRun === null ? null : dailyJobRun(lastRun.ranAt, lastRun.attributes),
    },
    withdrawalsByReason: withdrawals.results.map((row) => ({ reason: row.reason, count: row.count, incidents: row.incidents ?? 0 })),
    publishToFirstViewHours: { count: firstView?.count ?? 0, averageHours: firstView?.averageHours ?? null },
  };
}
