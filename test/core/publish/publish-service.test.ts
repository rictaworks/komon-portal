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

  it("writes the audit entry in the same step as the state change", async () => {
    // A separate append would fail here; the entry must arrive together with the new state.
    kit.repo.audit.append = async () => {
      throw new Error("audit unavailable");
    };
    kit.repo.fileRows[0] = fileRecord({ id: "f1", clientId: "c1" });
    const results = await kit.publish.publish(owner, [{ fileId: "f1", version: 1 }]);
    expect(results.map((result) => result.outcome)).toEqual(["published"]);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.publish")).toEqual([
      expect.objectContaining({ actorUserId: "u-owner", targetType: "file", targetId: "f1", result: "ok" }),
    ]);
  });

  it("does not publish a file whose audit entry cannot be written, reports it for that file and goes on", async () => {
    kit.repo.failAuditFor = (entry) => entry.action === "file.publish" && entry.targetId === "f1";
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f3", version: 1 }]);
    expect(results).toEqual([
      { fileId: "f1", outcome: "skipped", reason: "not_recorded" },
      { fileId: "f3", outcome: "published", clientId: "c2" },
    ]);
    expect(kit.repo.fileRows.filter((row) => row.id === "f1" || row.id === "f3").map((row) => [row.id, row.state, row.version])).toEqual([
      ["f1", "Staged", 1],
      ["f3", "Published", 2],
    ]);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.publish").map((row) => row.targetId)).toEqual(["f3"]);
    expect(kit.repo.metricRows.filter((row) => row.name === "file.published").map((row) => row.attributes.fileId)).toEqual(["f3"]);
    expect(kit.repo.metricRows.filter((row) => row.name === "publish.failed")).toEqual([
      expect.objectContaining({ clientId: "c1", attributes: { fileId: "f1", error: "Error" } }),
    ]);
    // Only the client of the file that was published is told.
    expect(kit.notifier.notified).toEqual(["c2"]);
    // The file is still staged, so the same request succeeds once the entry can be written.
    kit.repo.failAuditFor = null;
    expect(await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }])).toEqual([{ fileId: "f1", outcome: "published", clientId: "c1" }]);
  });

  it("does not hide a failed write from an automatic publish", async () => {
    kit.repo.setting = { ...kit.repo.setting, autoPublishEnabled: true };
    kit.repo.fileRows[0] = fileRecord({ id: "f1", clientId: "c1", resolutionMethod: "ArrivalNumber", docTypeId: "d1", typeSource: "Rule" });
    kit.repo.failAuditFor = (entry) => entry.action === "file.auto_publish";
    await expect(kit.publish.autoPublishIfEligible("f1")).rejects.toThrow("audit unavailable");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "Staged", version: 1 });
  });

  it("still reports a file as published, with a warning, when the measurement or the case update fails, and goes on", async () => {
    const original = kit.repo.metrics.append;
    let failures = 1;
    kit.repo.metrics.append = async (event) => {
      if (event.name === "file.published" && failures > 0) {
        failures -= 1;
        throw new Error("metrics unavailable");
      }
      await original(event);
    };
    const results = await kit.publish.publish(staff, [{ fileId: "f1", version: 1 }, { fileId: "f3", version: 1 }]);
    expect(results).toEqual([
      { fileId: "f1", outcome: "published", clientId: "c1", warning: "followup_failed" },
      { fileId: "f3", outcome: "published", clientId: "c2" },
    ]);
    expect(kit.repo.auditRows.filter((row) => row.action === "file.publish").map((row) => row.targetId)).toEqual(["f1", "f3"]);
    expect(kit.notifier.notified).toEqual(["c1", "c2"]);
  });

  it("does not hide a write error other than a stale version", async () => {
    kit.repo.files.updateWithAudit = async () => "duplicate_content";
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
    expect(kit.repo.auditRows.map((row) => [row.action, row.actorUserId, row.targetId])).toEqual([
      ["file.withdraw", "u-staff", "f1"],
      ["case.state_change", null, "k1"],
    ]);
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
    const original = kit.repo.files.updateWithAudit;
    kit.repo.files.updateWithAudit = async (file, expectedVersion, entry) => {
      const result = await original(file, expectedVersion, entry);
      if (file.state === "Withdrawn") {
        // A member's receipt lands right after the file was hidden.
        kit.repo.receiptRows.push({ id: "x-late", fileId: "f1", userId: "u-member", firstViewedAt: new Date() });
      }
      return result;
    };
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
    expect(updated.incidentFlag).toBe(true);
  });

  it("can finish a withdrawal that stopped halfway, with one audit entry for the withdrawal", async () => {
    const original = kit.repo.files.update;
    kit.repo.files.update = async () => {
      throw new Error("database unavailable");
    };
    await expect(kit.publish.withdraw(staff, "f1", { reason: "WrongFile", next: "NeedsReview" }, 1)).rejects.toThrow("database unavailable");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "Withdrawn", withdrawReason: "WrongFile", version: 2 });
    expect(kit.repo.auditRows.filter((row) => row.action === "file.withdraw")).toHaveLength(1);
    kit.repo.files.update = original;
    const settled = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "NeedsReview" }, 2);
    expect(settled).toMatchObject({ state: "NeedsReview", withdrawReason: "WrongFile", version: 3 });
    expect(kit.repo.caseRows[0]?.state).toBe("DocumentReceived");
    expect(kit.repo.auditRows.filter((row) => row.action === "file.withdraw")).toHaveLength(1);
  });

  it("writes the audit entry in the same step that hides the file", async () => {
    // A separate append would fail here; the entry must arrive together with the new state.
    const append = kit.repo.audit.append;
    kit.repo.audit.append = async (entry) => {
      if (entry.action === "file.withdraw") {
        throw new Error("audit unavailable");
      }
      await append(entry);
    };
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Trashed" }, 1);
    expect(updated.state).toBe("Trashed");
    expect(kit.repo.auditRows.filter((row) => row.action === "file.withdraw")).toEqual([
      expect.objectContaining({ actorUserId: "u-staff", targetType: "file", targetId: "f1", result: "ok" }),
    ]);
  });

  it("does not withdraw a file whose audit entry cannot be written", async () => {
    kit.repo.failAuditFor = (entry) => entry.action === "file.withdraw";
    await expect(kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Trashed" }, 1)).rejects.toThrow("audit unavailable");
    expect(kit.repo.fileRows[0]).toMatchObject({ state: "Published", withdrawReason: null, version: 1 });
    expect(kit.repo.caseRows[0]?.state).toBe("Delivered");
    expect(kit.repo.auditRows.filter((row) => row.action === "file.withdraw")).toEqual([]);
    expect(kit.repo.metricRows.filter((row) => row.name === "file.withdrawn")).toEqual([]);
  });

  it("keeps the withdrawal when its measurement fails", async () => {
    const original = kit.repo.metrics.append;
    kit.repo.metrics.append = async (event) => {
      if (event.name === "file.withdrawn") {
        throw new Error("metrics unavailable");
      }
      await original(event);
    };
    const updated = await kit.publish.withdraw(staff, "f1", { reason: "Other", next: "Trashed" }, 1);
    expect(updated.state).toBe("Trashed");
    expect(kit.repo.auditRows.filter((row) => row.action === "file.withdraw")).toHaveLength(1);
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
    const incidents = await kit.publish.listIncidents(owner, 100);
    expect(incidents).toMatchObject({ total: 1, truncated: false });
    expect(incidents.items).toHaveLength(1);
    expect(incidents.items[0]?.file).toMatchObject({ id: "f1", withdrawReason: "WrongClient", incidentFlag: true });
    expect(incidents.items[0]?.receipts).toEqual([{ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: viewedAt }]);
    await expect(kit.publish.listIncidents(staff, 100)).rejects.toThrow("forbidden: incident.read");
  });

  it("keeps the client, reason and readers of the withdrawal after the file is assigned to the right client and published again", async () => {
    const viewedAt = new Date(kit.clock.now().getTime() - 60_000);
    kit.repo.receiptRows.push({ id: "x1", fileId: "f1", userId: "u-member", firstViewedAt: viewedAt });
    const withdrawnAt = kit.clock.now();
    const withdrawn = await kit.publish.withdraw(staff, "f1", { reason: "WrongClient", next: "NeedsReview" }, 1);
    expect(withdrawn).toMatchObject({ incidentFlag: true, incidentClientId: "c1", incidentReason: "WrongClient", incidentAt: withdrawnAt });
    // The office corrects the mistake: the right client gets the file and one of its members opens it.
    kit.clock.advanceDays(1);
    const staged = await kit.review.assign(staff, "f1", { clientId: "c2", caseId: null, confirmed: true }, withdrawn.version);
    expect(await kit.publish.publish(staff, [{ fileId: "f1", version: staged.version }])).toEqual([{ fileId: "f1", outcome: "published", clientId: "c2" }]);
    kit.repo.receiptRows.push({ id: "x2", fileId: "f1", userId: "u-right", firstViewedAt: kit.clock.now() });
    const incidents = await kit.publish.listIncidents(owner, 100);
    expect(incidents.items).toHaveLength(1);
    expect(incidents.items[0]).toMatchObject({ clientId: "c1", reason: "WrongClient", occurredAt: withdrawnAt });
    expect(incidents.items[0]?.file).toMatchObject({ id: "f1", clientId: "c2", state: "Published" });
    expect(incidents.items[0]?.receipts.map((receipt) => receipt.userId)).toEqual(["u-member"]);
    // A later withdrawal that is not a mis-delivery leaves the recorded incident as it was.
    kit.clock.advanceDays(1);
    await kit.publish.withdraw(staff, "f1", { reason: "Superseded", next: "NeedsReview" }, staged.version + 1);
    expect((await kit.publish.listIncidents(owner, 100)).items[0]).toMatchObject({ clientId: "c1", reason: "WrongClient", occurredAt: withdrawnAt });
  });

  it("lists the most recently withdrawn incidents first, whenever the files were taken in", async () => {
    // f-old was taken in long before the others and is withdrawn last.
    kit.repo.fileRows.push(
      fileRecord({ id: "f-new", state: "Published", publishedAt: new Date(), sha256: "b".repeat(64), receivedAt: new Date("2026-11-20T00:00:00.000Z") }),
      fileRecord({ id: "f-old", state: "Published", publishedAt: new Date(), sha256: "c".repeat(64), receivedAt: new Date("2026-10-01T00:00:00.000Z") }),
    );
    for (const id of ["f1", "f-new", "f-old"]) {
      kit.repo.receiptRows.push({ id: `x-${id}`, fileId: id, userId: "u-member", firstViewedAt: new Date("2026-11-19T01:42:00.000Z") });
      await kit.publish.withdraw(staff, id, { reason: "WrongClient", next: "NeedsReview" }, 1);
      kit.clock.advanceDays(1);
    }
    expect((await kit.publish.listIncidents(owner, 100)).items.map((incident) => incident.file.id)).toEqual(["f-old", "f-new", "f1"]);
    const recent = await kit.publish.listIncidents(owner, 1);
    expect(recent).toMatchObject({ total: 3, truncated: true });
    expect(recent.items.map((incident) => incident.file.id)).toEqual(["f-old"]);
  });

  it("refuses to list an incident whose record of the withdrawal is missing", async () => {
    kit.repo.fileRows[0] = fileRecord({ id: "f1", state: "NeedsReview", reviewReason: "Withdrawn", withdrawReason: "WrongClient", incidentFlag: true });
    await expect(kit.publish.listIncidents(owner, 100)).rejects.toThrow("invalid_state: incident_record");
  });

  it("counts every incident and says when more exist than the limit shows", async () => {
    kit.repo.fileRows.push(
      fileRecord({ id: "f2", state: "Published", publishedAt: new Date(), sha256: "b".repeat(64) }),
      fileRecord({ id: "f3", state: "Published", publishedAt: new Date(), sha256: "c".repeat(64) }),
    );
    for (const id of ["f1", "f2", "f3"]) {
      kit.repo.receiptRows.push({ id: `x-${id}`, fileId: id, userId: "u-member", firstViewedAt: new Date("2026-11-19T01:42:00.000Z") });
      await kit.publish.withdraw(staff, id, { reason: "WrongFile", next: "NeedsReview" }, 1);
    }
    const shown = await kit.publish.listIncidents(owner, 2);
    expect(shown).toMatchObject({ total: 3, truncated: true });
    expect(shown.items).toHaveLength(2);
    expect(shown.items.every((incident) => incident.receipts.length === 1 && incident.receipts[0]?.fileId === incident.file.id)).toBe(true);
    expect(await kit.publish.listIncidents(owner, 3)).toMatchObject({ total: 3, truncated: false });
    await expect(kit.publish.listIncidents(owner, 0)).rejects.toThrow("invalid_input: limit");
  });
});
