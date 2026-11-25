import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { metricsSummary } from "../../src/admin/metrics";
import { migrate, rejects } from "../support/d1";

// Wednesday of ISO week 2026-W48; the week before is 2026-W47.
const NOW = new Date("2026-11-25T03:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (msBefore: number): string => new Date(NOW.getTime() - msBefore).toISOString();

describe("admin summary figures", () => {
  let eventNumber = 0;

  async function event(
    name: string,
    options: { clientId?: string; actorKind?: "staff" | "member" | "system"; actorUserId?: string; attributes?: Record<string, unknown>; occurredAt?: string } = {},
  ): Promise<void> {
    eventNumber += 1;
    await env.DB.prepare("INSERT INTO metric_events (id, name, client_id, actor_kind, actor_user_id, attributes, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        `fig-event-${eventNumber}`, name, options.clientId ?? null, options.actorKind ?? null, options.actorUserId ?? null,
        JSON.stringify(options.attributes ?? {}), options.occurredAt ?? at(HOUR),
      )
      .run();
  }

  beforeAll(async () => {
    await migrate();
    await env.DB.prepare(
      "INSERT INTO users (id, google_sub, display_name, office_role, office_status, created_at) VALUES ('fig-staff-a', 'fig-sub-a', 'Staff A', 'Staff', 'Active', ?1), ('fig-staff-b', 'fig-sub-b', 'Staff B', 'Owner', 'Active', ?1), ('fig-member-a', 'fig-sub-m', 'Member A', NULL, NULL, ?1)",
    ).bind(at(40 * DAY)).run();
    await env.DB.prepare("INSERT INTO clients (id, code, corporate_name, status, version) VALUES ('fig-client-1', 'FIG01', 'Figure One Co', 'Active', 1), ('fig-client-2', 'FIG02', 'Figure Two Co', 'Active', 1)").run();
  });

  it("reports nothing measured as zero counts, no averages and no run of the daily job", async () => {
    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.activeByWeek).toEqual([]);
    expect(summary.reviewByReason).toEqual([]);
    expect(summary.intakeToPublishHours).toEqual({ count: 0, averageHours: null });
    expect(summary.jev.accepted).toBe(0);
    expect(summary.jev.belowThreshold).toBe(0);
    expect(summary.jev.confidence.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0, 0]);
    expect(summary.retrievalWarnings).toEqual({ cases: 0, byState: [] });
    expect(summary.dailyJob).toEqual({ runs: 0, failedRuns: 0, last: null });
  });

  it("accepts an actor only as a known kind, with a user ID exactly for a person", async () => {
    const insert = "INSERT INTO metric_events (id, name, client_id, actor_kind, actor_user_id, attributes, occurred_at) VALUES (?, 'probe', NULL, ?, ?, '{}', ?)";
    const old = at(60 * DAY);
    expect(await rejects(env.DB, insert, "fig-bad-1", "staff", null, old)).toBe(true);
    expect(await rejects(env.DB, insert, "fig-bad-2", "system", "fig-staff-a", old)).toBe(true);
    expect(await rejects(env.DB, insert, "fig-bad-3", null, "fig-staff-a", old)).toBe(true);
    expect(await rejects(env.DB, insert, "fig-bad-4", "owner", "fig-staff-a", old)).toBe(true);
    expect(await rejects(env.DB, insert, "fig-bad-5", "staff", "no-such-user", old)).toBe(true);
    expect(await rejects(env.DB, insert, "fig-good-1", "member", "fig-member-a", old)).toBe(false);
  });

  it("counts weekly active staff next to weekly active clients", async () => {
    // This week: two staff members (one acting twice) and a member of one client.
    await event("intake.accepted", { clientId: "fig-client-1", actorKind: "staff", actorUserId: "fig-staff-a" });
    await event("review.assigned", { clientId: "fig-client-1", actorKind: "staff", actorUserId: "fig-staff-a" });
    await event("intake.rejected", { actorKind: "staff", actorUserId: "fig-staff-b" });
    await event("file.first_viewed", { clientId: "fig-client-1", actorKind: "member", actorUserId: "fig-member-a" });
    // A job that touches a client's record is not that client using the portal.
    await event("purge.failed", { clientId: "fig-client-2", actorKind: "system" });
    // Last week: one staff member, two clients.
    await event("intake.accepted", { clientId: "fig-client-1", actorKind: "staff", actorUserId: "fig-staff-b", occurredAt: at(7 * DAY) });
    await event("submission.received", { clientId: "fig-client-2", actorKind: "member", actorUserId: "fig-member-a", occurredAt: at(7 * DAY) });
    // Before the window.
    await event("intake.accepted", { clientId: "fig-client-2", actorKind: "staff", actorUserId: "fig-staff-a", occurredAt: at(31 * DAY) });

    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.activeByWeek).toEqual([
      { week: "2026-W47", clients: 2, staff: 1 },
      { week: "2026-W48", clients: 1, staff: 2 },
    ]);
  });

  it("breaks review-required intake down by reason", async () => {
    await event("intake.accepted", { clientId: "fig-client-1", attributes: { state: "NeedsReview", method: null, reviewReason: "NoKey" } });
    await event("intake.accepted", { clientId: "fig-client-1", attributes: { state: "NeedsReview", method: null, reviewReason: "NoKey" } });
    await event("intake.accepted", { clientId: "fig-client-1", attributes: { state: "NeedsReview", method: "ClientCode", reviewReason: "HintMismatch" } });
    await event("intake.accepted", { clientId: "fig-client-1", attributes: { state: "Staged", method: "ArrivalNumber", reviewReason: null } });
    await event("intake.accepted", { clientId: "fig-client-1", attributes: { state: "NeedsReview", reviewReason: "ConflictingKeys" }, occurredAt: at(31 * DAY) });

    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.reviewByReason).toEqual([{ reason: "HintMismatch", count: 1 }, { reason: "NoKey", count: 2 }]);
  });

  it("averages the time from intake to publication over the documents published in the window", async () => {
    await env.DB.prepare("INSERT INTO upload_batches (id, uploaded_by, created_at) VALUES ('fig-batch', 'fig-staff-a', ?)").bind(at(40 * DAY)).run();
    const file = async (id: string, state: string, receivedAt: string, publishedAt: string | null): Promise<void> => {
      await env.DB.prepare(
        "INSERT INTO file_records (id, batch_id, direction, client_id, display_name, format, sha256, size_bytes, r2_key, state, received_at, published_at, version) VALUES (?, 'fig-batch', 'Outbound', 'fig-client-1', ?, 'pdf', ?, 10, ?, ?, ?, ?, 1)",
      ).bind(id, `name-${id}`, id.replaceAll("-", "").padEnd(64, "0"), `files/${id}`, state, receivedAt, publishedAt).run();
    };
    await file("fig-f-2h", "Published", at(2 * DAY + 2 * HOUR), at(2 * DAY));
    await file("fig-f-7h", "Published", at(3 * DAY + 7 * HOUR), at(3 * DAY));
    await file("fig-f-staged", "Staged", at(DAY), null);
    await file("fig-f-old", "Published", at(40 * DAY), at(35 * DAY));

    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.intakeToPublishHours.count).toBe(2);
    expect(summary.intakeToPublishHours.averageHours).toBeCloseTo(4.5, 3);
  });

  it("counts Jev judgments by outcome and by confidence range", async () => {
    const jev = (confidence: number, accepted: boolean, occurredAt?: string) =>
      event("jev.classified", { clientId: "fig-client-1", actorKind: "staff", actorUserId: "fig-staff-a", attributes: { fileId: "fig-f-2h", model: "jev-1", confidence, accepted }, ...(occurredAt === undefined ? {} : { occurredAt }) });
    await jev(0.97, true);
    await jev(0.9, true);
    await jev(0.89, false);
    await jev(0.8, false);
    await jev(0.75, false);
    await jev(0.5, false);
    await jev(0.2, false);
    await jev(1, true, at(31 * DAY));

    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.jev).toEqual({
      accepted: 2,
      belowThreshold: 5,
      confidence: [
        { range: "0.00-0.49", count: 1 },
        { range: "0.50-0.69", count: 1 },
        { range: "0.70-0.79", count: 1 },
        { range: "0.80-0.89", count: 2 },
        { range: "0.90-1.00", count: 2 },
      ],
    });
  });

  it("counts the cases that entered a retrieval warning by the state they are in now", async () => {
    await env.DB.prepare("INSERT INTO case_types (id, kind, label) VALUES ('fig-type', 'Procedure', 'Figure type')").run();
    const warnedCase = async (id: string, sequence: number, state: string, occurredAt: string): Promise<void> => {
      await env.DB.prepare(
        "INSERT INTO case_records (id, client_id, case_type_id, target_month, sequence, reference_code, submitted_on, state, version, created_at) VALUES (?, 'fig-client-1', 'fig-type', '2026-08', ?, ?, '2026-08-20', ?, 1, ?)",
      ).bind(id, sequence, `FIG-${sequence}`, state, at(90 * DAY)).run();
      await event("case.retrieval_warned", { clientId: "fig-client-1", actorKind: "system", attributes: { caseId: id, level: "warning" }, occurredAt });
    };
    await warnedCase("fig-case-waiting", 1, "Submitted", at(2 * DAY));
    await warnedCase("fig-case-arrived-1", 2, "DocumentReceived", at(5 * DAY));
    await warnedCase("fig-case-arrived-2", 3, "DocumentReceived", at(6 * DAY));
    await warnedCase("fig-case-closed", 4, "Closed", at(9 * DAY));
    await warnedCase("fig-case-before", 5, "Delivered", at(31 * DAY));

    const summary = await metricsSummary(env.DB, NOW);
    expect(summary.retrievalWarnings).toEqual({
      cases: 4,
      byState: [{ state: "Closed", count: 1 }, { state: "DocumentReceived", count: 2 }, { state: "Submitted", count: 1 }],
    });
  });

  it("shows when the daily job last ran and what it reported", async () => {
    const run = (occurredAt: string, attributes: Record<string, unknown>) => event("maintenance.finished", { actorKind: "system", attributes, occurredAt });
    await run(at(40 * DAY), { result: "failed", failedSteps: "purge", purged: 0, purgeSkipped: 0, purgeFailed: 0, expiredInvitations: 0, removedSessions: 0, retrievalWarnings: 0 });
    await run(at(2 * DAY), { result: "failed", failedSteps: "sessions,purge_files", purged: 1, purgeSkipped: 0, purgeFailed: 2, expiredInvitations: 0, removedSessions: 0, retrievalWarnings: 0 });
    expect((await metricsSummary(env.DB, NOW)).dailyJob).toEqual({
      runs: 1,
      failedRuns: 1,
      last: {
        ranAt: at(2 * DAY), result: "failed", failedSteps: ["sessions", "purge_files"], purged: 1, purgeSkipped: 0, purgeFailed: 2, expiredInvitations: 0, removedSessions: 0, retrievalWarnings: 0,
      },
    });

    await run(at(3 * HOUR), { result: "ok", failedSteps: "", purged: 4, purgeSkipped: 1, purgeFailed: 0, expiredInvitations: 2, removedSessions: 3, retrievalWarnings: 5 });
    expect((await metricsSummary(env.DB, NOW)).dailyJob).toEqual({
      runs: 2,
      failedRuns: 1,
      last: {
        ranAt: at(3 * HOUR), result: "ok", failedSteps: [], purged: 4, purgeSkipped: 1, purgeFailed: 0, expiredInvitations: 2, removedSessions: 3, retrievalWarnings: 5,
      },
    });
  });

  it("shows the last run of the daily job even when it is older than the window", async () => {
    const summary = await metricsSummary(env.DB, new Date(NOW.getTime() + 45 * DAY));
    expect(summary.dailyJob.runs).toBe(0);
    expect(summary.dailyJob.last).toMatchObject({ ranAt: at(3 * HOUR), result: "ok" });
  });

  it("lets no internal ID or name out of the summary", async () => {
    const text = JSON.stringify(await metricsSummary(env.DB, NOW));
    for (const hidden of ["fig-staff", "fig-member", "fig-client", "fig-case", "fig-f-", "fig-event", "Figure", "Staff A", "jev-1"]) {
      expect(text).not.toContain(hidden);
    }
  });
});
