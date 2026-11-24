import { beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "../../src/core/ports/repository";
import { caseRecord, caseType, client, docRule, docType, fileRecord, user } from "./builders";

const PAGE = { limit: 50, offset: 0 };
const T0 = new Date("2026-11-24T03:00:00.000Z");

/**
 * Behaviour every Repository implementation must share. Each test creates its own records with
 * unique identifiers, so the suite also runs against one shared database.
 */
export function describeRepositoryContract(name: string, create: () => Promise<Repository>): void {
  describe(`Repository contract: ${name}`, () => {
    let repo: Repository;
    let serial = 0;
    let tag = "";

    const id = (label: string): string => `${label}-${tag}`;
    const sha = (label: string): string => `${label}${tag}`.padEnd(64, "0").slice(0, 64);
    const arrival = (digit: number): string => `${String(digit)}${String(serial).padStart(4, "0")}${Date.now()}`.padEnd(18, "7").slice(0, 18);

    beforeEach(async () => {
      repo = await create();
      serial += 1;
      tag = `${name.replaceAll(/[^A-Za-z0-9]/g, "")}${serial}x${Math.floor(Math.random() * 1e9).toString(36)}`;
    });

    async function seedClient(label = "c", overrides: Parameters<typeof client>[0] = {}) {
      const row = client({ id: id(label), code: `K${label}${tag}`.replaceAll(/[^A-Za-z0-9]/g, "").slice(0, 32), ...overrides });
      expect(await repo.clients.insert(row)).toBe(true);
      return row;
    }

    async function seedUser(label = "u", overrides: Parameters<typeof user>[0] = {}) {
      const row = user({ id: id(label), googleSub: id(`sub-${label}`), createdAt: T0, ...overrides });
      await repo.users.insert(row);
      return row;
    }

    async function seedCase(clientId: string, label = "k", overrides: Parameters<typeof caseRecord>[0] = {}) {
      const type = caseType({ id: id(`t-${label}`), kind: "Procedure" });
      await repo.caseTypes.insert(type);
      const row = caseRecord({ id: id(label), clientId, caseTypeId: type.id, createdAt: T0, ...overrides });
      expect(await repo.cases.insert(row)).toBe(true);
      return row;
    }

    async function seedFile(clientId: string | null, label = "f", overrides: Parameters<typeof fileRecord>[0] = {}) {
      const uploader = (await repo.users.findById(id("uploader"))) ?? (await seedUser("uploader", { officeRole: "Staff", officeStatus: "Active" }));
      const batchId = id(`b-${label}`);
      await repo.files.insertBatch({ id: batchId, uploadedBy: uploader.id, hintClientId: null, createdAt: T0 });
      const row = fileRecord({
        id: id(label), batchId, clientId, displayName: `N_${id(label)}`, r2Key: `files/${id(label)}`, sha256: sha(label), receivedAt: T0,
        ...(clientId === null ? { state: "NeedsReview" as const, reviewReason: "NoKey" as const, resolutionMethod: null } : {}),
        ...overrides,
      });
      expect(await repo.files.insert(row)).toBe("ok");
      return row;
    }

    it("updates settings only with the current version", async () => {
      const setting = await repo.settings.get();
      expect(await repo.settings.update({ ...setting, version: setting.version + 1 }, setting.version + 5)).toBe(false);
      expect(await repo.settings.update({ ...setting, retrievalDeadlineDays: 60, autoPublishEnabled: true, version: setting.version + 1 }, setting.version)).toBe(true);
      const stored = await repo.settings.get();
      expect(stored).toMatchObject({ retrievalDeadlineDays: 60, autoPublishEnabled: true, version: setting.version + 1 });
      await repo.settings.update({ ...setting, version: stored.version + 1 }, stored.version);
    });

    it("stores users and guards office transitions by the expected status", async () => {
      const row = await seedUser();
      expect(await repo.users.findById(row.id)).toEqual(row);
      expect(await repo.users.findByGoogleSub(row.googleSub)).toEqual(row);
      expect(await repo.users.findById(id("nobody"))).toBeNull();
      await repo.users.updateDisplayName(row.id, "New Name");
      expect(await repo.users.transitionOffice({ ...row, officeRole: "Staff", officeStatus: "Pending" }, "Active")).toBe(false);
      expect(await repo.users.transitionOffice({ ...row, officeRole: "Staff", officeStatus: "Pending" }, null)).toBe(true);
      expect(await repo.users.transitionOffice({ ...row, officeRole: "Staff", officeStatus: "Active" }, "Pending")).toBe(true);
      expect(await repo.users.findById(row.id)).toMatchObject({ displayName: "New Name", officeRole: "Staff", officeStatus: "Active" });
      expect((await repo.users.listOffice()).map((entry) => entry.id)).toContain(row.id);
    });

    it("never revokes the last active Owner", async () => {
      const before = await repo.users.countActiveOwners();
      const first = await seedUser("o1", { officeRole: "Owner", officeStatus: "Active" });
      const second = await seedUser("o2", { officeRole: "Owner", officeStatus: "Active" });
      const staff = await seedUser("s1", { officeRole: "Staff", officeStatus: "Active" });
      expect(await repo.users.countActiveOwners()).toBe(before + 2);
      expect(await repo.users.revokeOfficeUnlessLastOwner(staff.id)).toBe("ok");
      expect(await repo.users.revokeOfficeUnlessLastOwner(staff.id)).toBe("not_active");
      expect(await repo.users.revokeOfficeUnlessLastOwner(id("nobody"))).toBe("not_active");
      expect(await repo.users.revokeOfficeUnlessLastOwner(first.id)).toBe("ok");
      if (before === 0) {
        expect(await repo.users.revokeOfficeUnlessLastOwner(second.id)).toBe("last_owner");
        expect(await repo.users.findById(second.id)).toMatchObject({ officeStatus: "Active" });
      }
      await repo.users.transitionOffice({ ...second, officeStatus: "Revoked" }, "Active");
    });

    it("keeps client codes unique, finds by code and number, filters and locks by version", async () => {
      const first = await seedClient("a", { corporateNumber: "7000012050002", corporateName: `Hinode ${tag}` });
      const second = await seedClient("b", { corporateNumber: "7000012050002", status: "Archived" });
      expect(await repo.clients.insert(client({ id: id("dup"), code: first.code }))).toBe(false);
      expect(await repo.clients.findByCode(first.code)).toEqual(first);
      expect((await repo.clients.findByCorporateNumber("7000012050002")).map((row) => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));
      expect((await repo.clients.list({ query: first.code }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect((await repo.clients.list({ query: `Hinode ${tag}` }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect((await repo.clients.list({ query: "%" }, PAGE)).map((row) => row.id)).not.toContain(first.id);
      expect((await repo.clients.list({ status: "Archived" }, { limit: 500, offset: 0 })).map((row) => row.id)).toContain(second.id);
      expect((await repo.clients.listAll()).map((row) => row.id)).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(await repo.clients.update({ ...first, status: "Archived", version: 2 }, 9)).toBe(false);
      expect(await repo.clients.update({ ...first, status: "Archived", version: 2 }, 1)).toBe(true);
      expect(await repo.clients.findById(first.id)).toMatchObject({ status: "Archived", version: 2 });
    });

    it("allows one ongoing membership per user and client and guards transitions", async () => {
      const member = await seedUser();
      const company = await seedClient();
      const base = { userId: member.id, clientId: company.id, approvedBy: null, approvedAt: null, createdAt: T0 };
      expect(await repo.memberships.insert({ id: id("m1"), status: "Pending", ...base })).toBe(true);
      expect(await repo.memberships.insert({ id: id("m2"), status: "Pending", ...base })).toBe(false);
      expect(await repo.memberships.findOngoing(member.id, company.id)).toMatchObject({ id: id("m1") });
      const approved = { id: id("m1"), status: "Active" as const, ...base, approvedBy: member.id, approvedAt: T0 };
      expect(await repo.memberships.transition(approved, "Active")).toBe(false);
      expect(await repo.memberships.transition(approved, "Pending")).toBe(true);
      expect(await repo.memberships.findById(id("m1"))).toEqual(approved);
      expect(await repo.memberships.transition({ ...approved, status: "Revoked" }, "Active")).toBe(true);
      expect(await repo.memberships.findOngoing(member.id, company.id)).toBeNull();
      expect(await repo.memberships.insert({ id: id("m3"), status: "Pending", ...base })).toBe(true);
      expect((await repo.memberships.listByUser(member.id)).map((row) => row.id)).toEqual([id("m1"), id("m3")]);
      expect((await repo.memberships.listByClient(company.id)).map((row) => row.status)).toEqual(["Revoked", "Pending"]);
    });

    it("guards invitation transitions, expires old ones and finds the latest redemption", async () => {
      const issuer = await seedUser("issuer", { officeRole: "Owner", officeStatus: "Revoked" });
      const guest = await seedUser("guest");
      const company = await seedClient();
      const base = { issuedBy: issuer.id, redeemedBy: null, redeemedAt: null, createdAt: T0, status: "Issued" as const };
      const forClient = { ...base, id: id("i1"), codeHash: id("h1"), targetType: "Client" as const, clientId: company.id, officeRole: null, expiresAt: new Date(T0.getTime() + 1000) };
      const forOffice = { ...base, id: id("i2"), codeHash: id("h2"), targetType: "Office" as const, clientId: null, officeRole: "Staff" as const, expiresAt: new Date(T0.getTime() + 5000) };
      await repo.invitations.insert(forClient);
      await repo.invitations.insert(forOffice);
      expect(await repo.invitations.findByCodeHash(id("h1"))).toEqual(forClient);
      expect(await repo.invitations.findById(id("i2"))).toEqual(forOffice);
      expect((await repo.invitations.listIssued(company.id)).map((row) => row.id)).toEqual([id("i1")]);
      expect((await repo.invitations.listIssued(null)).map((row) => row.id)).toContain(id("i2"));
      const redeemed = { ...forOffice, status: "Redeemed" as const, redeemedBy: guest.id, redeemedAt: new Date(T0.getTime() + 2000) };
      expect(await repo.invitations.transition(redeemed, "Issued")).toBe(true);
      expect(await repo.invitations.transition(redeemed, "Issued")).toBe(false);
      expect(await repo.invitations.findLatestRedeemedBy(guest.id, null)).toEqual(redeemed);
      expect(await repo.invitations.findLatestRedeemedBy(guest.id, company.id)).toBeNull();
      expect(await repo.invitations.expireBefore(new Date(T0.getTime() + 1000))).toBeGreaterThanOrEqual(1);
      expect(await repo.invitations.findById(id("i1"))).toMatchObject({ status: "Expired" });
      expect(await repo.invitations.findById(id("i2"))).toMatchObject({ status: "Redeemed" });
    });

    it("numbers cases, locks by version and filters", async () => {
      const company = await seedClient();
      const first = await seedCase(company.id, "k1");
      expect(await repo.cases.nextSequence(company.id, first.caseTypeId, first.targetMonth)).toBe(2);
      expect(await repo.cases.nextSequence(company.id, first.caseTypeId, "2026-12")).toBe(1);
      expect(await repo.cases.insert({ ...first, id: id("k-dup") })).toBe(false);
      expect(await repo.cases.update({ ...first, state: "Closed", version: 2 }, 5)).toBe(false);
      expect(await repo.cases.update({ ...first, dueOn: "2026-11-30", assigneeId: null, state: "Closed", version: 2 }, 1)).toBe(true);
      expect(await repo.cases.findById(first.id)).toMatchObject({ state: "Closed", dueOn: "2026-11-30", version: 2 });
      expect((await repo.cases.list({ clientId: company.id }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect(await repo.cases.list({ clientId: company.id, states: ["Open"] }, PAGE)).toEqual([]);
      expect(await repo.cases.list({ clientId: company.id, states: [] }, PAGE)).toEqual([]);
      expect(await repo.cases.list({ clientId: company.id, kind: "Payroll" }, PAGE)).toEqual([]);
      expect((await repo.cases.list({ clientId: company.id, kind: "Procedure", targetMonth: first.targetMonth, states: ["Closed"] }, PAGE)).map((row) => row.id)).toEqual([first.id]);
    });

    it("writes a case and its arrival numbers atomically", async () => {
      const company = await seedClient();
      const first = await seedCase(company.id, "k1");
      const second = await seedCase(company.id, "k2", { sequence: 2 });
      const [a1, a2, a3] = [arrival(1), arrival(2), arrival(3)];
      const submitted = { ...first, submittedOn: "2026-11-20", state: "Submitted" as const, version: 2 };
      expect(await repo.cases.updateWithArrivals(submitted, 1, [{ id: id("a1"), caseId: first.id, arrivalNumber: a1 }])).toBe("ok");
      expect(await repo.cases.findByArrivalNumber(a1)).toMatchObject({ id: first.id, state: "Submitted", version: 2 });
      expect(await repo.cases.findByArrivalNumber(arrival(9))).toBeNull();
      const other = { ...second, submittedOn: "2026-11-21", state: "Submitted" as const, version: 2 };
      expect(await repo.cases.updateWithArrivals(other, 7, [{ id: id("a2"), caseId: second.id, arrivalNumber: a2 }])).toBe("stale");
      expect(await repo.cases.updateWithArrivals(other, 1, [
        { id: id("a3"), caseId: second.id, arrivalNumber: a3 },
        { id: id("a4"), caseId: second.id, arrivalNumber: a1 },
      ])).toBe("arrival_taken");
      expect(await repo.cases.findById(second.id)).toMatchObject({ state: "Open", submittedOn: null, version: 1 });
      expect(await repo.cases.listArrivals(second.id)).toEqual([]);
      expect(await repo.cases.addArrival({ id: id("a5"), caseId: second.id, arrivalNumber: a1 })).toBe(false);
      expect(await repo.cases.addArrival({ id: id("a6"), caseId: second.id, arrivalNumber: a2 })).toBe(true);
      expect((await repo.cases.listArrivals(second.id)).map((row) => row.arrivalNumber)).toEqual([a2]);
    });

    it("keeps document type short codes unique and stores rules", async () => {
      const code = `Z${serial}${Math.floor(Math.random() * 1e6)}`.toUpperCase().replaceAll(/[^A-Z0-9]/g, "").slice(0, 16);
      const type = docType({ id: id("d1"), shortCode: code });
      expect(await repo.docTypes.insert(type)).toBe(true);
      expect(await repo.docTypes.insert(docType({ id: id("d2"), shortCode: code }))).toBe(false);
      expect(await repo.docTypes.update({ ...type, label: "Renamed", direction: "Both" })).toBe(true);
      expect(await repo.docTypes.findById(type.id)).toMatchObject({ label: "Renamed", direction: "Both" });
      expect(await repo.docTypes.update(docType({ id: id("missing"), shortCode: `${code}X`.slice(0, 16) }))).toBe(false);
      await repo.docTypes.insertRule(docRule({ id: id("r1"), docTypeId: type.id, keyword: "kettei" }));
      expect((await repo.docTypes.listRules()).filter((rule) => rule.docTypeId === type.id)).toEqual([{ id: id("r1"), docTypeId: type.id, keyword: "kettei" }]);
      await repo.docTypes.deleteRule(id("r1"));
      expect((await repo.docTypes.listRules()).filter((rule) => rule.docTypeId === type.id)).toEqual([]);
      expect((await repo.docTypes.list()).map((row) => row.id)).toContain(type.id);
    });

    it("stores files and reports which constraint a write hit", async () => {
      const company = await seedClient();
      const first = await seedFile(company.id, "f1", { reviewDetail: null });
      expect(await repo.files.findById(first.id)).toEqual(first);
      expect(await repo.files.insert({ ...first, id: id("f2"), r2Key: "files/x2", sha256: sha("other") })).toBe("name_taken");
      expect(await repo.files.insert({ ...first, id: id("f3"), r2Key: "files/x3", displayName: `N_${id("f3")}` })).toBe("duplicate_content");
      expect(await repo.files.update({ ...first, state: "NeedsReview", reviewReason: "SentBack", version: 2 }, 4)).toBe("stale");
      const detail = [{ kind: "ClientCode" as const, clientId: company.id }];
      const changed = { ...first, state: "NeedsReview" as const, reviewReason: "ConflictingKeys" as const, reviewDetail: detail, jevConfidence: 0.42, version: 2 };
      expect(await repo.files.update(changed, 1)).toBe("ok");
      expect(await repo.files.findById(first.id)).toEqual(changed);
      expect(await repo.files.findBatch(first.batchId)).toMatchObject({ id: first.batchId, hintClientId: null });
      expect(await repo.files.findBatch(id("no-batch"))).toBeNull();
    });

    it("treats trashed files as absent for duplicate checks", async () => {
      const company = await seedClient();
      const first = await seedFile(company.id, "f1");
      expect((await repo.files.findActiveBySha256(first.sha256)).map((row) => row.id)).toEqual([first.id]);
      const trashed = { ...first, state: "Trashed" as const, trashedFrom: "Staged" as const, trashedAt: T0, version: 2 };
      expect(await repo.files.update(trashed, 1)).toBe("ok");
      expect(await repo.files.findActiveBySha256(first.sha256)).toEqual([]);
      const again = await seedFile(company.id, "f2", { sha256: first.sha256 });
      expect(await repo.files.update({ ...trashed, state: "NeedsReview", reviewReason: "Restored", trashedFrom: null, trashedAt: null, version: 3 }, 2)).toBe("duplicate_content");
      expect((await repo.files.findActiveBySha256(first.sha256)).map((row) => row.id)).toEqual([again.id]);
    });

    it("numbers display names by their prefix and day", async () => {
      const company = await seedClient();
      expect(await repo.files.nextDisplaySequence(company.id, "2026-11-24")).toBe(1);
      await seedFile(company.id, "f1", { displayName: `${company.code}_SHAHO_20261124_01` });
      await seedFile(company.id, "f2", { displayName: `${company.code}_UNCLASSIFIED_20261124_07` });
      await seedFile(company.id, "f3", { displayName: `${company.code}_SHAHO_20261125_03` });
      expect(await repo.files.nextDisplaySequence(company.id, "2026-11-24")).toBe(8);
      expect(await repo.files.nextDisplaySequence(company.id, "2026-11-25")).toBe(4);
      expect(await repo.files.nextDisplaySequence(company.id, "2026-11-26")).toBe(1);
      expect(await repo.files.nextDisplaySequence(null, "2031-01-01")).toBe(1);
    });

    it("lists and counts files by filter and summarises them for a case", async () => {
      const company = await seedClient();
      const linked = await seedCase(company.id);
      const staged = await seedFile(company.id, "f1", { caseId: linked.id, receivedAt: new Date(T0.getTime() + 1000) });
      const published = await seedFile(company.id, "f2", { caseId: linked.id, state: "Published", publishedAt: T0, receivedAt: new Date(T0.getTime() + 2000) });
      const opened = await seedFile(company.id, "f3", { caseId: linked.id, state: "Published", publishedAt: T0, receivedAt: new Date(T0.getTime() + 3000) });
      await seedFile(company.id, "f4", { caseId: linked.id, direction: "Inbound", state: "Submitted", targetMonth: "2026-11" });
      await seedFile(company.id, "f5", { caseId: linked.id, state: "Trashed", trashedFrom: "Staged", trashedAt: T0 });
      const viewer = await seedUser("viewer");
      expect(await repo.receipts.insertIfAbsent({ id: id("x1"), fileId: opened.id, userId: viewer.id, firstViewedAt: T0 })).toBe(true);
      expect(await repo.receipts.insertIfAbsent({ id: id("x2"), fileId: opened.id, userId: viewer.id, firstViewedAt: new Date() })).toBe(false);
      expect(await repo.files.summarizeForCase(linked.id)).toEqual({ outbound: 3, published: 2, publishedAndOpened: 1, inbound: 1 });
      expect(await repo.files.summarizeForCase(id("no-case"))).toEqual({ outbound: 0, published: 0, publishedAndOpened: 0, inbound: 0 });
      expect((await repo.files.list({ clientId: company.id, direction: "Outbound", states: ["Staged", "Published"] }, PAGE)).map((row) => row.id)).toEqual([opened.id, published.id, staged.id]);
      expect((await repo.files.list({ clientId: company.id, direction: "Outbound", states: ["Staged", "Published"] }, { limit: 1, offset: 1 })).map((row) => row.id)).toEqual([published.id]);
      expect(await repo.files.count({ clientId: company.id })).toBe(5);
      expect(await repo.files.count({ clientId: company.id, targetMonth: "2026-11" })).toBe(1);
      expect(await repo.files.count({ clientId: company.id, states: [] })).toBe(0);
      expect(await repo.files.count({ caseId: linked.id, incidentOnly: true })).toBe(0);
      expect(await repo.receipts.hasOpened(opened.id, viewer.id)).toBe(true);
      expect(await repo.receipts.hasOpened(staged.id, viewer.id)).toBe(false);
      expect((await repo.receipts.listByFile(opened.id)).map((row) => row.id)).toEqual([id("x1")]);
      expect((await repo.receipts.listByFiles([staged.id, opened.id])).map((row) => row.fileId)).toEqual([opened.id]);
      expect(await repo.receipts.listByFiles([])).toEqual([]);
    });

    it("lists trashed files that are due and purges them with their receipts", async () => {
      const company = await seedClient();
      const old = await seedFile(company.id, "f1", { state: "Trashed", trashedFrom: "Staged", trashedAt: new Date("2020-01-01T00:00:00.000Z") });
      const recent = await seedFile(company.id, "f2", { state: "Trashed", trashedFrom: "Staged", trashedAt: T0 });
      const viewer = await seedUser("viewer");
      await repo.receipts.insertIfAbsent({ id: id("x1"), fileId: old.id, userId: viewer.id, firstViewedAt: T0 });
      const due = (await repo.files.listTrashedBefore(new Date("2020-01-01T00:00:00.000Z"), { limit: 500, offset: 0 })).map((row) => row.id);
      expect(due).toContain(old.id);
      expect(due).not.toContain(recent.id);
      await repo.files.purge(old.id);
      expect(await repo.files.findById(old.id)).toBeNull();
      expect(await repo.receipts.listByFile(old.id)).toEqual([]);
      expect(await repo.files.findById(recent.id)).not.toBeNull();
    });

    it("appends audit entries and metric events", async () => {
      const actor = await seedUser();
      await repo.audit.append({ id: id("l1"), actorUserId: actor.id, action: "file.publish", targetType: "file", targetId: id("f"), result: "ok", occurredAt: new Date("2099-01-01T00:00:00.000Z") });
      await repo.audit.append({ id: id("l2"), actorUserId: null, action: "file.purge", targetType: "file", targetId: id("f"), result: "failed", occurredAt: new Date("2099-01-02T00:00:00.000Z") });
      const listed = (await repo.audit.list({ limit: 500, offset: 0 })).filter((entry) => entry.targetId === id("f"));
      expect(listed.map((entry) => [entry.id, entry.actorUserId, entry.result])).toEqual([[id("l2"), null, "failed"], [id("l1"), actor.id, "ok"]]);
      await expect(repo.metrics.append({ id: id("e1"), name: "intake.accepted", clientId: null, attributes: { fileId: id("f"), ok: true, n: 1, none: null }, occurredAt: T0 })).resolves.toBeUndefined();
    });

    it("ends the sessions of a user without error when there are none", async () => {
      await expect(repo.sessions.revokeAllForUser(id("nobody"))).resolves.toBeUndefined();
    });
  });
}
