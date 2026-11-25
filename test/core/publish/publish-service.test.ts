import { beforeEach, describe, expect, it } from "vitest";
import { caseRecord, client, fileRecord, memberActor, staffActor } from "../../support/builders";
import { intakeKit, type IntakeKit } from "../../support/intake-kit";

const staff = staffActor();
const owner = staffActor("Owner", "u-owner");

describe("PublishService.publish", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", state: "DocumentReceived" }));
    kit.repo.fileRows.push(
      fileRecord({ id: "f1", clientId: "c1", caseId: "k1" }),
      fileRecord({ id: "f2", clientId: "c1", sha256: "b".repeat(64) }),
      fileRecord({ id: "f3", clientId: "c2", sha256: "c".repeat(64) }),
    );
  });

  it("publishes the chosen files, notifies each client once and advances the case", async () => {
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f2", version: 1 }, { fileId: "f3", version: 1 }]);
    expect(results).toEqual([
      { fileId: "f1", outcome: "published", clientId: "c1" },
      { fileId: "f2", outcome: "published", clientId: "c1" },
      { fileId: "f3", outcome: "published", clientId: "c2" },
    ]);
    expect(kit.repo.fileRows.map((row) => [row.state, row.version])).toEqual([["Published", 2], ["Published", 2], ["Published", 2]]);
    expect(kit.repo.fileRows[0]?.publishedAt).toEqual(kit.clock.now());
    expect(kit.notifier.notified).toEqual(["c1", "c2"]);
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
    expect(kit.repo.auditRows.filter((row) => row.action === "file.publish")).toHaveLength(3);
  });

  it("skips files that fail the re-check and still publishes the others", async () => {
    kit.repo.clientRows[1] = client({ id: "c2", code: "C0142", status: "Archived" });
    kit.repo.fileRows.push(fileRecord({ id: "f4", clientId: "c1", state: "NeedsReview", reviewReason: "SentBack", sha256: "d".repeat(64) }));
    const results = await kit.publish.publish(staff, [
      { fileId: "missing", version: 1 },
      { fileId: "f4", version: 1 },
      { fileId: "f3", version: 1 },
      { fileId: "f2", version: 9 },
      { fileId: "f1", version: 1 },
    ]);
    expect(results).toEqual([
      { fileId: "missing", outcome: "skipped", reason: "not_found" },
      { fileId: "f4", outcome: "skipped", reason: "not_staged" },
      { fileId: "f3", outcome: "skipped", reason: "client_not_active" },
      { fileId: "f2", outcome: "skipped", reason: "stale" },
      { fileId: "f1", outcome: "published", clientId: "c1" },
    ]);
    expect(kit.repo.fileRows.map((row) => row.state)).toEqual(["Published", "Staged", "Staged", "NeedsReview"]);
    expect(kit.notifier.notified).toEqual(["c1"]);
  });

  it("does not publish the same file twice", async () => {
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f1", version: 1 }]);
    expect(results.map((result) => result.outcome)).toEqual(["published", "skipped"]);
  });

  it("keeps the files published when the notification fails", async () => {
    kit.notifier.failFor = "c1";
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f3", version: 1 }]);
    expect(results.map((result) => result.outcome)).toEqual(["published", "published"]);
    expect(kit.notifier.notified).toEqual(["c2"]);
    expect(kit.repo.metricRows.find((row) => row.name === "notify.failed")).toMatchObject({ clientId: "c1" });
  });

  it("still reports a file as published, with a warning, when recording it fails, and goes on", async () => {
    const original = kit.repo.audit.append;
    let failures = 1;
    kit.repo.audit.append = async (entry) => {
      if (entry.action === "file.publish" && failures > 0) {
        failures -= 1;
        throw new Error("audit unavailable");
      }
      await original(entry);
    };
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f3", version: 1 }]);
    expect(results).toEqual([
      { fileId: "f1", outcome: "published", clientId: "c1", warning: "followup_failed" },
      { fileId: "f3", outcome: "published", clientId: "c2" },
    ]);
    expect(kit.notifier.notified).toEqual(["c1", "c2"]);
  });

  it("does not hide a write error other than a stale version", async () => {
    kit.repo.files.update = async () => "duplicate_content";
    await expect(kit.publish.publish(staff, [{ fileId: "f1", version: 1 }])).rejects.toThrow("conflict: duplicate_content");
  });

  it("is denied to client members", async () => {
    await expect(kit.publish.publish(memberActor(), [{ fileId: "f1", version: 1 }])).rejects.toThrow("forbidden");
    expect(kit.repo.fileRows[0]?.state).toBe("Staged");
  });
});

describe("PublishService.autoPublishIfEligible", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.setting = { ...kit.repo.setting, autoPublishEnabled: true };
  });

  it("publishes when the method is ArrivalNumber, the type is decided and the client is Active", async () => {
    kit.repo.fileRows.push(fileRecord({ id: "f1", resolutionMethod: "ArrivalNumber", docTypeId: "d1", typeSource: "Rule" }));
    expect(await kit.publish.autoPublishIfEligible("f1")).toBe(true);
    expect(kit.repo.fileRows[0]?.state).toBe("Published");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ action: "file.auto_publish", actorUserId: null });
    expect(kit.notifier.notified).toEqual(["c1"]);
  });

  it.each([
    ["automatic publishing is off", { resolutionMethod: "ArrivalNumber", docTypeId: "d1" }, false, "c1"],
    ["the method is ClientCode", { resolutionMethod: "ClientCode", docTypeId: "d1" }, true, "c1"],
    ["the method is StaffSelected", { resolutionMethod: "StaffSelected", docTypeId: "d1" }, true, "c1"],
    ["the type is not decided", { resolutionMethod: "ArrivalNumber", docTypeId: null }, true, "c1"],
    ["the client is not Active", { resolutionMethod: "ArrivalNumber", docTypeId: "d1" }, true, "c3"],
    ["the file needs review", { resolutionMethod: "ArrivalNumber", docTypeId: "d1", state: "NeedsReview", reviewReason: "SentBack" }, true, "c1"],
  ] as const)("does not publish when %s", async (_name, overrides, enabled, clientId) => {
    kit.repo.setting = { ...kit.repo.setting, autoPublishEnabled: enabled };
    kit.repo.fileRows.push(fileRecord({ id: "f1", clientId, ...overrides }));
    expect(await kit.publish.autoPublishIfEligible("f1")).toBe(false);
    expect(kit.repo.fileRows[0]?.state).not.toBe("Published");
    expect(kit.notifier.notified).toEqual([]);
  });

  it("is off by default", () => {
    expect(intakeKit().repo.setting.autoPublishEnabled).toBe(false);
  });
});

