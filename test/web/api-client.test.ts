import { describe, expect, it } from "vitest";
import { ApiClient, ApiError, fileContentUrl } from "../../src/app/web/api/client";
import { englishMessages, createTranslator } from "../../src/app/web/i18n";
import { errorText } from "../../src/app/web/components/Notice";
import { landingOf } from "../../src/app/web/session";

interface Call {
  path: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function client(respond: () => Response | Promise<Response>, calls: Call[] = []): ApiClient {
  return new ApiClient((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ?? null });
    return respond();
  }) as typeof fetch);
}

describe("ApiClient", () => {
  it("sends the CSRF token on state-changing requests only", async () => {
    const calls: Call[] = [];
    const api = client(() => new Response("{}"), calls);
    api.setCsrfToken("csrf-1");
    await api.get("/api/me");
    await api.post("/api/office/publish", { items: [] });
    await api.delete("/api/x", { endpoint: "e" });
    expect(calls.map((call) => [call.method, call.headers.get("X-CSRF-Token")])).toEqual([["GET", null], ["POST", "csrf-1"], ["DELETE", "csrf-1"]]);
    expect(calls[1]?.headers.get("Content-Type")).toBe("application/json");
    expect(calls[1]?.body).toBe('{"items":[]}');
  });

  it("uploads a form without forcing a content type", async () => {
    const calls: Call[] = [];
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.pdf");
    await client(() => new Response("{}"), calls).upload("/api/office/batches/b1/files", form);
    expect(calls[0]?.headers.get("Content-Type")).toBeNull();
    expect(calls[0]?.body).toBe(form);
  });

  it("turns error answers into ApiError with code and detail", async () => {
    const api = client(() => new Response(JSON.stringify({ error: "conflict", detail: "stale" }), { status: 409 }));
    await expect(api.post("/api/x")).rejects.toMatchObject({ status: 409, code: "conflict", detail: "stale" });
    await expect(client(() => new Response("<html>", { status: 502 })).get("/api/x")).rejects.toMatchObject({ status: 502, code: "bad_response" });
    const offline = client(() => {
      throw new TypeError("offline");
    });
    await expect(offline.get("/api/x")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("builds file URLs that always go through the Worker", () => {
    expect(fileContentUrl("a/b", "download")).toBe("/api/files/a%2Fb/content?mode=download");
  });
});

describe("errorText", () => {
  const t = createTranslator(englishMessages());

  it("prefers the message for code and detail, then the code, then names the unknown code", () => {
    expect(errorText(t, new ApiError(409, "conflict", "duplicate_content"))).toBe("This client already holds a document with the same content.");
    expect(errorText(t, new ApiError(409, "conflict", "something_new"))).toBe("Someone else changed this at the same time. Reload and try again.");
    expect(errorText(t, new ApiError(418, "teapot", null))).toBe("The request failed (code: teapot).");
    expect(errorText(t, new Error("x"))).toBe("Something went wrong. Reload the page and try again.");
  });
});

describe("landingOf", () => {
  const user = { id: "u", displayName: "X", officeRole: null, officeStatus: null };

  it("sends each kind of user to the right place", () => {
    const member = { clientId: "c1", status: "Active" as const, code: "C1", corporateName: "One", clientStatus: "Active" as const };
    expect(landingOf({ user: { ...user, officeRole: "Staff", officeStatus: "Active" }, memberships: [], csrfToken: "" })).toEqual({ kind: "office" });
    expect(landingOf({ user, memberships: [member], csrfToken: "" })).toEqual({ kind: "client", clientId: "c1" });
    expect(landingOf({ user, memberships: [{ ...member, status: "Pending", clientStatus: null }], csrfToken: "" })).toEqual({ kind: "pending" });
    expect(landingOf({ user: { ...user, officeRole: "Staff", officeStatus: "Pending" }, memberships: [], csrfToken: "" })).toEqual({ kind: "pending" });
    expect(landingOf({ user, memberships: [{ ...member, status: "Revoked", clientStatus: null }], csrfToken: "" })).toEqual({ kind: "none" });
    expect(landingOf({ user, memberships: [{ ...member, clientStatus: null }], csrfToken: "" })).toEqual({ kind: "none" });
  });
});
