import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app/api/app";

describe("GET /api/health", () => {
  it("answers with a stable status code", async () => {
    const response = await createApp().request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers unknown API paths with a not_found code", async () => {
    const response = await createApp().request("/api/does-not-exist", {}, env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("static assets", () => {
  it("are served through the Worker with the security headers", async () => {
    const assets = { fetch: async () => Response.redirect("https://portal.test/index.html", 307) };
    const immutable = { fetch: async () => (await fetch("data:text/html,<p>shell</p>")) };
    for (const binding of [assets, immutable]) {
      const response = await createApp().request("https://portal.test/office/dashboard", {}, { ...env, ASSETS: binding });
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
