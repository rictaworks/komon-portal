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
