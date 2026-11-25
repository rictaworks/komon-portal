import { describe, expect, it } from "vitest";
import { systemActor } from "../../../src/core/model/actor";
import { coreKit, memberActor, staffActor } from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";

describe("MetricRecorder", () => {
  it("records who acted as a kind and an internal ID only", async () => {
    const repo = new MemoryRepository();
    const kit = coreKit(repo);
    await kit.metrics.record(staffActor("Owner", "u-owner"), "intake.accepted", "c1", { fileId: "f1" });
    await kit.metrics.record(memberActor(["c1"], "u-m1"), "file.first_viewed", "c1");
    await kit.metrics.record(systemActor(), "maintenance.finished", null);
    await kit.metrics.record(null, "invitation.redeemed", "c1");
    expect(repo.metricRows.map((row) => [row.name, row.actorKind, row.actorUserId])).toEqual([
      ["intake.accepted", "staff", "u-owner"],
      ["file.first_viewed", "member", "u-m1"],
      ["maintenance.finished", "system", null],
      ["invitation.redeemed", null, null],
    ]);
  });

  it("counts a user whose office role is not active as a client member, not as staff", async () => {
    const repo = new MemoryRepository();
    const kit = coreKit(repo);
    await kit.metrics.record({ ...staffActor("Staff", "u-revoked"), officeStatus: "Revoked" }, "submission.received", "c1");
    expect(repo.metricRows[0]).toMatchObject({ actorKind: "member", actorUserId: "u-revoked" });
  });
});
