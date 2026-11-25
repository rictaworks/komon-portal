import { beforeEach, describe, expect, it } from "vitest";
import { CaseService } from "../../../src/core/cases/case-service";
import {
  caseRecord, caseType, client, coreKit, fileRecord, memberActor, staffActor, user,
} from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";

const A1 = "202611240912345678";
const A2 = "202611250912345678";
const staff = staffActor();
const input = { clientId: "c1", caseTypeId: "t1", targetMonth: "2026-11", referenceCode: "SHAHO-2611-01", assigneeId: null, dueOn: "2026-11-30" };

describe("CaseService", () => {
  let repo: MemoryRepository;
  let service: CaseService;

  beforeEach(() => {
    repo = new MemoryRepository();
    repo.clientRows.push(client({ id: "c1" }), client({ id: "c2", code: "C0142" }), client({ id: "c9", code: "C0999", status: "Closed" }));
    repo.caseTypeRows.push(caseType({ id: "t1", kind: "Procedure" }), caseType({ id: "t2", kind: "Payroll", label: "Payroll" }));
    repo.userRows.push(user({ id: "u-staff", officeRole: "Staff", officeStatus: "Active" }));
    service = new CaseService({ repository: repo, ...coreKit(repo) });
  });

  describe("register", () => {
    it("creates an Open case with the next sequence and audits it", async () => {
      const first = await service.register(staff, input);
      const second = await service.register(staff, { ...input, referenceCode: "SHAHO-2611-02" });
      expect(first).toMatchObject({ state: "Open", sequence: 1, version: 1, submittedOn: null });
      expect(second.sequence).toBe(2);
      expect(repo.auditRows.map((row) => [row.action, row.result])).toEqual([["case.register", "ok"], ["case.register", "ok"]]);
      expect(repo.auditRows[0]).toMatchObject({ actorUserId: "u-staff", targetType: "case", targetId: first.id });
    });

    it("is denied to client members and the denial is audited", async () => {
      await expect(service.register(memberActor(), input)).rejects.toThrow("forbidden: staff.operate");
      expect(repo.caseRows).toEqual([]);
      expect(repo.auditRows.map((row) => row.result)).toEqual(["denied"]);
    });

    it.each([
      [{ clientId: "missing" }, "not_found: client"],
      [{ clientId: "c9" }, "invalid_state: client_closed"],
      [{ caseTypeId: "missing" }, "not_found: case_type"],
      [{ targetMonth: "2026-13" }, "invalid_input: target_month"],
      [{ targetMonth: "2026-1" }, "invalid_input: target_month"],
      [{ referenceCode: "Taro Yamada" }, "invalid_input: reference_code"],
      [{ referenceCode: "" }, "invalid_input: reference_code"],
      [{ dueOn: "2026-02-30" }, "invalid_input: due_on"],
      [{ assigneeId: "nobody" }, "invalid_input: assignee"],
    ])("rejects %j", async (override, message) => {
      await expect(service.register(staff, { ...input, ...override })).rejects.toThrow(message);
    });
  });

  describe("markSubmitted", () => {
    beforeEach(() => {
      repo.caseRows.push(caseRecord({ id: "k1" }), caseRecord({ id: "k2", clientId: "c2" }));
    });

    it("records the date and arrival numbers and moves to Submitted", async () => {
      const updated = await service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A1, A2, A1] }, 1);
      expect(updated).toMatchObject({ state: "Submitted", submittedOn: "2026-11-20", version: 2 });
      expect(repo.arrivalRows.map((row) => row.arrivalNumber)).toEqual([A1, A2]);
      expect(repo.metricRows.at(-1)).toMatchObject({ name: "case.state_changed", attributes: { caseId: "k1", from: "Open", to: "Submitted" } });
    });

    it("can be repeated to add another arrival number", async () => {
      await service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A1] }, 1);
      await service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A1, A2] }, 2);
      expect(repo.arrivalRows.map((row) => row.arrivalNumber)).toEqual([A1, A2]);
    });

    it("rejects an arrival number that belongs to another case and changes nothing", async () => {
      repo.arrivalRows.push({ id: "a1", caseId: "k2", arrivalNumber: A1 });
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A2, A1] }, 1)).rejects.toThrow("conflict: arrival_number_taken");
      expect(repo.caseRows[0]).toMatchObject({ state: "Open", submittedOn: null, version: 1 });
      expect(repo.arrivalRows).toHaveLength(1);
    });

    it("applies to procedure cases only", async () => {
      repo.caseRows.push(caseRecord({ id: "k5", caseTypeId: "t2", sequence: 5 }));
      await expect(service.markSubmitted(staff, "k5", { submittedOn: "2026-11-20", arrivalNumbers: [] }, 1)).rejects.toThrow("invalid_state: not_a_procedure");
    });

    it("writes nothing when another case takes the arrival number at the same moment", async () => {
      const original = repo.cases.findByArrivalNumber;
      repo.cases.findByArrivalNumber = async () => null;
      repo.arrivalRows.push({ id: "a1", caseId: "k2", arrivalNumber: A1 });
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A2, A1] }, 1)).rejects.toThrow("conflict: arrival_number_taken");
      repo.cases.findByArrivalNumber = original;
      expect(repo.caseRows[0]).toMatchObject({ state: "Open", submittedOn: null, version: 1 });
      expect(repo.arrivalRows).toHaveLength(1);
      expect(repo.auditRows.filter((row) => row.action === "case.submit")).toEqual([]);
    });

    it("limits the number of arrival numbers in one request", async () => {
      const many = Array.from({ length: 21 }, (_unused, index) => `2026112409123456${String(index).padStart(2, "0")}`);
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: many }, 1)).rejects.toThrow("invalid_input: arrival_number_count");
    });

    it.each(["12345", `${A1}9`, `x${A1}`, `${A1} ${A2}`])("rejects the malformed arrival number %s", async (arrivalNumber) => {
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [arrivalNumber] }, 1)).rejects.toThrow("invalid_input: arrival_number");
    });

    it("rejects a malformed date, a stale version and a finished case", async () => {
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "20 Nov", arrivalNumbers: [] }, 1)).rejects.toThrow("invalid_input: submitted_on");
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [A1] }, 7)).rejects.toThrow("conflict: stale");
      expect(repo.arrivalRows).toEqual([]);
      repo.caseRows[0] = caseRecord({ id: "k1", state: "Closed" });
      await expect(service.markSubmitted(staff, "k1", { submittedOn: "2026-11-20", arrivalNumbers: [] }, 1)).rejects.toThrow("invalid_state: case_terminal");
    });
  });

  describe("close and cancel", () => {
    it("closes from every open state, including a case without documents", async () => {
      for (const state of ["Open", "Submitted", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed"] as const) {
        repo.caseRows = [caseRecord({ id: "k1", state })];
        expect((await service.close(staff, "k1", 1)).state).toBe("Closed");
      }
    });

    it("cancels only from Open, Submitted and MaterialsReceived", async () => {
      for (const state of ["Open", "Submitted", "MaterialsReceived"] as const) {
        repo.caseRows = [caseRecord({ id: "k1", state })];
        expect((await service.cancel(staff, "k1", 1)).state).toBe("Cancelled");
      }
      for (const state of ["Closed", "Cancelled"] as const) {
        repo.caseRows = [caseRecord({ id: "k1", state })];
        await expect(service.cancel(staff, "k1", 1)).rejects.toThrow("invalid_state: case_not_cancellable");
      }
      const linked = {
        DocumentReceived: fileRecord({ id: "f1", caseId: "k1", state: "Staged" }),
        Delivered: fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() }),
        Confirmed: fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() }),
      };
      for (const state of ["DocumentReceived", "Delivered", "Confirmed"] as const) {
        repo.caseRows = [caseRecord({ id: "k1", state })];
        repo.fileRows = [linked[state]];
        repo.receiptRows = state === "Confirmed" ? [{ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: new Date() }] : [];
        await expect(service.cancel(staff, "k1", 1)).rejects.toThrow("invalid_state: case_not_cancellable");
      }
    });

    it("refuses to cancel a case that has a document even when the stored state lags behind", async () => {
      repo.caseRows = [caseRecord({ id: "k1", state: "Open" })];
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", state: "Staged" }));
      await expect(service.cancel(staff, "k1", 1)).rejects.toThrow("invalid_state: case_not_cancellable");
    });

    it("audits a denial with a well-formed target only", async () => {
      await expect(service.close(memberActor(), "x".repeat(500), 1)).rejects.toThrow("forbidden");
      await expect(service.register(memberActor(), input)).rejects.toThrow("forbidden");
      expect(repo.auditRows.map((row) => [row.targetType, row.targetId, row.result])).toEqual([["case", "invalid", "denied"], ["client", "c1", "denied"]]);
    });

    it("rejects a stale version, a finished case and client members", async () => {
      repo.caseRows = [caseRecord({ id: "k1", version: 3 })];
      await expect(service.close(staff, "k1", 2)).rejects.toThrow("conflict: stale");
      await expect(service.cancel(staff, "k1", 2)).rejects.toThrow("conflict: stale");
      await expect(service.close(memberActor(), "k1", 3)).rejects.toThrow("forbidden");
      repo.caseRows = [caseRecord({ id: "k1", state: "Closed" })];
      await expect(service.close(staff, "k1", 1)).rejects.toThrow("invalid_state: case_terminal");
      await expect(service.close(staff, "missing", 1)).rejects.toThrow("not_found: case");
    });
  });

  describe("onFileEvent", () => {
    it("follows the linked files forwards and backwards", async () => {
      repo.caseRows.push(caseRecord({ id: "k1", submittedOn: "2026-11-20", state: "Submitted" }));
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", state: "Staged" }));
      expect((await service.onFileEvent("k1")).state).toBe("DocumentReceived");
      repo.fileRows[0] = fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() });
      expect((await service.onFileEvent("k1")).state).toBe("Delivered");
      repo.receiptRows.push({ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: new Date() });
      expect((await service.onFileEvent("k1")).state).toBe("Confirmed");
      repo.fileRows[0] = fileRecord({ id: "f1", caseId: "k1", state: "Withdrawn", withdrawReason: "WrongFile" });
      expect((await service.onFileEvent("k1")).state).toBe("DocumentReceived");
      repo.fileRows[0] = fileRecord({ id: "f1", caseId: "k1", state: "Trashed", trashedFrom: "Withdrawn", trashedAt: new Date() });
      expect((await service.onFileEvent("k1")).state).toBe("Submitted");
      expect(repo.metricRows.map((row) => row.attributes.to)).toEqual(["DocumentReceived", "Delivered", "Confirmed", "DocumentReceived", "Submitted"]);
    });

    it("audits each automatic state change with the system as actor", async () => {
      repo.caseRows.push(caseRecord({ id: "k1", submittedOn: "2026-11-20", state: "Submitted" }));
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", state: "Staged" }));
      await service.onFileEvent("k1");
      expect(repo.auditRows).toHaveLength(1);
      expect(repo.auditRows[0]).toMatchObject({ actorUserId: null, action: "case.state_change", targetType: "case", targetId: "k1", result: "ok" });
      // Nothing changed, so nothing more is recorded.
      await service.onFileEvent("k1");
      expect(repo.auditRows).toHaveLength(1);
      repo.fileRows[0] = fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() });
      await service.onFileEvent("k1");
      expect(repo.auditRows.map((row) => [row.action, row.actorUserId, row.targetId])).toEqual([
        ["case.state_change", null, "k1"],
        ["case.state_change", null, "k1"],
      ]);
    });

    it("settles on the facts when the files change while a write is in flight", async () => {
      repo.caseRows.push(caseRecord({ id: "k1", submittedOn: "2026-11-20", state: "DocumentReceived" }));
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() }));
      const original = repo.cases.update;
      let first = true;
      repo.cases.update = async (record, expectedVersion) => {
        if (first) {
          first = false;
          // The file is withdrawn right after the summary was read and before the state is written.
          repo.fileRows[0] = fileRecord({ id: "f1", caseId: "k1", state: "Withdrawn", withdrawReason: "WrongFile" });
        }
        return original(record, expectedVersion);
      };
      expect((await service.onFileEvent("k1")).state).toBe("DocumentReceived");
      expect(repo.caseRows[0]?.state).toBe("DocumentReceived");
    });

    it("moves a payroll case to MaterialsReceived on a client submission", async () => {
      repo.caseRows.push(caseRecord({ id: "k1", caseTypeId: "t2" }));
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", direction: "Inbound", state: "Submitted" }));
      expect((await service.onFileEvent("k1")).state).toBe("MaterialsReceived");
    });

    it("changes nothing when the state is already right or the case has ended", async () => {
      repo.caseRows.push(caseRecord({ id: "k1" }), caseRecord({ id: "k2", state: "Closed" }));
      repo.fileRows.push(fileRecord({ id: "f1", caseId: "k2", state: "Staged" }));
      expect(await service.onFileEvent("k1")).toMatchObject({ state: "Open", version: 1 });
      expect(await service.onFileEvent("k2")).toMatchObject({ state: "Closed", version: 1 });
      expect(repo.metricRows).toEqual([]);
    });
  });

  describe("clientView", () => {
    it("exposes only kind, type, target month and state", async () => {
      const view = await service.clientView(caseRecord({ id: "k1", assigneeId: "u-staff", dueOn: "2026-11-30" }));
      expect(view).toEqual({ id: "k1", kind: "Procedure", typeLabel: "Social insurance", targetMonth: "2026-11", state: "Open" });
    });
  });
});
