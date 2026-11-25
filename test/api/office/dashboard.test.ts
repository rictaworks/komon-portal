import { beforeAll, describe, expect, it } from "vitest";
import { apiKit, type ApiClient } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
/** The client of the development member. */
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

describe("office dashboard: mis-deliveries and submissions", () => {
  let staff: ApiClient;
  let owner: ApiClient;
  let member: ApiClient;
  const opened: string[] = [];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate();
    const kit = apiKit();
    staff = kit.client();
    owner = kit.client();
    member = kit.client();
    await staff.signIn("staff");
    await owner.signIn("owner");
    await member.signIn("member");
    const out = await json(await staff.call("POST", "/api/office/doc-types", { body: { label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound" } }));
    ids.in = String((await json(await staff.call("POST", "/api/office/doc-types", { body: { label: "Payroll material", shortCode: "KYUYO", direction: "Inbound" } }))).id);
    await staff.call("POST", "/api/office/doc-rules", { body: { docTypeId: out.id, keyword: "shaho" } });
    const batch = await json(await staff.call("POST", "/api/office/batches", { body: { hintClientId: OWN } }));
    // Seven documents are published; the member opens six of them, and all seven are withdrawn.
    for (let index = 0; index < 7; index += 1) {
      const stored = await json(await staff.call("POST", `/api/office/batches/${String(batch.id)}/files`, { form: upload(`shaho_${index}.pdf`, `%PDF-1.7 number ${index}`) }));
      const fileId = String((stored.file as Json).id);
      expect((await json(await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId, version: 1 }] } }))).results).toEqual([expect.objectContaining({ outcome: "published" })]);
      if (index < 6) {
        expect((await member.call("GET", `/api/files/${fileId}/content?mode=view`)).status).toBe(200);
        opened.push(fileId);
      }
      const withdrawn = await staff.call("POST", `/api/office/files/${fileId}/withdraw`, { body: { reason: index === 0 ? "WrongFile" : "WrongClient", next: "NeedsReview", version: 2 } });
      expect(withdrawn.status).toBe(200);
    }
  });

  it("gives the Owner the recent mis-deliveries with the client, the readers and the first view times", async () => {
    const dashboard = await json(await owner.call("GET", "/api/office/dashboard"));
    const incidents = dashboard.incidents as { total: number; truncated: boolean; items: Json[] };
    // The total counts every mis-delivery, although only the five most recent are listed.
    expect(incidents.total).toBe(6);
    expect(incidents.truncated).toBe(true);
    expect(incidents.items).toHaveLength(5);
    for (const item of incidents.items) {
      expect(opened).toContain(item.id);
      expect(item).toMatchObject({ incident: true, client: { id: OWN, code: "DEMO01" } });
      expect(["WrongClient", "WrongFile"]).toContain(item.withdrawReason);
      const readers = item.readers as Json[];
      expect(readers).toHaveLength(1);
      expect(typeof readers[0]?.displayName).toBe("string");
      expect(Number.isNaN(Date.parse(String(readers[0]?.firstViewedAt)))).toBe(false);
    }
  });

  it("does not give mis-delivery data to Staff", async () => {
    const dashboard = await json(await staff.call("GET", "/api/office/dashboard"));
    expect(dashboard.incidents).toBeNull();
    expect(JSON.stringify(dashboard)).not.toContain("firstViewedAt");
    expect((await staff.call("GET", "/api/office/incidents")).status).toBe(403);
    expect((await staff.call("GET", "/api/office/incidents?limit=abc")).status).toBe(403);
  });

  it("lists the incidents with the real total and says when more exist than are shown", async () => {
    const all = await json(await owner.call("GET", "/api/office/incidents"));
    expect(all).toMatchObject({ total: 6, truncated: false });
    expect((all.items as Json[]).map((item) => item.id).sort()).toEqual([...opened].sort());
    const page = await json(await owner.call("GET", "/api/office/incidents?limit=2"));
    expect(page).toMatchObject({ total: 6, truncated: true });
    expect(page.items).toHaveLength(2);
    expect((await owner.call("GET", "/api/office/incidents?limit=0")).status).toBe(400);
  });

  it("lists the submissions waiting for the office with their client, and names the office time zone", async () => {
    const before = await json(await staff.call("GET", "/api/office/dashboard"));
    expect(before).toMatchObject({ submitted: 0, submissions: [], timezone: "Asia/Tokyo" });
    const sent = await json(await member.call("POST", `/api/client/${OWN}/submissions`, { form: upload("payroll.csv", "a,b\n1,2\n", { docTypeId: ids.in ?? "", targetMonth: "2026-10" }) }));
    const submissionId = String((sent.file as Json).id);
    const after = await json(await staff.call("GET", "/api/office/dashboard"));
    expect(after.submitted).toBe(1);
    expect(after.submissions).toEqual([{ id: submissionId, displayName: expect.any(String), receivedAt: expect.any(String), client: expect.objectContaining({ id: OWN, code: "DEMO01" }) }]);
    expect(after.truncated).toMatchObject({ submissions: false });
    // Once the office has opened it, it no longer waits.
    await staff.call("GET", `/api/files/${submissionId}/content?mode=view`);
    expect(await json(await staff.call("GET", "/api/office/dashboard"))).toMatchObject({ submitted: 0, submissions: [] });
  });
});
