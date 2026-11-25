import { beforeAll, describe, expect, it } from "vitest";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
/** The client of the development member. */
const OWN = "dev-client";
/** One minute, as a part of a day: short enough for the sessions to stay valid. */
const MINUTE = 1 / (24 * 60);

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function upload(name: string, content: string): FormData {
  const form = new FormData();
  form.set("file", new File([content], name));
  return form;
}

describe("incidents: a mis-delivery is reported as it was when the file was withdrawn", () => {
  let kit: ApiKit;
  let staff: ApiClient;
  let owner: ApiClient;
  let member: ApiClient;
  let batchId: string;

  /** Publishes a new document to the member's client; the member opens it. */
  async function publishAndOpen(name: string): Promise<string> {
    const stored = await json(await staff.call("POST", `/api/office/batches/${batchId}/files`, { form: upload(name, `%PDF-1.7 ${name}`) }));
    const fileId = String((stored.file as Json).id);
    expect((await json(await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId, version: 1 }] } }))).results).toEqual([expect.objectContaining({ outcome: "published" })]);
    expect((await member.call("POST", `/api/files/${fileId}/open`, { body: { mode: "view" } })).status).toBe(200);
    return fileId;
  }

  async function withdrawAsWrongClient(fileId: string): Promise<void> {
    expect((await staff.call("POST", `/api/office/files/${fileId}/withdraw`, { body: { reason: "WrongClient", next: "NeedsReview", version: 2 } })).status).toBe(200);
  }

  beforeAll(async () => {
    await migrate();
    kit = apiKit();
    staff = kit.client();
    owner = kit.client();
    member = kit.client();
    await staff.signIn("staff");
    await owner.signIn("owner");
    await member.signIn("member");
    batchId = String((await json(await staff.call("POST", "/api/office/batches", { body: { hintClientId: OWN } }))).id);
  });

  it("names the client that wrongly had the document and only its readers, after the document went to the right client", async () => {
    const fileId = await publishAndOpen("notice_a.pdf");
    const withdrawnAt = kit.clock.now().toISOString();
    await withdrawAsWrongClient(fileId);
    // The office corrects the mistake: the document is assigned to the right client and published again.
    kit.clock.advanceDays(MINUTE);
    const right = await json(await staff.call("POST", "/api/office/clients", { body: { code: "RIGHT1", corporateName: "Right Client" } }));
    expect((await staff.call("POST", `/api/office/files/${fileId}/assign`, { body: { clientId: right.id, caseId: null, confirmed: true, version: 4 } })).status).toBe(200);
    expect((await json(await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId, version: 5 }] } }))).results).toEqual([expect.objectContaining({ outcome: "published", clientId: right.id })]);

    for (const path of ["/api/office/dashboard", "/api/office/incidents"]) {
      const answer = await json(await owner.call("GET", path));
      const list = (path.endsWith("dashboard") ? answer.incidents : answer) as { total: number; items: Json[] };
      expect(list.total).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ id: fileId, state: "Published", client: { id: OWN, code: "DEMO01" }, withdrawReason: "WrongClient", withdrawnAt });
      expect(list.items[0]?.readers).toHaveLength(1);
    }
  });

  it("lists the document withdrawn last first, although it was taken in before the others", async () => {
    // Taken in now, withdrawn after the next one.
    const early = await publishAndOpen("notice_b.pdf");
    kit.clock.advanceDays(MINUTE);
    const late = await publishAndOpen("notice_c.pdf");
    await withdrawAsWrongClient(late);
    kit.clock.advanceDays(MINUTE);
    await withdrawAsWrongClient(early);
    const all = await json(await owner.call("GET", "/api/office/incidents"));
    expect((all.items as Json[]).slice(0, 2).map((item) => item.id)).toEqual([early, late]);
    const recent = await json(await owner.call("GET", "/api/office/incidents?limit=1"));
    expect(recent).toMatchObject({ total: 3, truncated: true });
    expect((recent.items as Json[]).map((item) => item.id)).toEqual([early]);
  });
});