describe("PublishService.withdraw", () => {
  let kit: IntakeKit;

  beforeEach(() => {
    kit = intakeKit();
    kit.repo.caseRows.push(caseRecord({ id: "k1", clientId: "c1", state: "Delivered" }));
    kit.repo.fileRows.push(fileRecord({ id: "f1", caseId: "k1", state: "Published", publishedAt: new Date() }));
  });

  it("returns the file to review, keeps the reason and rolls the case back", async () => {
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "Superseded", next: "NeedsReview" }, 1);
    expect(updated).toMatchObject({ state: "NeedsReview", reviewReason: "Withdrawn", withdrawReason: "Superseded", incidentFlag: false, version: 3 });
    expect(kit.repo.caseRows[0]?.state).toBe("DocumentReceived");
    expect(kit.repo.auditRows.at(-1)).toMatchObject({ action: "file.withdraw", targetId: "f1" });
  });

  it("can send the file to the trash", async () => {
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Trashed" }, 1);
    expect(updated).toMatchObject({ state: "Trashed", trashedFrom: "Withdrawn", withdrawReason: "Other" });
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
  });

  it.each([
    ["WrongClient", true],
    ["WrongFile", true],
    ["Superseded", false],
    ["Other", false],
  ] as const)("flags a mis-delivery for %s only when the file had been opened", async (reason, incident) => {
    kit.repo.receiptRows.push({ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: new Date() });
    const updated = await kit.publish.withdraw(staff, "f1", { reason, next: "NeedsReview" }, 1);
    expect(updated.incidentFlag).toBe(incident);
  });

  it("counts a receipt written while the withdrawal is in progress", async () => {
    const original = kit.repo.files.update;
    kit.repo.files.update = async (file, expectedVersion) => {
      const result = await original(file, expectedVersion);
      if (file.state === "Withdrawn") {
        // A member's receipt lands right after the file was hidden.
        kit.repo.receiptRows.push({ id: "x-late", fileId: "f1", userId: "u-member", firstViewedAt: new Date() });
      }
      return result;
    };
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
    expect(updated.incidentFlag).toBe(true);
  });

  it("can finish a withdrawal that stopped halfway", async () => {
    const original = kit.repo.files.update;
    let calls = 0;
    kit.repo.files.update = async (file, expectedVersion) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("database unavailable");
      }
      return original(file, expectedVersion);
    };
    await expect(kit.publish.withdraw(staff, "f1", { reason: "WrongFile", next: "NeedsReview" }, 1)).rejects.toThrow("database unavailable");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "Withdrawn", withdrawReason: "WrongFile", version: 2 });
    kit.repo.files.update = original;
    const settled = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "NeedsReview" }, 2);
    expect(settled).toMatchObject({ state: "NeedsReview", withdrawReason: "WrongFile", version: 3 });
    expect(kit.repo.caseRows[0]?.state).toBe("DocumentReceived");
  });

  it("keeps the withdrawal when recording it fails", async () => {
    kit.repo.audit.append = async () => {
      throw new Error("audit unavailable");
    };
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Trashed" }, 1);
    expect(updated.state).toBe("Trashed");
    expect(kit.repo.caseRows[0]?.state).toBe("Open");
  });

  it("does not flag an unopened file", async () => {
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
    expect(updated.incidentFlag).toBe(false);
  });

  it("rejects a missing reason, a stale version and files that are not published", async () => {
    await expect(kit.publish.withdraw(staff, "f1", { reason: "Because" as never, next: "NeedsReview" }, 1)).rejects.toThrow("invalid_input: withdraw");
    await expect(kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Published" as never }, 1)).rejects.toThrow("invalid_input: withdraw");
    await expect(kit.publish.withdraw(staff, "f1", { reason: "Other", next: "NeedsReview" }, 4)).rejects.toThrow("conflict: stale");
    kit.repo.fileRows[0] = fileRecord({ id: "f1", state: "Staged" });
    await expect(kit.publish.withdraw(staff, "f1", { reason: "Other", next: "NeedsReview" }, 1)).rejects.toThrow("invalid_state: not_published");
    await expect(kit.publish.withdraw(memberActor(), "f1", { reason: "Other", next: "NeedsReview" }, 1)).rejects.toThrow("forbidden");
  });

  it("shows incidents with who opened the file and when, to the Owner only", async () => {
    const viewedAt = new Date("2026-11-19T01:42:00.000Z");
    kit.repo.receiptRows.push({ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: viewedAt });
    await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
    const incidents = await kit.publish.listIncidents(owner);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.file).toMatchObject({ id: "f1", withdrawReason: "WrongClient", incidentFlag: true });
    expect(incidents[0]?.receipts).toEqual([{ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: viewedAt }]);
    await expect(kit.publish.listIncidents(staff)).rejects.toThrow("forbidden: incident.read");
  });
});
