import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../../src/app/adapters/d1/d1-repository";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
const OWN = "dev-client";

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function upload(name: string, content: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("file", new File([content], name));
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

describe("client API and file delivery", () => {
  let kit: ApiKit;
  let staff: ApiClient;
  let member: ApiClient;
  let repository: D1Repository;
  const ids: Record<string, string> = {};

  async function intake(hintClientId: string, name: string, content: string): Promise<Json> {
    const batch = await json(await staff.call("POST", "/api/office/batches", { body: { hintClientId } }));
    const stored = await json(await staff.call("POST", `/api/office/batches/${String(batch.id)}/files`, { form: upload(name, content) }));
    return stored.file as Json;
  }

  beforeAll(async () => {
    repository = new D1Repository(await migrate());
    kit = apiKit();
    staff = kit.client();
    member = kit.client();
    await member.signIn("member");
    await staff.signIn("staff");
    ids.other = String((await json(await staff.call("POST", "/api/office/clients", { body: { code: "C0142", corporateName: "Kita Seimitsu" } }))).id);
    ids.out = String((await json(await staff.call("POST", "/api/office/doc-types", { body: { label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound" } }))).id);
    ids.in = String((await json(await staff.call("POST", "/api/office/doc-types", { body: { label: "Payroll material", shortCode: "KYUYO", direction: "Inbound" } }))).id);
    await staff.call("POST", "/api/office/doc-rules", { body: { docTypeId: ids.out, keyword: "shaho" } });
    ids.payrollType = String((await json(await staff.call("POST", "/api/office/case-types", { body: { kind: "Payroll", label: "Payroll" } }))).id);
    ids.payroll = String((await json(await staff.call("POST", "/api/office/cases", { body: { clientId: OWN, caseTypeId: ids.payrollType, targetMonth: "2026-11", referenceCode: "KYUYO-2611-01" } }))).id);

    ids.published = String((await intake(OWN, "shaho_one.pdf", "%PDF-1.7 published")).id);
    ids.staged = String((await intake(OWN, "shaho_two.pdf", "%PDF-1.7 staged")).id);
    ids.foreign = String((await intake(ids.other, "shaho_three.pdf", "%PDF-1.7 foreign")).id);
    await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: ids.published, version: 1 }, { fileId: ids.foreign, version: 1 }] } });
  });

  it("shows a member only the published documents of their own client", async () => {
    const documents = await json(await member.call("GET", `/api/client/${OWN}/documents`));
    const items = documents.items as Json[];
    expect(items.map((item) => item.id)).toEqual([ids.published]);
    expect(items[0]).toMatchObject({ displayName: "DEMO01_SHAHO_20261124_01", docType: { shortCode: "SHAHO" }, opened: false, format: "pdf" });
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(["displayName", "docType", "format", "id", "opened", "publishedAt", "sizeBytes", "targetMonth"]);
    const home = await json(await member.call("GET", `/api/client/${OWN}/home`));
    expect((home.unread as Json[]).map((item) => item.id)).toEqual([ids.published]);
    expect(home.cases).toEqual([{ id: ids.payroll, kind: "Payroll", typeLabel: "Payroll", targetMonth: "2026-11", state: "Open" }]);
    expect(((await json(await member.call("GET", `/api/client/${OWN}/documents?docTypeId=nope`))).items as Json[])).toEqual([]);
  });

  it("answers not found for another client's ID, an unknown ID and for staff", async () => {
    for (const clientId of [ids.other, "does-not-exist"]) {
      for (const path of ["home", "documents", "submissions", "doc-types"]) {
        const response = await member.call("GET", `/api/client/${clientId}/${path}`);
        expect([clientId, path, response.status]).toEqual([clientId, path, 404]);
        expect(await response.json()).toEqual({ error: "not_found", detail: "client" });
      }
    }
    expect((await staff.call("GET", `/api/client/${OWN}/documents`)).status).toBe(404);
    expect((await kit.client().call("GET", `/api/client/${OWN}/documents`)).status).toBe(401);
  });

  it("delivers a body as an attachment with a generated name and no caching", async () => {
    const response = await member.call("GET", `/api/files/${ids.published}/content?mode=download`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="DEMO01_SHAHO_20261124_01.pdf"');
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("%PDF-1.7 published");
  });

  it("refuses a cross-site navigation to a file, which would otherwise record an open", async () => {
    const response = await member.call("GET", `/api/files/${ids.published}/content`, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "bad_origin" });
    const same = await member.call("GET", `/api/files/${ids.published}/content`, { headers: { "Sec-Fetch-Site": "same-origin" } });
    expect(same.status).toBe(200);
  });

  it("records the first open of a member once and never a staff view", async () => {
    await member.call("GET", `/api/files/${ids.published}/content`);
    await staff.call("GET", `/api/files/${ids.published}/content`);
    const receipts = await repository.receipts.listByFile(ids.published ?? "");
    expect(receipts).toHaveLength(1);
    const documents = await json(await member.call("GET", `/api/client/${OWN}/documents`));
    expect((documents.items as Json[])[0]).toMatchObject({ opened: true });
    expect(((await json(await member.call("GET", `/api/client/${OWN}/home`))).unread as Json[])).toEqual([]);
    const shelf = await json(await staff.call("GET", `/api/office/files/${ids.published}`));
    expect(shelf.readers).toEqual([expect.objectContaining({ displayName: "Dev member" })]);
  });

  it("refuses files that are not published, belong to another client or do not exist, all alike", async () => {
    for (const fileId of [ids.staged, ids.foreign, "missing"]) {
      const response = await member.call("GET", `/api/files/${fileId}/content`);
      expect([fileId, response.status]).toEqual([fileId, 404]);
      expect(await response.json()).toEqual({ error: "not_found", detail: "file" });
    }
    expect((await member.call("GET", `/api/files/${ids.published}/content?mode=peek`)).status).toBe(400);
    expect((await kit.client().call("GET", `/api/files/${ids.published}/content`)).status).toBe(401);
    expect((await staff.call("GET", `/api/files/${ids.staged}/content`)).status).toBe(200);
  });

  it("serves text formats as opaque bytes so they cannot run in the browser", async () => {
    const file = await intake(OWN, "note.xml", "<script>alert(1)</script>");
    await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: file.id, version: 1 }] } });
    const response = await member.call("GET", `/api/files/${String(file.id)}/content`);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="DEMO01_UNCLASSIFIED_20261124_\d+\.xml"$/);
  });

  it("lets a member send a file to their own client only", async () => {
    const types = await json(await member.call("GET", `/api/client/${OWN}/doc-types`));
    expect((types.inbound as Json[]).map((type) => type.shortCode)).toEqual(["KYUYO"]);
    const sent = await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("payroll Taro.csv", "a,b\n1,2\n", { docTypeId: ids.in ?? "", targetMonth: "2026-11" }) });
    expect(sent.status).toBe(201);
    const text = await sent.text();
    expect(text).not.toContain("Taro");
    const body = JSON.parse(text) as { outcome: string; file: Json };
    ids.submission = String(body.file.id);
    expect(body).toMatchObject({ outcome: "stored", file: { state: "Submitted", targetMonth: "2026-11", docType: { shortCode: "KYUYO" } } });
    expect((await json(await staff.call("GET", `/api/office/cases/${ids.payroll}`))).state).toBe("MaterialsReceived");

    const elsewhere = await member.call("POST", `/api/client/${ids.other}/submissions`, { form: upload("x.csv", "x,y\n", { docTypeId: ids.in ?? "", targetMonth: "2026-11" }) });
    expect(elsewhere.status).toBe(404);
    const rejected = await json(await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("x.exe", "MZ", { docTypeId: ids.in ?? "", targetMonth: "2026-11" }) }));
    expect(rejected).toEqual({ outcome: "rejected", reason: "UnsupportedFormat" });
    const incomplete = await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("y.csv", "x,y\n") });
    expect(incomplete.status).toBe(400);
    const wrongType = await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("z.csv", "p,q\n", { docTypeId: ids.out ?? "", targetMonth: "2026-11" }) });
    expect(wrongType.status).toBe(400);
  });

  it("shows the office's confirmation and allows cancelling only before it", async () => {
    const second = await json(await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("more.csv", "c,d\n3,4\n", { docTypeId: ids.in ?? "", targetMonth: "2026-10" }) }));
    const secondId = String((second.file as Json).id);
    const before = (await json(await member.call("GET", `/api/client/${OWN}/submissions`))).items as Json[];
    expect(before.map((item) => [item.id, item.state, item.canCancel])).toEqual(expect.arrayContaining([[ids.submission, "Submitted", true], [secondId, "Submitted", true]]));

    await staff.call("GET", `/api/files/${ids.submission}/content?mode=view`);
    const after = (await json(await member.call("GET", `/api/client/${OWN}/submissions`))).items as Json[];
    expect(after.find((item) => item.id === ids.submission)).toMatchObject({ state: "Acknowledged", canCancel: false });
    const late = await member.call("POST", `/api/client/${OWN}/submissions/${ids.submission}/cancel`, { body: { version: 2 } });
    expect(late.status).toBe(422);
    const cancelled = await member.call("POST", `/api/client/${OWN}/submissions/${secondId}/cancel`, { body: { version: 1 } });
    expect(await cancelled.json()).toEqual({ id: secondId, state: "Trashed" });
    const wrongClient = await member.call("POST", `/api/client/${OWN}/submissions/${ids.foreign}/cancel`, { body: { version: 1 } });
    expect(wrongClient.status).toBe(404);
  });

  it("refuses a withdrawn file even from a page that was already open", async () => {
    const before = await json(await staff.call("GET", `/api/office/files/${ids.published}`));
    await staff.call("POST", `/api/office/files/${ids.published}/withdraw`, { body: { reason: "WrongFile", next: "NeedsReview", version: before.version } });
    expect((await member.call("GET", `/api/files/${ids.published}/content`)).status).toBe(404);
    expect(((await json(await member.call("GET", `/api/client/${OWN}/documents`))).items as Json[]).map((item) => item.id)).not.toContain(ids.published);
    expect((await json(await staff.call("GET", `/api/office/files/${ids.published}`))).incident).toBe(true);
  });

  it("follows the membership and client status on every request", async () => {
    const memberships = await env.DB.prepare("SELECT id, user_id FROM memberships WHERE client_id = ?").bind(OWN).all<{ id: string; user_id: string }>();
    const membershipId = memberships.results[0]?.id ?? "";
    const setStatus = (status: string) => env.DB.prepare("UPDATE memberships SET status = ? WHERE id = ?").bind(status, membershipId).run();
    const setClient = (status: string) => env.DB.prepare("UPDATE clients SET status = ? WHERE id = ?").bind(status, OWN).run();
    const reach = async () => (await member.call("GET", `/api/client/${OWN}/documents`)).status;
    const send = async () =>
      (await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("s.csv", `r,${Math.random()}\n`, { docTypeId: ids.in ?? "", targetMonth: "2026-11" }) })).status;

    await setStatus("Pending");
    expect(await reach()).toBe(404);
    await setStatus("Rejected");
    expect(await reach()).toBe(404);
    await setStatus("Revoked");
    expect(await reach()).toBe(404);
    await setStatus("Active");
    expect(await reach()).toBe(200);

    await setClient("Archived");
    expect(await reach()).toBe(200);
    expect(await send()).toBe(404);
    await setClient("Closed");
    expect(await reach()).toBe(404);
    expect(await send()).toBe(404);
    await setClient("Active");
    expect(await send()).toBe(201);
  });
});
