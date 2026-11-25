import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { JEV_ENDPOINT } from "../../../src/app/adapters/jev-classifier";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
const KEY = "tsk-user-secret-key";

describe("POST /api/office/classify", () => {
  let kit: ApiKit;
  let staff: ApiClient;
  let fileId: string;
  const calls: { url: string; authorization: string | null }[] = [];
  let respond: () => Response = () => new Response(JSON.stringify({ model: "jev-1.13.0", answers: { q0: { choice: "t0", confidence: 0.96 } } }));

  beforeAll(async () => {
    await migrate();
    kit = apiKit({
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
        return respond();
      }) as typeof fetch,
    });
    staff = kit.client();
    await staff.signIn("staff");
    const client = (await (await staff.call("POST", "/api/office/clients", { body: { code: "C0031", corporateName: "Hinode" } })).json()) as Json;
    await staff.call("POST", "/api/office/doc-types", { body: { label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound" } });
    const batch = (await (await staff.call("POST", "/api/office/batches", { body: { hintClientId: client.id } })).json()) as Json;
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 x"], "hyojun kettei.pdf"));
    const stored = (await (await staff.call("POST", `/api/office/batches/${String(batch.id)}/files`, { form })).json()) as { file: Json };
    fileId = String(stored.file.id);
  });

  it("reports a provider error as it is and leaves the file unclassified", async () => {
    respond = () => new Response("", { status: 401 });
    const response = await staff.call("POST", "/api/office/classify", { body: { model: "jev-1.13.0", items: [{ fileId, fileName: "hyojun kettei.pdf" }] }, headers: { "X-Jev-Key": KEY } });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "classifier_failed", detail: "authentication_failed" });
    expect(text).not.toContain(KEY);
    const file = (await (await staff.call("GET", `/api/office/files/${fileId}`)).json()) as Json;
    expect(file).toMatchObject({ docType: null, state: "Staged" });
  });

  it("refuses alias model names and a missing key before calling the provider", async () => {
    const before = calls.length;
    const alias = await staff.call("POST", "/api/office/classify", { body: { model: "jev-latest", items: [{ fileId, fileName: "a.pdf" }] }, headers: { "X-Jev-Key": KEY } });
    expect(alias.status).toBe(400);
    expect(await alias.json()).toEqual({ error: "invalid_input", detail: "model" });
    const noKey = await staff.call("POST", "/api/office/classify", { body: { model: "jev-1.13.0", items: [{ fileId, fileName: "a.pdf" }] } });
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toEqual({ error: "invalid_input", detail: "credential" });
    expect(calls.length).toBe(before);
  });

  it("classifies with the user's key, which reaches only the provider and is stored nowhere", async () => {
    respond = () => new Response(JSON.stringify({ model: "jev-1.13.0", answers: { q0: { choice: "t0", confidence: 0.96 } } }));
    const response = await staff.call("POST", "/api/office/classify", { body: { model: "jev-1.13.0", items: [{ fileId, fileName: "hyojun kettei.pdf" }] }, headers: { "X-Jev-Key": KEY } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ model: "jev-1.13.0", results: [{ fileId, outcome: "classified", confidence: 0.96 }] });
    expect(text).not.toContain(KEY);
    expect(calls.at(-1)).toEqual({ url: JEV_ENDPOINT, authorization: `Bearer ${KEY}` });
    expect(new Set(calls.map((call) => new URL(call.url).host))).toEqual(new Set(["api.typesafe.ai"]));
    const file = (await (await staff.call("GET", `/api/office/files/${fileId}`)).json()) as Json;
    expect(file).toMatchObject({ docType: { shortCode: "SHAHO" }, typeSource: "Jev", jev: { model: "jev-1.13.0", confidence: 0.96 } });

    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>();
    for (const table of tables.results) {
      const rows = await env.DB.prepare(`SELECT * FROM ${table.name}`).all();
      expect(JSON.stringify(rows.results)).not.toContain(KEY);
    }
  });

  it("is hidden from client members", async () => {
    const member = kit.client();
    await member.signIn("member");
    const response = await member.call("POST", "/api/office/classify", { body: { model: "jev-1.13.0", items: [{ fileId, fileName: "a.pdf" }] }, headers: { "X-Jev-Key": KEY } });
    expect(response.status).toBe(404);
  });
});
