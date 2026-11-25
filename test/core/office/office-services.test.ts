import { beforeEach, describe, expect, it } from "vitest";
import { ClientService } from "../../../src/core/office/client-service";
import { SettingsService } from "../../../src/core/office/settings-service";
import { caseType, client, coreKit, docType, memberActor, staffActor } from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";
import { CORPORATE_NUMBER } from "../intake/fixtures";

const staff = staffActor();
const owner = staffActor("Owner", "u-owner");

describe("ClientService", () => {
  let repo: MemoryRepository;
  let service: ClientService;

  beforeEach(() => {
    repo = new MemoryRepository();
    service = new ClientService({ repository: repo, ...coreKit(repo) });
  });

  it("registers an Active client and audits it", async () => {
    const created = await service.register(staff, { code: "C0031", corporateName: "Hinode Logistics", corporateNumber: CORPORATE_NUMBER });
    expect(created).toMatchObject({ code: "C0031", status: "Active", version: 1 });
    expect(Object.keys(created).sort()).toEqual(["code", "corporateName", "corporateNumber", "id", "status", "version"]);
    expect(repo.auditRows.at(-1)).toMatchObject({ action: "client.register", targetId: created.id });
  });

  it.each([
    [{ code: "C 31" }, "invalid_input: code"],
    [{ code: "" }, "invalid_input: code"],
    [{ code: "C_31" }, "invalid_input: code"],
    [{ corporateName: "  " }, "invalid_input: corporate_name"],
    [{ corporateName: "x".repeat(101) }, "invalid_input: corporate_name"],
    [{ corporateNumber: "1234567890123" }, "invalid_input: corporate_number"],
  ])("rejects %j", async (override, message) => {
    await expect(service.register(staff, { code: "C0031", corporateName: "Hinode", corporateNumber: null, ...override })).rejects.toThrow(message);
  });

  it("refuses a code that is already used, and client members", async () => {
    await service.register(staff, { code: "C0031", corporateName: "One", corporateNumber: null });
    await expect(service.register(staff, { code: "C0031", corporateName: "Two", corporateNumber: null })).rejects.toThrow("conflict: client_code_taken");
    await expect(service.register(memberActor(), { code: "C0099", corporateName: "Three", corporateNumber: null })).rejects.toThrow("forbidden");
  });

  it("follows the status diagram and keeps closing for the Owner", async () => {
    repo.clientRows.push(client({ id: "c1" }));
    const edit = { corporateName: "Hinode Logistics", corporateNumber: null };
    await expect(service.update(staff, "c1", { ...edit, status: "Closed" }, 1)).rejects.toThrow("invalid_state: client_status_transition");
    const archived = await service.update(staff, "c1", { ...edit, status: "Archived" }, 1);
    expect(archived).toMatchObject({ status: "Archived", version: 2 });
    await expect(service.update(staff, "c1", { ...edit, status: "Closed" }, 2)).rejects.toThrow("forbidden: client.close");
    expect((await service.update(staff, "c1", { ...edit, status: "Active" }, 2)).status).toBe("Active");
    await service.update(owner, "c1", { ...edit, status: "Archived" }, 3);
    expect((await service.update(owner, "c1", { ...edit, status: "Closed" }, 4)).status).toBe("Closed");
    await expect(service.update(owner, "c1", { ...edit, status: "Active" }, 5)).rejects.toThrow("invalid_state: client_status_transition");
  });

  it("edits name and number with optimistic locking and never changes the code", async () => {
    repo.clientRows.push(client({ id: "c1" }));
    const updated = await service.update(staff, "c1", { corporateName: "Renamed", corporateNumber: CORPORATE_NUMBER, status: "Active" }, 1);
    expect(updated).toMatchObject({ code: "C0031", corporateName: "Renamed", corporateNumber: CORPORATE_NUMBER });
    await expect(service.update(staff, "c1", { corporateName: "Again", corporateNumber: null, status: "Active" }, 1)).rejects.toThrow("conflict: stale");
    await expect(service.update(staff, "missing", { corporateName: "X", corporateNumber: null, status: "Active" }, 1)).rejects.toThrow("not_found: client");
  });
});

