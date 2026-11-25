import { env } from "cloudflare:test";
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createAdminApp } from "../../src/admin/index";
import { migrate } from "../support/d1";

const TEAM = "team.example.cloudflareaccess.com";
const AUD = "aud-admin-1";
const KID = "kid-1";

type AdminEnv = { DB: D1Database; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

describe("admin Worker", () => {
  let keyPair: { privateKey: CryptoKey; publicKey: CryptoKey };
  let app: ReturnType<typeof createAdminApp>;
  let config: AdminEnv;

  async function assertion(overrides: { aud?: string; iss?: string; sub?: string; key?: CryptoKey } = {}): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .setIssuer(overrides.iss ?? `https://${TEAM}`)
      .setAudience(overrides.aud ?? AUD)
      .setSubject(overrides.sub ?? "access-subject-1")
      .setExpirationTime("5m")
      .sign(overrides.key ?? keyPair.privateKey);
  }

  beforeAll(async () => {
    await migrate();
    keyPair = (await generateKeyPair("ES256", { extractable: true })) as { privateKey: CryptoKey; publicKey: CryptoKey };
    const publicJwk: JWK = { ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: "ES256", use: "sig" };
    app = createAdminApp({ keys: createLocalJWKSet({ keys: [publicJwk] }) });
    // No R2 binding: the admin Worker cannot reach document bodies.
    config = { DB: env.DB, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    await env.DB.prepare(
      "INSERT INTO metric_events (id, name, client_id, attributes, occurred_at) VALUES (?, 'intake.accepted', 'client-x', '{\"method\":\"ArrivalNumber\"}', ?)",
    ).bind("metric-admin-1", new Date().toISOString()).run();
  });

  it("refuses a request without the Access assertion", async () => {
    const response = await app.request("/api/summary", {}, config);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "access_required" });
  });

  it("refuses an assertion for another application, another issuer or an unknown key", async () => {
    for (const token of [
      await assertion({ aud: "someone-else" }),
      await assertion({ iss: "https://evil.example" }),
      await assertion({ key: (await generateKeyPair("ES256", { extractable: true })).privateKey as CryptoKey }),
    ]) {
      const response = await app.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": token } }, config);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "access_denied" });
    }
  });

  it("returns aggregated counts only, with no identifiers or names", async () => {
    const response = await app.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, config);
    expect(response.status).toBe(200);
    const summary = (await response.json()) as { events: { name: string; count: number }[]; acceptedByMethod: { method: string; count: number }[] };
    expect(summary.events).toContainEqual({ name: "intake.accepted", count: 1 });
    expect(summary.acceptedByMethod).toContainEqual({ method: "ArrivalNumber", count: 1 });
    expect(JSON.stringify(summary)).not.toContain("client-x");
    expect(JSON.stringify(summary)).not.toContain("metric-admin-1");
  });

  it("renders the same figures as a page with a strict content policy", async () => {
    const response = await app.request("/", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, config);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain("intake.accepted");
  });

  it("reports an unreachable key set as an outage, not as a refused visitor", async () => {
    const outage = createAdminApp({ keys: () => Promise.reject(new errors.JWKSTimeout()) });
    const response = await outage.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, config);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "access_unavailable" });
  });

  it("leaves out events older than the window and labels weeks in ISO numbering", async () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO metric_events (id, name, client_id, attributes, occurred_at) VALUES (?, 'window.old', 'client-old', '{}', ?)")
      .bind("metric-window-old", old).run();
    // 1 January 2027 is a Friday in ISO week 2026-W53.
    await env.DB.prepare("INSERT INTO metric_events (id, name, client_id, attributes, occurred_at) VALUES (?, 'week.probe', 'client-week', '{}', ?)")
      .bind("metric-week-probe", "2027-01-01T12:00:00.000Z").run();
    const response = await app.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, config);
    const summary = (await response.json()) as { events: { name: string }[]; activeClientsByWeek: { week: string; clients: number }[] };
    expect(summary.events.map((event) => event.name)).not.toContain("window.old");
    expect(summary.activeClientsByWeek).toContainEqual({ week: "2026-W53", clients: 1 });
  });

  it("counts a document once, from its earliest view, however many members open it", async () => {
    const base = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const published = new Date(base).toISOString();
    await env.DB.prepare("INSERT INTO users (id, google_sub, display_name, created_at) VALUES ('u-view-a', 'sub-view-a', 'A', ?), ('u-view-b', 'sub-view-b', 'B', ?)")
      .bind(published, published).run();
    await env.DB.prepare("INSERT INTO clients (id, code, corporate_name, status, version) VALUES ('client-view', 'VIEW01', 'View Probe Co', 'Active', 1)").run();
    await env.DB.prepare("INSERT INTO upload_batches (id, uploaded_by, created_at) VALUES ('b-view', 'u-view-a', ?)").bind(published).run();
    await env.DB.prepare(
      "INSERT INTO file_records (id, batch_id, direction, client_id, display_name, format, sha256, size_bytes, r2_key, state, received_at, published_at, version) VALUES ('f-view', 'b-view', 'Outbound', 'client-view', 'view-probe-1', 'pdf', ?, 10, 'files/f-view', 'Published', ?, ?, 1)",
    ).bind("a".repeat(64), published, published).run();
    await env.DB.prepare("INSERT INTO file_receipts (id, file_id, user_id, first_viewed_at) VALUES ('r-a', 'f-view', 'u-view-a', ?), ('r-b', 'f-view', 'u-view-b', ?)")
      .bind(new Date(base + 60 * 60 * 1000).toISOString(), new Date(base + 6 * 60 * 60 * 1000).toISOString()).run();
    const response = await app.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, config);
    const summary = (await response.json()) as { publishToFirstViewHours: { count: number; averageHours: number | null } };
    expect(summary.publishToFirstViewHours.count).toBe(1);
    expect(summary.publishToFirstViewHours.averageHours).toBeCloseTo(1, 1);
  });

  it("refuses to run without the Access settings instead of guessing them", async () => {
    const response = await app.request("/api/summary", { headers: { "Cf-Access-Jwt-Assertion": await assertion() } }, { DB: env.DB });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });
});
