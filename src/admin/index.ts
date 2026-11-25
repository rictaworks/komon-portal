import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { ACCESS_HEADER, AdminConfigError, accessConfigOf, remoteAccessKeys, verifyAccess } from "./access";
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
  const weeks = rows(summary.activeClientsByWeek.map((week) => ({ label: week.week, value: String(week.clients) })));
  const accepted = rows(summary.acceptedByMethod.map((entry) => ({ label: entry.method, value: String(entry.count) })));
  const withdrawals = rows(summary.withdrawalsByReason.map((entry) => ({ label: entry.reason, value: `${entry.count} (incidents ${entry.incidents})` })));
  const firstView = summary.publishToFirstViewHours;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Operations summary</title></head>
<body>
<h1>Operations summary</h1>
<p>Last ${summary.windowDays} days. Counts only: no names, file names or identifiers.</p>
<h2>Events</h2><table><tbody>${events}</tbody></table>
<h2>Active clients per week</h2><table><tbody>${weeks}</tbody></table>
<h2>Accepted documents by matching method</h2><table><tbody>${accepted}</tbody></table>
<h2>Withdrawals by reason</h2><table><tbody>${withdrawals}</tbody></table>
<h2>Publication to first view</h2><p>${firstView.count} documents; average ${firstView.averageHours === null ? "no data" : `${firstView.averageHours.toFixed(1)} hours`}.</p>
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
    } catch {
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
