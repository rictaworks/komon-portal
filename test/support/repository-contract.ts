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

    it("claims the first Owner atomically and only while there is none", async () => {
      const candidate = await seedUser("claim");
      const pending = await seedUser("claim-pending", { officeRole: "Staff", officeStatus: "Pending" });
      const before = await repo.users.countActiveOwners();
      expect(await repo.users.claimOwnerIfNone(pending.id)).toBe(false);
      expect(await repo.users.claimOwnerIfNone(id("nobody"))).toBe(false);
      expect(await repo.users.claimOwnerIfNone(candidate.id)).toBe(before === 0);
      if (before === 0) {
        expect(await repo.users.findById(candidate.id)).toMatchObject({ officeRole: "Owner", officeStatus: "Active" });
        expect(await repo.users.claimOwnerIfNone((await seedUser("claim-late")).id)).toBe(false);
        await repo.users.transitionOffice({ ...candidate, officeRole: "Owner", officeStatus: "Revoked" }, "Active");
      }
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
      // The search ignores the case of ASCII letters and matches any part of the code or the name.
      expect((await repo.clients.list({ query: first.code.toLowerCase() }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect((await repo.clients.list({ query: `hinode ${tag}`.toUpperCase() }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect((await repo.clients.list({ query: first.code.slice(1) }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect((await repo.clients.list({ query: `node ${tag}` }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect(await repo.clients.list({ query: `${first.code}-` }, PAGE)).toEqual([]);
      const longName = "\u682a\u5f0f\u4f1a\u793e".repeat(8) + tag;
      const wide = await seedClient("w", { corporateName: longName });
      expect((await repo.clients.list({ query: longName }, PAGE)).map((row) => row.id)).toEqual([wide.id]);
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

    it("counts the active and pending members of several clients at once", async () => {
      const busy = await seedClient("busy");
      const quiet = await seedClient("quiet");
      const other = await seedClient("other");
      const add = async (label: string, clientId: string, status: "Pending" | "Active" | "Revoked" | "Rejected") => {
        const member = await seedUser(label);
        expect(await repo.memberships.insert({ id: id(`n-${label}`), userId: member.id, clientId, status, approvedBy: null, approvedAt: null, createdAt: T0 })).toBe(true);
      };
      await add("a1", busy.id, "Active");
      await add("a2", busy.id, "Active");
      await add("p1", busy.id, "Pending");
      await add("r1", busy.id, "Revoked");
      await add("j1", quiet.id, "Rejected");
      await add("o1", other.id, "Active");
      const counts = await repo.memberships.countOngoingByClients([busy.id, quiet.id, id("missing")]);
      expect([...counts.entries()]).toEqual([[busy.id, { active: 2, pending: 1 }]]);
      expect((await repo.memberships.countOngoingByClients([])).size).toBe(0);
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
      expect((await repo.cases.list({ clientId: company.id, caseTypeId: first.caseTypeId }, PAGE)).map((row) => row.id)).toEqual([first.id]);
      expect(await repo.cases.list({ clientId: company.id, caseTypeId: id("t-other") }, PAGE)).toEqual([]);
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
      // The usual stale case: the stored version already equals the version the caller wants to write.
      expect(await repo.cases.update({ ...second, version: 2 }, 1)).toBe(true);
      expect(await repo.cases.updateWithArrivals(other, 1, [{ id: id("a2b"), caseId: second.id, arrivalNumber: a2 }])).toBe("stale");
      expect(await repo.cases.listArrivals(second.id)).toEqual([]);
      expect(await repo.cases.update({ ...second, version: 1 }, 2)).toBe(true);
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
      expect(await repo.docTypes.findById(type.id)).toMatchObject({ label: "Renamed", direction: "Both", caseTypeId: null });
      const linkedTo = caseType({ id: id("t-doc"), kind: "Payroll", label: "Payroll" });
      await repo.caseTypes.insert(linkedTo);
      expect(await repo.docTypes.update({ ...type, caseTypeId: linkedTo.id })).toBe(true);
      expect(await repo.docTypes.findById(type.id)).toMatchObject({ caseTypeId: linkedTo.id });
      expect((await repo.docTypes.list()).find((row) => row.id === type.id)?.caseTypeId).toBe(linkedTo.id);
      const linkedCode = `${code}L`.slice(-16);
      expect(await repo.docTypes.insert(docType({ id: id("d3"), shortCode: linkedCode, caseTypeId: linkedTo.id }))).toBe(true);
      expect(await repo.docTypes.findById(id("d3"))).toMatchObject({ caseTypeId: linkedTo.id });
      await expect(repo.docTypes.insert(docType({ id: id("d4"), shortCode: `${code}M`.slice(-16), caseTypeId: id("no-such-type") }))).rejects.toThrow(/FOREIGN KEY/);
      expect(await repo.docTypes.update({ ...type, caseTypeId: null })).toBe(true);
      expect(await repo.docTypes.findById(type.id)).toMatchObject({ caseTypeId: null });
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
      // A code that is a prefix of another code must not see the other client's names.
      const longer = await seedClient("c2", { code: `${company.code}0` });
      await seedFile(longer.id, "f4", { displayName: `${longer.code}_SHAHO_20261124_40` });
      expect(await repo.files.nextDisplaySequence(company.id, "2026-11-24")).toBe(8);
      expect(await repo.files.nextDisplaySequence(longer.id, "2026-11-24")).toBe(41);
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
      // Files with no document type are found by the store itself, not picked out of one page of a longer list.
      const typed = docType({ id: id("d-untyped"), shortCode: `U${Date.now().toString(36)}`.toUpperCase().slice(0, 16) });
      expect(await repo.docTypes.insert(typed)).toBe(true);
      const withType = await seedFile(company.id, "f6", { docTypeId: typed.id, typeSource: "Staff" });
      expect((await repo.files.list({ clientId: company.id, states: ["Staged"], untyped: true }, { limit: 1, offset: 0 })).map((row) => row.id)).toEqual([staged.id]);
      expect(await repo.files.count({ clientId: company.id, states: ["Staged"], untyped: true })).toBe(1);
      expect((await repo.files.list({ clientId: company.id, docTypeId: typed.id }, PAGE)).map((row) => row.id)).toEqual([withType.id]);
      expect(await repo.files.count({ clientId: company.id, docTypeId: typed.id, untyped: true })).toBe(0);
      expect(await repo.receipts.hasOpened(opened.id, viewer.id)).toBe(true);
      expect(await repo.receipts.hasOpened(staged.id, viewer.id)).toBe(false);
      expect((await repo.receipts.listByFile(opened.id)).map((row) => row.id)).toEqual([id("x1")]);
      expect((await repo.receipts.listByFiles([staged.id, opened.id])).map((row) => row.fileId)).toEqual([opened.id]);
      expect(await repo.receipts.listByFiles([])).toEqual([]);
    });

    it("stores the record of an incident and lists incidents by the time of their withdrawal", async () => {
      const company = await seedClient();
      const other = await seedClient("c2");
      const incident = (label: string, receivedAt: Date, incidentAt: Date) =>
        seedFile(other.id, label, {
          receivedAt, state: "Published", publishedAt: T0, withdrawReason: "Superseded",
          incidentFlag: true, incidentClientId: company.id, incidentReason: "WrongClient", incidentAt,
        });
      // Taken in first, withdrawn last.
      const late = await incident("f1", new Date(T0.getTime() - 5000), new Date(T0.getTime() + 3000));
      const early = await incident("f2", new Date(T0.getTime() + 1000), new Date(T0.getTime() + 1000));
      const middle = await incident("f3", T0, new Date(T0.getTime() + 2000));
      await seedFile(company.id, "f4", { state: "Published", publishedAt: T0 });
      expect(await repo.files.findById(late.id)).toEqual(late);
      expect((await repo.files.listIncidents({ limit: 10, offset: 0 })).map((row) => row.id)).toEqual([late.id, middle.id, early.id]);
      expect((await repo.files.listIncidents({ limit: 1, offset: 1 })).map((row) => row.id)).toEqual([middle.id]);
      expect(await repo.files.count({ incidentOnly: true })).toBe(3);
    });

    it("lists and counts the published files a user has not opened, newest publication first", async () => {
      const company = await seedClient();
      const other = await seedClient("o");
      const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
      // Intake order is the reverse of publication order, so the two orderings cannot be confused.
      const early = await seedFile(company.id, "f1", { state: "Published", receivedAt: at(30), publishedAt: at(100) });
      const middle = await seedFile(company.id, "f2", { state: "Published", receivedAt: at(20), publishedAt: at(200) });
      const late = await seedFile(company.id, "f3", { state: "Published", receivedAt: at(10), publishedAt: at(300) });
      const opened = await seedFile(company.id, "f4", { state: "Published", receivedAt: at(40), publishedAt: at(400) });
      await seedFile(company.id, "f5", { receivedAt: at(50) });
      await seedFile(company.id, "f6", { state: "Withdrawn", withdrawReason: "Other", publishedAt: at(500) });
      await seedFile(company.id, "f7", { direction: "Inbound", state: "Submitted", targetMonth: "2026-11" });
      await seedFile(other.id, "f8", { state: "Published", publishedAt: at(600) });
      // Only a trashed file can be purged (a CHECK constraint ties purging_at to state 'Trashed'), so
      // this row is left out by its state; a published file being purged cannot exist.
      const purged = await seedFile(company.id, "f9", { state: "Trashed", trashedFrom: "Withdrawn", withdrawReason: "Other", publishedAt: at(700), trashedAt: T0 });
      const reader = await seedUser("reader");
      const colleague = await seedUser("colleague");
      await repo.receipts.insertIfAbsent({ id: id("x1"), fileId: opened.id, userId: reader.id, firstViewedAt: T0 });
      await repo.receipts.insertIfAbsent({ id: id("x2"), fileId: late.id, userId: colleague.id, firstViewedAt: T0 });
      expect(await repo.files.beginPurge(purged.id, T0, T0)).toBe(true);

      const ids = async (clientId: string, userId: string, page = PAGE) => {
        const view = await repo.files.unreadPublished(clientId, userId, page);
        return { ids: view.files.map((row) => row.id), total: view.total };
      };
      expect(await ids(company.id, reader.id)).toEqual({ ids: [late.id, middle.id, early.id], total: 3 });
      // The total counts every unread file, whatever the page.
      expect(await ids(company.id, reader.id, { limit: 1, offset: 1 })).toEqual({ ids: [middle.id], total: 3 });
      expect(await ids(company.id, colleague.id)).toEqual({ ids: [opened.id, middle.id, early.id], total: 3 });
      expect(await ids(id("no-client"), reader.id)).toEqual({ ids: [], total: 0 });
    });

    it("lists published files by publication, newest first, with ties broken by id and a stable order across pages", async () => {
      const company = await seedClient();
      const other = await seedClient("o");
      const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
      // Intake order is the reverse of publication order, so `list` and `listByPublication` differ.
      const early = await seedFile(company.id, "p1", { state: "Published", receivedAt: at(30), publishedAt: at(100) });
      const tieA = await seedFile(company.id, "p2", { state: "Published", receivedAt: at(20), publishedAt: at(200) });
      const tieB = await seedFile(company.id, "p3", { state: "Published", receivedAt: at(40), publishedAt: at(200) });
      const late = await seedFile(company.id, "p4", { state: "Published", receivedAt: at(10), publishedAt: at(300) });
      await seedFile(company.id, "p5", { receivedAt: at(50) });
      await seedFile(other.id, "p6", { state: "Published", receivedAt: at(60), publishedAt: at(400) });
      const tied = [tieA.id, tieB.id].sort();
      const expected = [late.id, ...tied, early.id];
      const filter = { clientId: company.id, direction: "Outbound" as const, states: ["Published" as const] };

      expect((await repo.files.listByPublication(filter, PAGE)).map((row) => row.id)).toEqual(expected);
      expect((await repo.files.list(filter, PAGE)).map((row) => row.id)).toEqual([tieB.id, early.id, tieA.id, late.id]);
      // Every page cuts the same order: walking one row at a time yields the whole list once.
      const walked: string[] = [];
      for (let offset = 0; offset < expected.length; offset += 1) {
        walked.push(...(await repo.files.listByPublication(filter, { limit: 1, offset })).map((row) => row.id));
      }
      expect(walked).toEqual(expected);
      expect((await repo.files.listByPublication(filter, { limit: 2, offset: 1 })).map((row) => row.id)).toEqual(tied);
      expect(await repo.files.listByPublication({ ...filter, clientId: id("no-client") }, PAGE)).toEqual([]);
    });

    it("lists trashed files that are due and purges them with their receipts in two steps", async () => {
      const company = await seedClient();
      const old = await seedFile(company.id, "f1", { state: "Trashed", trashedFrom: "Staged", trashedAt: new Date("2020-01-01T00:00:00.000Z") });
      const recent = await seedFile(company.id, "f2", { state: "Trashed", trashedFrom: "Staged", trashedAt: T0 });
      const viewer = await seedUser("viewer");
      await repo.receipts.insertIfAbsent({ id: id("x1"), fileId: old.id, userId: viewer.id, firstViewedAt: T0 });
      const threshold = new Date("2020-01-01T00:00:00.000Z");
      const dueIds = async () => (await repo.files.listTrashedBefore(threshold, { limit: 500, offset: 0 })).map((row) => row.id);
      const purgingIds = async () => (await repo.files.listPurging({ limit: 500, offset: 0 })).map((row) => row.id);
      expect(await dueIds()).toContain(old.id);
      expect(await dueIds()).not.toContain(recent.id);
      expect(await purgingIds()).not.toContain(old.id);
      const entry = (label: string, targetId: string) => ({
        id: id(label), actorUserId: null, action: "file.purge", targetType: "file", targetId, result: "ok" as const, occurredAt: T0,
      });
      // Nothing can be completed that was not begun.
      expect(await repo.files.completePurge(old.id, entry("pl0", old.id))).toBe(false);
      expect(await repo.files.findById(old.id)).not.toBeNull();

      expect(await repo.files.beginPurge(recent.id, threshold, T0)).toBe(false);
      expect(await repo.files.beginPurge(id("no-file"), threshold, T0)).toBe(false);
      expect(await repo.files.beginPurge(old.id, threshold, T0)).toBe(true);
      expect(await repo.files.beginPurge(old.id, threshold, T0)).toBe(false);

      // Being purged: found only by the purge job, with what it needs to remove the body.
      expect((await repo.files.listPurging({ limit: 500, offset: 0 })).find((row) => row.id === old.id)).toEqual({ id: old.id, clientId: company.id, r2Key: old.r2Key });
      expect(await purgingIds()).not.toContain(recent.id);
      expect(await dueIds()).not.toContain(old.id);
      expect(await repo.files.findById(old.id)).toBeNull();
      expect((await repo.files.list({ clientId: company.id }, PAGE)).map((row) => row.id)).toEqual([recent.id]);
      expect(await repo.files.count({ clientId: company.id })).toBe(1);
      expect(await repo.files.count({ clientId: company.id, states: ["Trashed"] })).toBe(1);
      expect(await repo.receipts.listByFile(old.id)).toEqual([]);
      // A restore that read the record before the purge began cannot bring it back.
      expect(await repo.files.update({ ...old, state: "Staged", trashedFrom: null, trashedAt: null, version: 2 }, 1)).toBe("stale");
      expect(await repo.files.findById(old.id)).toBeNull();
      expect(await purgingIds()).toContain(old.id);
      // Its display name stays taken until the record is erased.
      expect(await repo.files.insert(fileRecord({ ...old, id: id("f3"), r2Key: `files/${id("f3")}`, sha256: "9".repeat(64), state: "Staged", trashedFrom: null, trashedAt: null }))).toBe("name_taken");

      expect(await repo.files.completePurge(recent.id, entry("pl1", recent.id))).toBe(false);
      expect(await repo.files.completePurge(id("no-file"), entry("pl2", id("no-file")))).toBe(false);
      expect(await repo.files.completePurge(old.id, entry("pl3", old.id))).toBe(true);
      expect(await repo.files.completePurge(old.id, entry("pl4", old.id))).toBe(false);
      expect(await purgingIds()).not.toContain(old.id);
      expect(await repo.files.findById(old.id)).toBeNull();
      expect(await repo.files.findById(recent.id)).not.toBeNull();
      expect(await repo.files.insert(fileRecord({ ...old, id: id("f3"), r2Key: `files/${id("f3")}`, sha256: "9".repeat(64), state: "Staged", trashedFrom: null, trashedAt: null }))).toBe("ok");
      const purges = (await repo.audit.list({ limit: 500, offset: 0 })).filter((row) => row.action === "file.purge" && [old.id, recent.id, id("no-file")].includes(row.targetId));
      expect(purges.map((row) => [row.id, row.targetId])).toEqual([[id("pl3"), old.id]]);
    });

    it("finds the latest successful audit entry of a target among the given actions", async () => {
      const target = id("aud-user");
      const entryFor = (label: string, action: string, result: "ok" | "denied", offsetMs: number, targetId = target) => ({
        id: id(label),
        actorUserId: null,
        action,
        targetType: "user",
        targetId,
        result,
        occurredAt: new Date(T0.getTime() + offsetMs),
      });
      await repo.audit.append(entryFor("al1", "office.approve", "ok", 0));
      await repo.audit.append(entryFor("al2", "office.approve", "ok", 60_000));
      await repo.audit.append(entryFor("al3", "office.approve", "denied", 120_000));
      await repo.audit.append(entryFor("al4", "office.revoke", "ok", 180_000));
      await repo.audit.append(entryFor("al5", "office.approve", "ok", 240_000, id("aud-other")));
      expect((await repo.audit.latestOk("user", target, ["office.approve", "setup.claim_owner"]))?.id).toBe(id("al2"));
      expect(await repo.audit.latestOk("user", target, ["setup.claim_owner"])).toBeNull();
      expect(await repo.audit.latestOk("user", target, [])).toBeNull();
      expect(await repo.audit.latestOk("client", target, ["office.approve"])).toBeNull();
    });

    it("changes a file and appends its audit entry together, or does neither", async () => {
      const company = await seedClient();
      const actor = await seedUser("actor", { officeRole: "Staff", officeStatus: "Active" });
      const file = await seedFile(company.id);
      const entry = (label: string) => ({
        id: id(label), actorUserId: actor.id, action: "file.publish", targetType: "file", targetId: file.id, result: "ok" as const, occurredAt: T0,
      });
      const entriesForFile = async () => (await repo.audit.list({ limit: 500, offset: 0 })).filter((row) => row.targetId === file.id).map((row) => row.id);
      const published = { ...file, state: "Published" as const, publishedAt: T0, version: 2 };

      // A stale version writes neither the state nor the entry.
      expect(await repo.files.updateWithAudit({ ...published, version: 6 }, 5, entry("wa-stale"))).toBe("stale");
      expect(await repo.files.findById(file.id)).toMatchObject({ state: "Staged", version: 1 });
      expect(await entriesForFile()).toEqual([]);

      // An entry that cannot be written (its id is taken) stops the change.
      await repo.audit.append({ ...entry("wa-taken"), targetId: id("other-target") });
      await expect(repo.files.updateWithAudit(published, 1, entry("wa-taken"))).rejects.toThrow();
      expect(await repo.files.findById(file.id)).toMatchObject({ state: "Staged", version: 1, publishedAt: null });
      expect(await entriesForFile()).toEqual([]);

      // A change that hits a constraint leaves no entry behind.
      const twin = await seedFile(company.id, "f-twin", { sha256: file.sha256, state: "Trashed", trashedFrom: "Staged", trashedAt: T0 });
      const restored = { ...twin, state: "Staged" as const, trashedFrom: null, trashedAt: null, version: 2 };
      expect(await repo.files.updateWithAudit(restored, 1, { ...entry("wa-dup"), targetId: twin.id })).toBe("duplicate_content");
      expect(await repo.files.findById(twin.id)).toMatchObject({ state: "Trashed", version: 1 });
      expect((await repo.audit.list({ limit: 500, offset: 0 })).filter((row) => row.targetId === twin.id)).toEqual([]);

      expect(await repo.files.updateWithAudit(published, 1, entry("wa-ok"))).toBe("ok");
      expect(await repo.files.findById(file.id)).toMatchObject({ state: "Published", version: 2, publishedAt: T0 });
      expect(await entriesForFile()).toEqual([id("wa-ok")]);
      // The same write again is stale and adds nothing.
      expect(await repo.files.updateWithAudit(published, 1, entry("wa-again"))).toBe("stale");
      expect(await entriesForFile()).toEqual([id("wa-ok")]);
    });

    it("changes a case and appends its audit entry together, or does neither", async () => {
      const company = await seedClient();
      const record = await seedCase(company.id, "k-wa");
      const entry = (label: string) => ({
        id: id(label), actorUserId: null, action: "case.state_change", targetType: "case", targetId: record.id, result: "ok" as const, occurredAt: T0,
      });
      const entriesForCase = async () => (await repo.audit.list({ limit: 500, offset: 0 })).filter((row) => row.targetId === record.id).map((row) => row.id);
      const received = { ...record, state: "DocumentReceived" as const, version: 2 };

      // A stale version writes neither the state nor the entry.
      expect(await repo.cases.updateWithAudit({ ...received, version: 6 }, 5, entry("ka-stale"))).toBe(false);
      expect(await repo.cases.findById(record.id)).toMatchObject({ state: "Open", version: 1 });
      expect(await entriesForCase()).toEqual([]);

      // An entry that cannot be written (its id is taken) stops the change.
      await repo.audit.append({ ...entry("ka-taken"), targetId: id("other-case") });
      await expect(repo.cases.updateWithAudit(received, 1, entry("ka-taken"))).rejects.toThrow();
      expect(await repo.cases.findById(record.id)).toMatchObject({ state: "Open", version: 1 });
      expect(await entriesForCase()).toEqual([]);

      expect(await repo.cases.updateWithAudit(received, 1, entry("ka-ok"))).toBe(true);
      expect(await repo.cases.findById(record.id)).toMatchObject({ state: "DocumentReceived", version: 2 });
      expect(await entriesForCase()).toEqual([id("ka-ok")]);
      // The same write again is stale and adds nothing.
      expect(await repo.cases.updateWithAudit(received, 1, entry("ka-again"))).toBe(false);
      expect(await entriesForCase()).toEqual([id("ka-ok")]);
    });

    it("lists the audit entries about one client, newest first, with paging", async () => {
      const actor = await seedUser("audit-actor", { officeRole: "Staff", officeStatus: "Active" });
      const mine = await seedClient("audit-mine");
      const other = await seedClient("audit-other");
      const myCase = await seedCase(mine.id, "audit-case");
      const otherCase = await seedCase(other.id, "audit-other-case");
      const myFile = await seedFile(mine.id, "audit-file");
      const member = await seedUser("audit-member");
      const issuer = await seedUser("audit-issuer", { officeRole: "Owner", officeStatus: "Active" });
      const myMembership = { id: id("al-membership-mine"), userId: member.id, clientId: mine.id, status: "Pending" as const, approvedBy: null, approvedAt: null, createdAt: T0 };
      const otherMembership = { ...myMembership, id: id("al-membership-other"), clientId: other.id };
      await repo.memberships.insert(myMembership);
      await repo.memberships.insert(otherMembership);
      const invitationFor = (label: string, targetType: "Client" | "Office", clientId: string | null) => ({
        id: id(label), codeHash: sha(label), targetType, clientId, officeRole: targetType === "Office" ? ("Staff" as const) : null,
        issuedBy: issuer.id, expiresAt: new Date("2099-06-01T00:00:00.000Z"), status: "Issued" as const, redeemedBy: null, redeemedAt: null, createdAt: T0,
      });
      await repo.invitations.insert(invitationFor("al-invitation-mine", "Client", mine.id));
      await repo.invitations.insert(invitationFor("al-invitation-other", "Client", other.id));
      await repo.invitations.insert(invitationFor("al-invitation-office", "Office", null));
      const entryFor = (label: string, targetType: string, targetId: string, occurredAt: string) => ({
        id: id(label), actorUserId: actor.id, action: "audit.test", targetType, targetId, result: "ok" as const, occurredAt: new Date(occurredAt),
      });
      // Appended oldest first. Entries about the client itself, its cases, files, memberships and client invitations are linked to it; the others are not.
      await repo.audit.append(entryFor("al-client", "client", mine.id, "2099-01-01T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-case", "case", myCase.id, "2099-01-02T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-file", "file", myFile.id, "2099-01-03T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-membership", "membership", myMembership.id, "2099-01-04T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-invitation", "invitation", id("al-invitation-mine"), "2099-01-05T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-other-client", "client", other.id, "2099-01-06T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-other-case", "case", otherCase.id, "2099-01-07T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-other-membership", "membership", otherMembership.id, "2099-01-08T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-other-invitation", "invitation", id("al-invitation-other"), "2099-01-09T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-office-invitation", "invitation", id("al-invitation-office"), "2099-01-10T00:00:00.000Z"));
      await repo.audit.append(entryFor("al-unlinked", "file", id("al-no-such-file"), "2099-01-11T00:00:00.000Z"));

      const ids = async (page: { limit: number; offset: number }, clientId: string) => (await repo.audit.list(page, { clientId })).map((row) => row.id);
      expect(await ids(PAGE, mine.id)).toEqual([id("al-invitation"), id("al-membership"), id("al-file"), id("al-case"), id("al-client")]);
      expect(await ids({ limit: 2, offset: 0 }, mine.id)).toEqual([id("al-invitation"), id("al-membership")]);
      expect(await ids({ limit: 2, offset: 2 }, mine.id)).toEqual([id("al-file"), id("al-case")]);
      expect(await ids({ limit: 2, offset: 4 }, mine.id)).toEqual([id("al-client")]);
      expect(await ids(PAGE, other.id)).toEqual([id("al-other-invitation"), id("al-other-membership"), id("al-other-case"), id("al-other-client")]);
      expect(await ids(PAGE, id("al-unknown-client"))).toEqual([]);
      expect(await ids(PAGE, other.id)).not.toContain(id("al-unlinked"));
      expect(await ids(PAGE, other.id)).not.toContain(id("al-office-invitation"));
    });

    it("appends audit entries and metric events", async () => {
      const actor = await seedUser();
      await repo.audit.append({ id: id("l1"), actorUserId: actor.id, action: "file.publish", targetType: "file", targetId: id("f"), result: "ok", occurredAt: new Date("2099-01-01T00:00:00.000Z") });
      await repo.audit.append({ id: id("l2"), actorUserId: null, action: "file.purge", targetType: "file", targetId: id("f"), result: "failed", occurredAt: new Date("2099-01-02T00:00:00.000Z") });
      const listed = (await repo.audit.list({ limit: 500, offset: 0 })).filter((entry) => entry.targetId === id("f"));
      expect(listed.map((entry) => [entry.id, entry.actorUserId, entry.result])).toEqual([[id("l2"), null, "failed"], [id("l1"), actor.id, "ok"]]);
      await expect(repo.metrics.append({ id: id("e1"), name: "intake.accepted", clientId: null, actorKind: "staff", actorUserId: actor.id, attributes: { fileId: id("f"), ok: true, n: 1, none: null }, occurredAt: T0 })).resolves.toBeUndefined();
      await expect(repo.metrics.append({ id: id("e2"), name: "maintenance.finished", clientId: null, actorKind: "system", actorUserId: null, attributes: {}, occurredAt: T0 })).resolves.toBeUndefined();
      await expect(repo.metrics.append({ id: id("e3"), name: "invitation.redeemed", clientId: null, actorKind: null, actorUserId: null, attributes: {}, occurredAt: T0 })).resolves.toBeUndefined();
    });

    it("refuses a metric event whose actor kind and user ID do not agree", async () => {
      const actor = await seedUser("metric-actor");
      const event = { name: "intake.accepted", clientId: null, attributes: {}, occurredAt: T0 };
      await expect(repo.metrics.append({ ...event, id: id("eb1"), actorKind: "staff", actorUserId: null })).rejects.toThrow();
      await expect(repo.metrics.append({ ...event, id: id("eb2"), actorKind: "member", actorUserId: null })).rejects.toThrow();
      await expect(repo.metrics.append({ ...event, id: id("eb3"), actorKind: "system", actorUserId: actor.id })).rejects.toThrow();
      await expect(repo.metrics.append({ ...event, id: id("eb4"), actorKind: null, actorUserId: actor.id })).rejects.toThrow();
    });

    it("tells whether an event was already recorded for a submission of a case, by name", async () => {
      const event = { clientId: null, actorKind: "system" as const, actorUserId: null, occurredAt: T0 };
      await repo.metrics.append({ ...event, id: id("ec1"), name: "case.retrieval_warned", attributes: { caseId: id("kw1"), submittedOn: "2026-08-01", level: "warning" } });
      await repo.metrics.append({ ...event, id: id("ec2"), name: "case.state_changed", attributes: { caseId: id("kw2"), from: null, to: "Open" } });
      expect(await repo.metrics.hasCaseEvent("case.retrieval_warned", id("kw1"), "2026-08-01")).toBe(true);
      expect(await repo.metrics.hasCaseEvent("case.retrieval_warned", id("kw1"), "2026-09-01")).toBe(false);
      expect(await repo.metrics.hasCaseEvent("case.retrieval_warned", id("kw2"), "2026-08-01")).toBe(false);
      expect(await repo.metrics.hasCaseEvent("case.state_changed", id("kw1"), "2026-08-01")).toBe(false);
    });

    it("appends a metric event only when none with the same name, user and client came since the given time", async () => {
      const actor = await seedUser("once-actor");
      const other = await seedUser("once-other");
      const clientId = id("once-client");
      const since = new Date("2026-11-23T00:00:00.000Z");
      const weekly = (eventId: string, userId: string, client: string | null, occurredAt: Date) => ({
        id: id(eventId), name: "active", clientId: client, actorKind: "member" as const, actorUserId: userId, attributes: {}, occurredAt,
      });
      expect(await repo.metrics.appendUnlessSince(weekly("ao1", actor.id, clientId, new Date("2026-11-24T10:00:00.000Z")), since)).toBe(true);
      // The same user and client again in the same week: nothing is appended.
      expect(await repo.metrics.appendUnlessSince(weekly("ao2", actor.id, clientId, new Date("2026-11-25T10:00:00.000Z")), since)).toBe(false);
      // Another client, another user, and the same user with no client are each their own week's first.
      expect(await repo.metrics.appendUnlessSince(weekly("ao3", actor.id, id("once-client-2"), new Date("2026-11-25T10:00:00.000Z")), since)).toBe(true);
      expect(await repo.metrics.appendUnlessSince(weekly("ao4", other.id, clientId, new Date("2026-11-25T10:00:00.000Z")), since)).toBe(true);
      expect(await repo.metrics.appendUnlessSince({ ...weekly("ao5", actor.id, null, new Date("2026-11-25T10:00:00.000Z")), actorKind: "staff" }, since)).toBe(true);
    });

    it("ends the sessions of a user without error when there are none", async () => {
      await expect(repo.sessions.revokeAllForUser(id("nobody"))).resolves.toBeUndefined();
    });
  });
}
