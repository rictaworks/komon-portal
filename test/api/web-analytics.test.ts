import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app/api/app";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SHELL = "<!doctype html><html><head><title></title></head><body><div id=\"root\"></div></body></html>";
const BEACON = "https://static.cloudflareinsights.com/beacon.min.js";

function assets(): { fetch: () => Promise<Response> } {
  return {
    fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  };
}

function directive(policy: string, name: string): string {
  const found = policy.split("; ").find((part) => part.startsWith(`${name} `));
  if (found === undefined) {
    throw new Error(`missing directive ${name}`);
  }
  return found;
}

async function request(path: string, vars: Record<string, string>): Promise<Response> {
  return createApp().request(`https://portal.test${path}`, {}, { ...env, ASSETS: assets(), ...vars });
}

describe("Cloudflare Web Analytics", () => {
  describe("without WEB_ANALYTICS_TOKEN", () => {
    it("keeps the policy to Google sign-in and Turnstile, on pages and on the API", async () => {
      for (const vars of [{}, { WEB_ANALYTICS_TOKEN: "" }]) {
        for (const path of ["/office/dashboard", "/api/health"]) {
          const policy = (await request(path, vars)).headers.get("Content-Security-Policy") ?? "";
          expect(directive(policy, "script-src")).toBe("script-src 'self' https://accounts.google.com https://challenges.cloudflare.com");
          expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
          expect(policy).not.toContain("cloudflareinsights");
        }
      }
    });

    it("serves the page without the beacon", async () => {
      const response = await request("/notices", {});
      expect(await response.text()).toBe(SHELL);
    });
  });

  describe("with WEB_ANALYTICS_TOKEN", () => {
    const vars = { WEB_ANALYTICS_TOKEN: TOKEN };

    it("allows only the beacon script and its reporting endpoint in addition", async () => {
      for (const path of ["/office/dashboard", "/api/health"]) {
        const policy = (await request(path, vars)).headers.get("Content-Security-Policy") ?? "";
        expect(directive(policy, "script-src")).toBe(
          "script-src 'self' https://accounts.google.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
        );
        expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://cloudflareinsights.com");
        expect(policy.match(/cloudflareinsights/g)).toHaveLength(2);
        expect(policy).not.toContain("unsafe-inline");
        expect(policy).not.toContain("unsafe-eval");
        expect(policy).toContain("frame-ancestors 'none'");
      }
    });

    it("loads the beacon with the token in the page", async () => {
      const response = await request("/notices", vars);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<script defer src="${BEACON}" data-cf-beacon="{&quot;token&quot;:&quot;${TOKEN}&quot;}"></script></head>`);
      expect(html.match(/<script/g)).toHaveLength(1);
      expect(html).toContain("<div id=\"root\"></div>");
    });

    it("sends pages in full, so a copy kept from before the token was set is replaced", async () => {
      const seen: Request[] = [];
      const revalidating = {
        fetch: async (asked: Request) => {
          seen.push(asked);
          return asked.headers.has("If-None-Match")
            ? new Response(null, { status: 304, headers: { ETag: "\"shell\"" } })
            : new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8", ETag: "\"shell\"" } });
        },
      };
      const headers = { Accept: "text/html,application/xhtml+xml", "If-None-Match": "\"shell\"" };
      const on = await createApp().request("https://portal.test/notices", { headers }, { ...env, ASSETS: revalidating, ...vars });
      expect(on.status).toBe(200);
      expect(await on.text()).toContain(BEACON);
      expect(on.headers.get("ETag")).toBeNull();
      const script = await createApp().request("https://portal.test/assets/app.js", { headers: { "If-None-Match": "\"shell\"" } }, { ...env, ASSETS: revalidating, ...vars });
      expect(script.status).toBe(304);
      const off = await createApp().request("https://portal.test/notices", { headers }, { ...env, ASSETS: revalidating });
      expect(off.status).toBe(304);
      expect(seen.map((asked) => asked.headers.has("If-None-Match"))).toEqual([false, true, true]);
    });

    it("leaves responses that are not pages as they are", async () => {
      const script = { fetch: async () => new Response("export {};", { headers: { "Content-Type": "text/javascript" } }) };
      const response = await createApp().request("https://portal.test/assets/app.js", {}, { ...env, ASSETS: script, ...vars });
      expect(await response.text()).toBe("export {};");
      const api = await request("/api/health", vars);
      expect(await api.json()).toEqual({ status: "ok" });
    });

    it("refuses a token that is not letters and digits, loudly and without the beacon", async () => {
      for (const path of ["/notices", "/api/health"]) {
        const response = await request(path, { WEB_ANALYTICS_TOKEN: "\"><script>" });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "internal_error" });
        expect(response.headers.get("Content-Security-Policy")).not.toContain("cloudflareinsights");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      }
    });
  });
});
