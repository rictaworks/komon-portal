import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { errors } from "jose";
import { ACCESS_HEADER, AdminConfigError, accessConfigOf, remoteAccessKeys, verifyAccess } from "./access";
import { adminText } from "./messages";
import { metricsSummary, type MetricsSummary } from "./metrics";

/**
 * The developer's Worker. It has no R2 binding and never reads documents or the Jev key. Every route
 * sits behind Cloudflare Access, and the assertion is verified here as well, not only at the edge.
 */
export interface AdminEnv {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export interface AdminOptions {
  /** Test seam: the keys that verify the assertion. Production uses the team's published keys. */
  keys?: JWTVerifyGetKey;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderPage(summary: MetricsSummary): string {
  const rows = (items: readonly { label: string; value: string }[]) =>
    items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`).join("");
  const events = rows(summary.events.map((event) => ({ label: event.name, value: String(event.count) })));
  const weeks = rows(
    summary.activeByWeek.map((week) => ({ label: week.week, value: adminText("admin.weekly.value", { clients: week.clients, staff: week.staff }) })),
  );
  const review = rows(summary.reviewByReason.map((entry) => ({ label: entry.reason, value: String(entry.count) })));
  const intakeToPublish = summary.intakeToPublishHours;
  const intakeToPublishText =
    intakeToPublish.averageHours === null
      ? adminText("admin.intakeToPublish.noData", { count: intakeToPublish.count })
      : adminText("admin.intakeToPublish.text", { count: intakeToPublish.count, hours: intakeToPublish.averageHours.toFixed(1) });
  const jevConfidence = rows(
    summary.jev.confidence.map((entry) => ({ label: adminText("admin.jev.confidence", { range: entry.range }), value: String(entry.count) })),
  );
  const warnedStates = rows(summary.retrievalWarnings.byState.map((entry) => ({ label: entry.state, value: String(entry.count) })));
  const lastRun = summary.dailyJob.last;
  const jobLines =
    lastRun === null
      ? [adminText("admin.dailyJob.none")]
      : [
          lastRun.result === "ok"
            ? adminText("admin.dailyJob.ok", { ranAt: lastRun.ranAt })
            : adminText("admin.dailyJob.failed", { ranAt: lastRun.ranAt, steps: lastRun.failedSteps.join(", ") }),
          adminText("admin.dailyJob.report", {
            purged: lastRun.purged,
            purgeSkipped: lastRun.purgeSkipped,
            purgeFailed: lastRun.purgeFailed,
            expiredInvitations: lastRun.expiredInvitations,
            removedSessions: lastRun.removedSessions,
            retrievalWarnings: lastRun.retrievalWarnings,
          }),
        ];
  jobLines.push(adminText("admin.dailyJob.runs", { runs: summary.dailyJob.runs, failedRuns: summary.dailyJob.failedRuns }));
  const job = jobLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const accepted = rows(summary.acceptedByMethod.map((entry) => ({ label: entry.method, value: String(entry.count) })));
  const withdrawals = rows(
    summary.withdrawalsByReason.map((entry) => ({ label: entry.reason, value: adminText("admin.withdrawals.incidents", { count: entry.count, incidents: entry.incidents }) })),
  );
  const firstView = summary.publishToFirstViewHours;
  const firstViewText =
    firstView.averageHours === null
      ? adminText("admin.firstView.noData", { count: firstView.count })
      : adminText("admin.firstView.text", { count: firstView.count, hours: firstView.averageHours.toFixed(1) });
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(adminText("admin.title"))}</title></head>
<body>
<h1>${escapeHtml(adminText("admin.title"))}</h1>
<p>${escapeHtml(adminText("admin.window", { days: summary.windowDays }))}</p>
<h2>${escapeHtml(adminText("admin.dailyJob.heading"))}</h2>${job}
<h2>${escapeHtml(adminText("admin.events.heading"))}</h2><table><tbody>${events}</tbody></table>
<h2>${escapeHtml(adminText("admin.weekly.heading"))}</h2><table><tbody>${weeks}</tbody></table>
<h2>${escapeHtml(adminText("admin.accepted.heading"))}</h2><table><tbody>${accepted}</tbody></table>
<h2>${escapeHtml(adminText("admin.review.heading"))}</h2><table><tbody>${review}</tbody></table>
<h2>${escapeHtml(adminText("admin.intakeToPublish.heading"))}</h2><p>${escapeHtml(intakeToPublishText)}</p>
<h2>${escapeHtml(adminText("admin.jev.heading"))}</h2><p>${escapeHtml(adminText("admin.jev.outcome", { accepted: summary.jev.accepted, belowThreshold: summary.jev.belowThreshold }))}</p><table><tbody>${jevConfidence}</tbody></table>
<h2>${escapeHtml(adminText("admin.retrieval.heading"))}</h2><p>${escapeHtml(adminText("admin.retrieval.total", { cases: summary.retrievalWarnings.cases }))}</p><table><tbody>${warnedStates}</tbody></table>
<h2>${escapeHtml(adminText("admin.withdrawals.heading"))}</h2><table><tbody>${withdrawals}</tbody></table>
<h2>${escapeHtml(adminText("admin.firstView.heading"))}</h2><p>${escapeHtml(firstViewText)}</p>
</body>
</html>`;
}

export function createAdminApp(options: AdminOptions = {}): Hono<{ Bindings: AdminEnv }> {
  const app = new Hono<{ Bindings: AdminEnv }>();
  // The key set is fetched once per team domain and reused, so a request does not refetch it.
  const keysByTeam = new Map<string, JWTVerifyGetKey>();

  app.use("*", async (c, next) => {
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.use("*", async (c, next) => {
    const config = accessConfigOf(c.env);
    const token = c.req.header(ACCESS_HEADER);
    if (token === undefined || token === "") {
      return c.json({ error: "access_required" }, 401);
    }
    const keys = options.keys ?? keysByTeam.get(config.teamDomain) ?? remoteAccessKeys(config.teamDomain);
    keysByTeam.set(config.teamDomain, keys);
    try {
      await verifyAccess(token, config, keys);
    } catch (error) {
      // A key set that cannot be reached is an outage, not a refused visitor: it is reported and logged as one.
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        console.error(JSON.stringify({ event: "admin_access_unavailable", name: error instanceof Error ? error.name : "unknown" }));
        return c.json({ error: "access_unavailable" }, 503);
      }
      return c.json({ error: "access_denied" }, 403);
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/summary", async (c) => c.json(await metricsSummary(c.env.DB, new Date())));
  app.get("/", async (c) => c.html(renderPage(await metricsSummary(c.env.DB, new Date()))));

  app.onError((error, c) => {
    if (error instanceof AdminConfigError) {
      return c.json({ error: "not_configured" }, 503);
    }
    console.error(JSON.stringify({ event: "admin_error", name: error.name }));
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

const app = createAdminApp();
export default app;
