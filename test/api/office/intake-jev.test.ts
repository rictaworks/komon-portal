import { beforeAll, describe, expect, it } from "vitest";
import { JEV_ENDPOINT } from "../../../src/app/adapters/jev-classifier";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
const KEY = "tsk-user-secret-key";

function upload(fileName: string, model?: string): FormData {
  const form = new FormData();
  form.set("file", new File([`%PDF-1.7 ${fileName}`], fileName));
  if (model !== undefined) {
    form.set("model", model);
  }
  return form;
}

describe("POST /api/office/batches/{batchId}/files with a Jev key", () => {
  let kit: ApiKit;
  let staff: ApiClient;
  let batchId: string;
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
    batchId = String(batch.id);
  });

  it("sets the type at acceptance when the rules miss and the upload carries a key", async () => {
    const before = calls.length;
    const response = await staff.call("POST", `/api/office/batches/${batchId}/files`, {
      form: upload("Social insurance notice_Taro Yamada.pdf", "jev-1.13.0"),
      headers: { "X-Jev-Key": KEY },
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ outcome: "stored", published: false, file: { docType: { shortCode: "SHAHO" }, typeSource: "Jev", jev: { model: "jev-1.13.0", confidence: 0.96 } } });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("Yamada");
    expect(calls.slice(before).map((call) => call.authorization)).toEqual([`Bearer ${KEY}`]);
    expect(new URL(calls[before]?.url ?? "").origin).toBe(new URL(JEV_ENDPOINT).origin);
  });

  it("leaves the file untyped and makes no call without a key", async () => {
    const before = calls.length;
    const response = await staff.call("POST", `/api/office/batches/${batchId}/files`, { form: upload("Social insurance notice_Hanako Sato.pdf") });
    expect(response.status).toBe(201);
    expect(JSON.parse(await response.text())).toMatchObject({ file: { docType: null, typeSource: null } });
    expect(calls.length).toBe(before);
  });

  it("refuses an alias model before storing the file", async () => {
    const before = calls.length;
    const response = await staff.call("POST", `/api/office/batches/${batchId}/files`, {
      form: upload("Social insurance notice_Keiko Ito.pdf", "jev-latest"),
      headers: { "X-Jev-Key": KEY },
    });
    expect(response.status).toBe(400);
    expect(calls.length).toBe(before);
  });

  it("refuses the whole upload when the provider rejects the key, and stores nothing", async () => {
    const before = (await (await staff.call("GET", "/api/office/files")).json()) as { total: number };
    const total = before.total;
    respond = () => new Response("", { status: 401 });
    const response = await staff.call("POST", `/api/office/batches/${batchId}/files`, {
      form: upload("Social insurance notice_Ken Mori.pdf", "jev-1.13.0"),
      headers: { "X-Jev-Key": KEY },
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "classifier_failed", detail: "authentication_failed" });
    expect(text).not.toContain(KEY);
    const after = (await (await staff.call("GET", "/api/office/files")).json()) as { total: number };
    expect(after.total).toBe(total);
    respond = () => new Response(JSON.stringify({ model: "jev-1.13.0", answers: { q0: { choice: "t0", confidence: 0.96 } } }));
  });
});
