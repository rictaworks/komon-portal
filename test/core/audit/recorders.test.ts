import { describe, expect, it } from "vitest";
import { ACTIVE_EVENT, MetricRecorder, startOfIsoWeek } from "../../../src/core/audit/recorders";
import { systemActor, type UserActor } from "../../../src/core/model/actor";
import { coreKit, FixedClock, memberActor, SequentialIds, staffActor } from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";

// Wednesday 2026-11-25 is in ISO week 2026-W48, which starts on Monday 2026-11-23.
const WED = new Date("2026-11-25T03:00:00.000Z");
const memberWith = (memberships: UserActor["memberships"]): UserActor => ({
  kind: "user", userId: "u-reader", officeRole: null, officeStatus: null, memberships,
});

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

  describe("weekly activity", () => {
    function recorderAt(repo: MemoryRepository, clock: FixedClock): MetricRecorder {
      return new MetricRecorder(repo.metrics, clock, new SequentialIds());
    }

    it("starts the ISO week on Monday at 00:00 UTC", () => {
      expect(startOfIsoWeek(new Date("2026-11-23T00:00:00.000Z")).toISOString()).toBe("2026-11-23T00:00:00.000Z");
      expect(startOfIsoWeek(WED).toISOString()).toBe("2026-11-23T00:00:00.000Z");
      expect(startOfIsoWeek(new Date("2026-11-29T23:59:59.999Z")).toISOString()).toBe("2026-11-23T00:00:00.000Z");
      expect(startOfIsoWeek(new Date("2026-11-30T00:00:00.000Z")).toISOString()).toBe("2026-11-30T00:00:00.000Z");
    });

    it("records one active event per client a member is active for, and only the first request of a week", async () => {
      const repo = new MemoryRepository();
      const clock = new FixedClock(WED);
      const recorder = recorderAt(repo, clock);
      const reader = memberWith([
        { clientId: "c1", status: "Active", clientStatus: "Active" },
        { clientId: "c2", status: "Pending", clientStatus: "Active" },
        { clientId: "c3", status: "Active", clientStatus: "Active" },
      ]);
      await recorder.recordWeeklyActivity(reader);
      await recorder.recordWeeklyActivity(reader);
      clock.current = new Date("2026-11-29T23:00:00.000Z");
      await recorder.recordWeeklyActivity(reader);
      expect(repo.metricRows.map((row) => [row.name, row.clientId, row.actorKind, row.actorUserId, row.attributes])).toEqual([
        [ACTIVE_EVENT, "c1", "member", "u-reader", {}],
        [ACTIVE_EVENT, "c3", "member", "u-reader", {}],
      ]);
    });

    it("records the next week again, on that week's first request", async () => {
      const repo = new MemoryRepository();
      const clock = new FixedClock(WED);
      const recorder = recorderAt(repo, clock);
      const reader = memberWith([{ clientId: "c1", status: "Active", clientStatus: "Active" }]);
      await recorder.recordWeeklyActivity(reader);
      clock.current = new Date("2026-11-30T00:00:00.000Z");
      await recorder.recordWeeklyActivity(reader);
      expect(repo.metricRows.map((row) => row.occurredAt.toISOString())).toEqual(["2026-11-25T03:00:00.000Z", "2026-11-30T00:00:00.000Z"]);
    });

    it("records an active office member once, with no client", async () => {
      const repo = new MemoryRepository();
      const recorder = recorderAt(repo, new FixedClock(WED));
      await recorder.recordWeeklyActivity(staffActor("Staff", "u-staff"));
      await recorder.recordWeeklyActivity(staffActor("Staff", "u-staff"));
      expect(repo.metricRows.map((row) => [row.name, row.clientId, row.actorKind, row.actorUserId])).toEqual([[ACTIVE_EVENT, null, "staff", "u-staff"]]);
    });

    it("records nothing for an anonymous request, a job, or a user with no active role or membership", async () => {
      const repo = new MemoryRepository();
      const recorder = recorderAt(repo, new FixedClock(WED));
      await recorder.recordWeeklyActivity(null);
      await recorder.recordWeeklyActivity(systemActor());
      await recorder.recordWeeklyActivity(memberWith([{ clientId: "c1", status: "Revoked", clientStatus: "Active" }]));
      await recorder.recordWeeklyActivity({ ...staffActor("Staff", "u-revoked"), officeStatus: "Revoked" });
      expect(repo.metricRows).toEqual([]);
    });
  });
});