describe("SettingsService", () => {
  let repo: MemoryRepository;
  let service: SettingsService;
  const input = { timezone: "Asia/Tokyo", arrivalNumberPattern: "[0-9]{17,18}", retrievalDeadlineDays: 90, autoPublishEnabled: true, jevThreshold: 0.95 };

  beforeEach(() => {
    repo = new MemoryRepository();
    service = new SettingsService({ repository: repo, ...coreKit(repo) });
  });

  it("lets only the Owner change office settings", async () => {
    await expect(service.updateOffice(staff, input, 1)).rejects.toThrow("forbidden: office.settings.update");
    expect(await service.updateOffice(owner, input, 1)).toMatchObject({ autoPublishEnabled: true, jevThreshold: 0.95, version: 2 });
    expect(repo.auditRows.at(-1)).toMatchObject({ action: "setting.update", result: "ok" });
    await expect(service.updateOffice(owner, input, 1)).rejects.toThrow("conflict: stale");
  });

  it.each([
    [{ jevThreshold: 0.79 }, "invalid_input: jev_threshold"],
    [{ jevThreshold: 1.01 }, "invalid_input: jev_threshold"],
    [{ jevThreshold: Number.NaN }, "invalid_input: jev_threshold"],
    [{ retrievalDeadlineDays: 0 }, "invalid_input: retrieval_deadline_days"],
    [{ retrievalDeadlineDays: 1.5 }, "invalid_input: retrieval_deadline_days"],
    [{ retrievalDeadlineDays: 366 }, "invalid_input: retrieval_deadline_days"],
    [{ timezone: "Mars/Base" }, "invalid_input: timezone"],
    [{ arrivalNumberPattern: "([0-9]+)+" }, "invalid_input: arrival_number_pattern"],
  ])("rejects %j", async (override, message) => {
    await expect(service.updateOffice(owner, { ...input, ...override }, 1)).rejects.toThrow(message);
    expect(repo.setting.version).toBe(1);
  });

  it("accepts the lowest and highest threshold", async () => {
    expect((await service.updateOffice(owner, { ...input, jevThreshold: 0.8 }, 1)).jevThreshold).toBe(0.8);
    expect((await service.updateOffice(owner, { ...input, jevThreshold: 1 }, 2)).jevThreshold).toBe(1);
  });

  it("lets staff manage document types and rules", async () => {
    const created = await service.addDocType(staff, { label: "Social insurance notice", shortCode: "SHAHO", direction: "Outbound" });
    await expect(service.addDocType(staff, { label: "Other", shortCode: "SHAHO", direction: "Both" })).rejects.toThrow("conflict: short_code_taken");
    await expect(service.addDocType(staff, { label: "Other", shortCode: "sha ho", direction: "Both" })).rejects.toThrow("invalid_input: short_code");
    await expect(service.addDocType(staff, { label: "", shortCode: "X", direction: "Both" })).rejects.toThrow("invalid_input: label");
    await expect(service.addDocType(staff, { label: "X", shortCode: "X", direction: "Sideways" as never })).rejects.toThrow("invalid_input: direction");
    expect(await service.updateDocType(staff, created.id, { label: "Renamed", shortCode: "SHAHO2", direction: "Both" })).toMatchObject({ shortCode: "SHAHO2" });
    await expect(service.updateDocType(staff, "missing", { label: "X", shortCode: "X", direction: "Both" })).rejects.toThrow("not_found: doc_type");
    const rule = await service.addRule(staff, { docTypeId: created.id, keyword: "  kettei " });
    expect(rule.keyword).toBe("kettei");
    await expect(service.addRule(staff, { docTypeId: created.id, keyword: " " })).rejects.toThrow("invalid_input: keyword");
    await expect(service.addRule(staff, { docTypeId: "missing", keyword: "x" })).rejects.toThrow("not_found: doc_type");
    await service.removeRule(staff, rule.id);
    expect(repo.ruleRows).toEqual([]);
    await expect(service.removeRule(staff, rule.id)).rejects.toThrow("not_found: doc_rule");
    await expect(service.addDocType(memberActor(), { label: "X", shortCode: "X", direction: "Both" })).rejects.toThrow("forbidden");
  });

  it("links a document type to an existing case type, and removes the link when none is given", async () => {
    repo.caseTypeRows.push(caseType({ id: "t2", kind: "Payroll", label: "Payroll" }));
    const plain = await service.addDocType(staff, { label: "Taxi receipts", shortCode: "TAXI", direction: "Inbound" });
    expect(plain.caseTypeId).toBeNull();
    const linked = await service.addDocType(staff, { label: "Payroll material", shortCode: "KYUYO", direction: "Inbound", caseTypeId: "t2" });
    expect(linked.caseTypeId).toBe("t2");
    expect(repo.docTypeRows.find((row) => row.id === linked.id)?.caseTypeId).toBe("t2");
    await expect(service.addDocType(staff, { label: "X", shortCode: "X", direction: "Inbound", caseTypeId: "missing" })).rejects.toThrow("invalid_input: case_type");
    await expect(service.updateDocType(staff, plain.id, { label: "X", shortCode: "TAXI", direction: "Inbound", caseTypeId: "missing" })).rejects.toThrow("invalid_input: case_type");
    expect(repo.docTypeRows.map((row) => row.shortCode).sort()).toEqual(["KYUYO", "TAXI"]);
    expect((await service.updateDocType(staff, plain.id, { label: "Taxi receipts", shortCode: "TAXI", direction: "Inbound", caseTypeId: "t2" })).caseTypeId).toBe("t2");
    expect((await service.updateDocType(staff, linked.id, { label: "Payroll material", shortCode: "KYUYO", direction: "Inbound" })).caseTypeId).toBeNull();
    expect(repo.docTypeRows.find((row) => row.id === linked.id)?.caseTypeId).toBeNull();
  });

  it("lets staff add and rename case types without changing the kind", async () => {
    repo.docTypeRows.push(docType());
    repo.caseTypeRows.push(caseType({ id: "t1", kind: "Procedure" }));
    const created = await service.addCaseType(staff, { kind: "Payroll", label: "Payroll" });
    expect(created).toMatchObject({ kind: "Payroll", label: "Payroll" });
    expect(await service.renameCaseType(staff, "t1", "Social insurance procedures")).toEqual({ id: "t1", kind: "Procedure", label: "Social insurance procedures" });
    await expect(service.addCaseType(staff, { kind: "Tax" as never, label: "Tax" })).rejects.toThrow("invalid_input: kind");
    await expect(service.renameCaseType(staff, "missing", "X")).rejects.toThrow("not_found: case_type");
    await expect(service.renameCaseType(staff, "t1", "")).rejects.toThrow("invalid_input: label");
  });
});
