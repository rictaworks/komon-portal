import { beforeAll, describe, expect, it } from "vitest";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { migrate } from "../../support/d1";

const ARRIVAL = "202611240912345678";
const CORPORATE_NUMBER = "7000012050002";

type Json = Record<string, unknown>;

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function upload(name: string, content: string): FormData {
  const form = new FormData();
  form.set("file", new File([content], name));
  return form;
}

describe("office API", () => {
  let kit: ApiKit;
  let staff: ApiClient;
  let owner: ApiClient;
  let member: ApiClient;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate();
    kit = apiKit();
    staff = kit.client();
    owner = kit.client();
    member = kit.client();
    await staff.signIn("staff");
    await owner.signIn("owner");
    await member.signIn("member");
  });

  it("requires a session, and hides everything from client members", async () => {
    const anonymous = await kit.client().call("GET", "/api/office/clients");
    expect(anonymous.status).toBe(401);
    for (const [method, path, body] of [
      ["GET", "/api/office/clients", undefined],
      ["GET", "/api/office/files", undefined],
      ["GET", "/api/office/dashboard", undefined],
      ["GET", "/api/office/audit", undefined],
      ["POST", "/api/office/clients", { code: "X1", corporateName: "X" }],
      ["POST", "/api/office/publish", { items: [] }],
    ] as const) {
      const response = await member.call(method, path, body === undefined ? {} : { body });
      expect([path, response.status]).toEqual([path, 404]);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("registers master data", async () => {
    const client = await staff.call("POST", "/api/office/clients", { body: { code: "C0031", corporateName: "Hinode Logistics", corporateNumber: CORPORATE_NUMBER } });
    expect(client.status).toBe(201);
    ids.c1 = String((await json(client)).id);
    ids.c2 = String((await json(await staff.call("POST", "/api/office/clients", { body: { code: "C0142", corporateName: "Kita Seimitsu" } }))).id);
    const duplicate = await staff.call("POST", "/api/office/clients", { body: { code: "C0031", corporateName: "Again" } });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "conflict", detail: "client_code_taken" });
    const invalid = await staff.call("POST", "/api/office/clients", { body: { code: "C0500", corporateName: "Bad", corporateNumber: "1234567890123" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_input", detail: "corporate_number" });

    ids.d1 = String((await json(await staff.call("POST", "/api/office/doc-types", { body: { label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound" } }))).id);
    expect((await staff.call("POST", "/api/office/doc-rules", { body: { docTypeId: ids.d1, keyword: "shaho" } })).status).toBe(201);
    ids.t1 = String((await json(await staff.call("POST", "/api/office/case-types", { body: { kind: "Procedure", label: "Social insurance" } }))).id);

    const listed = await json(await staff.call("GET", "/api/office/clients?query=C0031"));
    expect((listed.items as Json[]).map((item) => item.code)).toEqual(["C0031"]);
    const settings = await json(await staff.call("GET", "/api/office/settings"));
    expect(settings.canEditOffice).toBe(false);
    expect((settings.docRules as Json[]).map((rule) => rule.keyword)).toContain("shaho");
  });

  it("keeps Owner-only actions from staff", async () => {
    const settings = await json(await owner.call("GET", "/api/office/settings"));
    const office = settings.office as Json;
    const change = { ...office, autoPublishEnabled: false, jevThreshold: 0.95 };
    for (const [method, path, body] of [
      ["PUT", "/api/office/settings/office", change],
      ["GET", "/api/office/audit", undefined],
      ["GET", "/api/office/staff", undefined],
      ["POST", "/api/office/staff/invitations", { role: "Staff" }],
      ["GET", "/api/office/incidents", undefined],
    ] as const) {
      const response = await staff.call(method, path, body === undefined ? {} : { body });
      expect([path, response.status]).toEqual([path, 403]);
      expect((await json(response)).error).toBe("forbidden");
    }
    const updated = await owner.call("PUT", "/api/office/settings/office", { body: change });
    expect(updated.status).toBe(200);
    expect(await json(updated)).toMatchObject({ jevThreshold: 0.95, version: Number(office.version) + 1 });
    const stale = await owner.call("PUT", "/api/office/settings/office", { body: change });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "conflict", detail: "stale" });
    const tooLow = await owner.call("PUT", "/api/office/settings/office", { body: { ...change, jevThreshold: 0.5, version: Number(office.version) + 1 } });
    expect(tooLow.status).toBe(400);
    expect((await json(await owner.call("GET", "/api/office/staff"))).members).toEqual(expect.arrayContaining([expect.objectContaining({ officeRole: "Owner" })]));
    const invited = await json(await owner.call("POST", "/api/office/staff/invitations", { body: { role: "Staff" } }));
    expect(String(invited.code).length).toBeGreaterThanOrEqual(32);
    expect(invited).not.toHaveProperty("codeHash");
  });

  it("registers a case and records the submission", async () => {
    const created = await staff.call("POST", "/api/office/cases", { body: { clientId: ids.c1, caseTypeId: ids.t1, targetMonth: "2026-11", referenceCode: "SHAHO-2611-01", dueOn: "2026-11-30" } });
    expect(created.status).toBe(201);
    const record = await json(created);
    ids.k1 = String(record.id);
    expect(record).toMatchObject({ state: "Open", sequence: 1, client: { code: "C0031" }, caseType: { kind: "Procedure" } });
    const freeText = await staff.call("POST", "/api/office/cases", { body: { clientId: ids.c1, caseTypeId: ids.t1, targetMonth: "2026-11", referenceCode: "Taro Yamada" } });
    expect(freeText.status).toBe(400);
    const submitted = await staff.call("POST", `/api/office/cases/${ids.k1}/submit`, { body: { submittedOn: "2026-11-20", arrivalNumbers: [ARRIVAL], version: 1 } });
    expect(await json(submitted)).toMatchObject({ state: "Submitted", arrivalNumbers: [ARRIVAL], retrieval: { level: "ok", daysLeft: 86 }, version: 2 });
    const listed = await json(await staff.call("GET", `/api/office/cases?clientId=${ids.c1}&states=Submitted`));
    expect((listed.items as Json[]).map((item) => item.id)).toEqual([ids.k1]);
    expect((await staff.call("GET", "/api/office/cases?states=Nope")).status).toBe(400);
  });

  it("takes files in one by one and reports each result with its reason", async () => {
    const batch = await json(await staff.call("POST", "/api/office/batches", { body: {} }));
    ids.batch = String(batch.id);
    const stored = await staff.call("POST", `/api/office/batches/${ids.batch}/files`, { form: upload(`${ARRIVAL}_shaho_Taro Yamada.pdf`, "%PDF-1.7 one") });
    expect(stored.status).toBe(201);
    const storedText = await stored.text();
    expect(storedText).not.toContain("Yamada");
    const storedBody = JSON.parse(storedText) as { outcome: string; file: Json };
    ids.f1 = String(storedBody.file.id);
    expect(storedBody).toMatchObject({ outcome: "stored", published: false });
    expect(storedBody.file).toMatchObject({
      state: "Staged", displayName: "C0031_SHAHO_20261124_01", resolutionMethod: "ArrivalNumber", caseId: ids.k1,
      client: { code: "C0031" }, docType: { shortCode: "SHAHO" }, typeSource: "Rule", version: 1,
    });

    const rejected = await json(await staff.call("POST", `/api/office/batches/${ids.batch}/files`, { form: upload("a.exe", "MZ") }));
    expect(rejected).toEqual({ outcome: "rejected", reason: "UnsupportedFormat" });
    const duplicate = await json(await staff.call("POST", `/api/office/batches/${ids.batch}/files`, { form: upload("C0031_again.pdf", "%PDF-1.7 one") }));
    expect(duplicate).toMatchObject({ outcome: "duplicate", existing: { id: ids.f1, displayName: "C0031_SHAHO_20261124_01" } });
    const review = await json(await staff.call("POST", `/api/office/batches/${ids.batch}/files`, { form: upload(`C0142_${ARRIVAL}.pdf`, "%PDF-1.7 two") }));
    ids.f2 = String((review.file as Json).id);
    expect(review.file).toMatchObject({
      state: "NeedsReview", reviewReason: "ConflictingKeys", client: null,
      evidence: [{ kind: "ArrivalNumber", client: { code: "C0031" } }, { kind: "ClientCode", client: { code: "C0142" } }],
    });
    const noFile = await staff.call("POST", `/api/office/batches/${ids.batch}/files`, { form: new FormData() });
    expect(noFile.status).toBe(400);
    expect((await staff.call("POST", "/api/office/batches/unknown/files", { form: upload("a.pdf", "%PDF-") })).status).toBe(404);
  });

  it("resolves a review item only with the required confirmation", async () => {
    const listed = await json(await staff.call("GET", "/api/office/files?states=NeedsReview&direction=Outbound"));
    expect((listed.items as Json[]).map((item) => item.id)).toEqual([ids.f2]);
    expect(listed.total).toBe(1);
    const unconfirmed = await staff.call("POST", `/api/office/files/${ids.f2}/assign`, { body: { clientId: ids.c2, version: 1 } });
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toEqual({ error: "invalid_input", detail: "confirmation_required" });
    const assigned = await json(await staff.call("POST", `/api/office/files/${ids.f2}/assign`, { body: { clientId: ids.c2, confirmed: true, version: 1 } }));
    expect(assigned).toMatchObject({ state: "Staged", client: { code: "C0142" }, resolutionMethod: "StaffSelected", displayName: "C0142_UNCLASSIFIED_20261124_01", version: 2 });
    const stale = await staff.call("POST", `/api/office/files/${ids.f2}/send-back`, { body: { version: 1 } });
    expect(stale.status).toBe(409);
    expect((await staff.call("GET", "/api/office/files?states=Bogus")).status).toBe(400);
  });

  it("publishes with one result per file and withdraws with a reason", async () => {
    const published = await json(await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: ids.f1, version: 1 }, { fileId: ids.f2, version: 1 }, { fileId: "missing", version: 1 }] } }));
    expect(published.results).toEqual([
      { fileId: ids.f1, outcome: "published", clientId: ids.c1 },
      { fileId: ids.f2, outcome: "skipped", reason: "stale" },
      { fileId: "missing", outcome: "skipped", reason: "not_found" },
    ]);
    expect(kit.notifier.notified).toEqual([ids.c1]);
    expect((await json(await staff.call("GET", `/api/office/cases/${ids.k1}`))).state).toBe("Delivered");
    const direct = await staff.call("POST", `/api/office/files/${ids.f1}/trash`, { body: { version: 2 } });
    expect(direct.status).toBe(422);
    expect(await direct.json()).toEqual({ error: "invalid_state", detail: "published_must_be_withdrawn" });
    const noReason = await staff.call("POST", `/api/office/files/${ids.f1}/withdraw`, { body: { next: "NeedsReview", version: 2 } });
    expect(noReason.status).toBe(400);
    const withdrawn = await json(await staff.call("POST", `/api/office/files/${ids.f1}/withdraw`, { body: { reason: "Superseded", next: "Trashed", version: 2 } }));
    expect(withdrawn).toMatchObject({ state: "Trashed", withdrawReason: "Superseded", incident: false });
    const restored = await json(await staff.call("POST", `/api/office/files/${ids.f1}/restore`, { body: { version: Number(withdrawn.version) } }));
    expect(restored).toMatchObject({ state: "NeedsReview", reviewReason: "Restored" });
    expect((await json(await owner.call("GET", "/api/office/incidents"))).items).toEqual([]);
  });

  it("shows the dashboard counts and deadline lists", async () => {
    const dashboard = await json(await owner.call("GET", "/api/office/dashboard"));
    expect(dashboard).toMatchObject({ today: "2026-11-24", needsReview: 1, staged: 1, submitted: 0, unread: [], incidents: 0 });
    expect((dashboard.due as Json[]).map((item) => item.id)).toEqual([ids.k1]);
    expect((dashboard.due as Json[])[0]).toMatchObject({ due: { level: "caution", daysLeft: 6 } });
    expect(dashboard.retrieval).toEqual([]);
    expect((await json(await staff.call("GET", "/api/office/dashboard"))).incidents).toBeNull();
    const old = await json(await staff.call("POST", "/api/office/cases", { body: { clientId: ids.c1, caseTypeId: ids.t1, targetMonth: "2026-09", referenceCode: "SHAHO-2609-01", dueOn: "2026-11-20" } }));
    await staff.call("POST", `/api/office/cases/${String(old.id)}/submit`, { body: { submittedOn: "2026-09-10", arrivalNumbers: [], version: 1 } });
    const later = await json(await staff.call("GET", "/api/office/dashboard"));
    expect(later.retrieval).toEqual([expect.objectContaining({ id: old.id, retrieval: { level: "caution", deadline: "2026-12-09", daysLeft: 15 } })]);
    expect((later.due as Json[]).map((item) => (item.due as Json).level)).toEqual(["expired", "caution"]);
  });

  it("invites, approves and revokes client members", async () => {
    const invited = await staff.call("POST", `/api/office/clients/${ids.c1}/invitations`);
    expect(invited.status).toBe(201);
    const invitation = await json(invited);
    const guest = kit.client();
    kit.identity.identity = { sub: "office-test-guest", displayName: "K. Tanabe" };
    const start = await guest.call("GET", "/api/auth/login");
    await guest.call("GET", `/api/auth/callback?code=c&state=${new URL(start.headers.get("Location") ?? "").searchParams.get("state")}`);
    guest.csrfToken = String((await json(await guest.call("GET", "/api/me"))).csrfToken);
    expect((await guest.call("POST", "/api/invitations/redeem", { body: { code: invitation.code, turnstileToken: "ok" } })).status).toBe(200);
    const members = await json(await staff.call("GET", `/api/office/clients/${ids.c1}/members`));
    const pending = (members.members as Json[])[0] ?? {};
    expect(pending).toMatchObject({ displayName: "K. Tanabe", status: "Pending" });
    expect(pending.redeemedAt).toBeTruthy();
    expect((await staff.call("POST", `/api/office/memberships/${String(pending.membershipId)}/approve`)).status).toBe(200);
    expect((await json(await guest.call("GET", "/api/me"))).memberships).toEqual([expect.objectContaining({ code: "C0031", status: "Active" })]);
    expect(await json(await staff.call("POST", `/api/office/memberships/${String(pending.membershipId)}/revoke`))).toMatchObject({ status: "Revoked" });
    expect((await guest.call("GET", "/api/me")).status).toBe(401);
    const second = await json(await staff.call("POST", `/api/office/clients/${ids.c1}/invitations`));
    expect((await staff.call("POST", `/api/office/invitations/${String(second.id)}/cancel`)).status).toBe(200);
    expect((await staff.call("POST", `/api/office/invitations/${String(second.id)}/cancel`)).status).toBe(422);
  });

  it("archives and closes a client along the allowed path", async () => {
    const client = await json(await staff.call("GET", `/api/office/clients/${ids.c2}`));
    const base = { corporateName: client.corporateName, corporateNumber: null };
    const archived = await json(await staff.call("PATCH", `/api/office/clients/${ids.c2}`, { body: { ...base, status: "Archived", version: 1 } }));
    expect(archived).toMatchObject({ status: "Archived", version: 2 });
    expect((await staff.call("PATCH", `/api/office/clients/${ids.c2}`, { body: { ...base, status: "Closed", version: 2 } })).status).toBe(403);
    expect(await json(await owner.call("PATCH", `/api/office/clients/${ids.c2}`, { body: { ...base, status: "Closed", version: 2 } }))).toMatchObject({ status: "Closed" });
    const skipped = await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: ids.f2, version: 2 }] } });
    expect((await json(skipped)).results).toEqual([{ fileId: ids.f2, outcome: "skipped", reason: "client_not_active" }]);
  });

  it("lets the Owner read the audit log, which records denials too", async () => {
    const audit = await json(await owner.call("GET", "/api/office/audit?limit=200"));
    const entries = audit.items as Json[];
    const actions = entries.map((entry) => entry.action);
    for (const action of ["auth.login", "client.register", "case.register", "case.submit", "file.accept", "file.assign", "file.publish", "file.withdraw", "invitation.issue", "invitation.redeem", "membership.approve", "membership.revoke", "setting.update"]) {
      expect(actions).toContain(action);
    }
    expect(entries.some((entry) => entry.result === "denied")).toBe(true);
    expect(entries.find((entry) => entry.action === "client.register")).toMatchObject({ actorDisplayName: "Dev staff", result: "ok" });
    expect(JSON.stringify(entries)).not.toContain("Yamada");
  });
});
