import { beforeAll, describe, expect, it } from "vitest";
import { apiKit, type ApiClient } from "../../support/api";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function idsOf(body: Json): unknown[] {
  return (body.items as Json[]).map((item) => item.id);
}

describe("office cases API", () => {
  let staff: ApiClient;
  let member: ApiClient;
  let staffUserId: string;
  const ids: Record<string, string> = {};

  async function register(body: Json): Promise<Json> {
    const response = await staff.call("POST", "/api/office/cases", { body });
    expect(response.status).toBe(201);
    return json(response);
  }

  beforeAll(async () => {
    await migrate();
    const kit = apiKit();
    staff = kit.client();
    member = kit.client();
    staffUserId = (await staff.signIn("staff")).userId;
    await member.signIn("member");
    ids.c1 = String((await json(await staff.call("POST", "/api/office/clients", { body: { code: "C0701", corporateName: "Hinode Logistics" } }))).id);
    ids.c2 = String((await json(await staff.call("POST", "/api/office/clients", { body: { code: "C0702", corporateName: "Kita Seimitsu" } }))).id);
    ids.procedure = String((await json(await staff.call("POST", "/api/office/case-types", { body: { kind: "Procedure", label: "Social insurance" } }))).id);
    ids.other = String((await json(await staff.call("POST", "/api/office/case-types", { body: { kind: "Other", label: "Consultation" } }))).id);
  });

  it("refuses a submission without the version and accepts it with the version", async () => {
    const created = await register({ clientId: ids.c1, caseTypeId: ids.procedure, targetMonth: "2026-11", referenceCode: "SHAHO-2611-01" });
    ids.submitted = String(created.id);
    const path = `/api/office/cases/${ids.submitted}/submit`;
    const withoutVersion = await staff.call("POST", path, { body: { submittedOn: "2026-11-20", arrivalNumbers: [] } });
    expect(withoutVersion.status).toBe(400);
    expect(await withoutVersion.json()).toEqual({ error: "invalid_input", detail: "version" });
    expect((await json(await staff.call("GET", `/api/office/cases/${ids.submitted}`))).state).toBe("Open");
    const withVersion = await staff.call("POST", path, { body: { submittedOn: "2026-11-20", arrivalNumbers: ["202611200912345678"], version: created.version } });
    expect(withVersion.status).toBe(200);
    expect(await json(withVersion)).toMatchObject({ state: "Submitted", submittedOn: "2026-11-20", arrivalNumbers: ["202611200912345678"], version: 2 });
  });

  it("registers a case with an assignee chosen from the active office users", async () => {
    const listed = await json(await staff.call("GET", "/api/office/cases"));
    const assignees = listed.assignees as Json[];
    expect(assignees.map((assignee) => assignee.id)).toContain(staffUserId);
    expect(Object.keys(assignees[0] ?? {}).sort()).toEqual(["displayName", "id"]);
    const created = await register({ clientId: ids.c2, caseTypeId: ids.other, targetMonth: "2026-11", referenceCode: "SOUDAN-2611-01", assigneeId: staffUserId, dueOn: "2026-12-10" });
    ids.assigned = String(created.id);
    expect(created.assignee).toMatchObject({ id: staffUserId });
    const again = await json(await staff.call("GET", `/api/office/cases?clientId=${ids.c2}`));
    expect((again.items as Json[])[0]).toMatchObject({ id: ids.assigned, referenceCode: "SOUDAN-2611-01", dueOn: "2026-12-10", submittedOn: null, assignee: { id: staffUserId } });
    const unknown = await staff.call("POST", "/api/office/cases", { body: { clientId: ids.c2, caseTypeId: ids.other, targetMonth: "2026-11", referenceCode: "SOUDAN-2611-02", assigneeId: "no-such-user" } });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "invalid_input", detail: "assignee" });
  });

  it("narrows the list by client code, kind and state", async () => {
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?clientCode=C0701")))).toEqual([ids.submitted]);
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?clientCode=C0702&kind=Other")))).toEqual([ids.assigned]);
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?clientCode=C0702&kind=Procedure")))).toEqual([]);
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?clientCode=C9999")))).toEqual([]);
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?kind=Other&states=Open")))).toEqual([ids.assigned]);
    const mismatch = await staff.call("GET", `/api/office/cases?clientCode=C0701&clientId=${ids.c2}`);
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: "invalid_input", detail: "clientCode" });
    expect((await member.call("GET", "/api/office/cases?clientCode=C0701")).status).toBe(404);
  });

  it("says whether more cases match than the page holds", async () => {
    const all = await json(await staff.call("GET", "/api/office/cases"));
    const total = (all.items as Json[]).length;
    expect(total).toBeGreaterThan(1);
    expect(all.truncated).toBe(false);
    const exact = await json(await staff.call("GET", `/api/office/cases?limit=${total}`));
    expect(exact.truncated).toBe(false);
    const short = await json(await staff.call("GET", `/api/office/cases?limit=${total - 1}`));
    expect((short.items as Json[]).length).toBe(total - 1);
    expect(short.truncated).toBe(true);
    expect(idsOf(short)).toEqual(idsOf(all).slice(0, total - 1));
    const rest = await json(await staff.call("GET", `/api/office/cases?limit=${total - 1}&offset=${total - 1}`));
    expect(idsOf(rest)).toEqual(idsOf(all).slice(total - 1));
    expect(rest.truncated).toBe(false);
    expect((await json(await staff.call("GET", "/api/office/cases?clientCode=C9999"))).truncated).toBe(false);
    expect((await staff.call("GET", "/api/office/cases?limit=200")).status).toBe(200);
  });

  it("closes a case without documents from Open and from Submitted", async () => {
    const open = await staff.call("POST", `/api/office/cases/${ids.assigned}/close`, { body: { version: 1 } });
    expect(await json(open)).toMatchObject({ state: "Closed", version: 2 });
    const submitted = await staff.call("POST", `/api/office/cases/${ids.submitted}/close`, { body: { version: 2 } });
    expect(await json(submitted)).toMatchObject({ state: "Closed", version: 3 });
    const again = await staff.call("POST", `/api/office/cases/${ids.submitted}/close`, { body: { version: 3 } });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: "invalid_state", detail: "case_terminal" });
    const openStates = "Open,Submitted,MaterialsReceived,DocumentReceived,Delivered,Confirmed";
    expect(idsOf(await json(await staff.call("GET", `/api/office/cases?states=${openStates}`)))).toEqual([]);
    expect(idsOf(await json(await staff.call("GET", "/api/office/cases?states=Closed"))).sort()).toEqual([ids.assigned, ids.submitted].sort());
  });
});
