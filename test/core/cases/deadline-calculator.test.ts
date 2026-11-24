import { describe, expect, it } from "vitest";
import { DeadlineCalculator } from "../../../src/core/cases/deadline-calculator";
import { addDays } from "../../../src/core/time/local-date";
import { FixedClock } from "../../support/builders";

// 2026-11-24 12:00 in Tokyo
const calculator = new DeadlineCalculator(new FixedClock(new Date("2026-11-24T03:00:00.000Z")));
const setting = { timezone: "Asia/Tokyo", retrievalDeadlineDays: 90 };
const TODAY = "2026-11-24";

function submittedDaysLeft(daysLeft: number): string {
  return addDays(TODAY, daysLeft - 90);
}

describe("DeadlineCalculator.retrievalLevel", () => {
  it.each([
    [31, "ok"],
    [30, "caution"],
    [11, "caution"],
    [10, "warning"],
    [0, "warning"],
    [-1, "expired"],
  ] as const)("with %i days left is %s", (daysLeft, level) => {
    const status = calculator.retrievalLevel({ state: "Submitted", submittedOn: submittedDaysLeft(daysLeft) }, setting);
    expect(status).toEqual({ level, deadline: addDays(TODAY, daysLeft), daysLeft });
  });

  it("uses the configured number of days", () => {
    const status = calculator.retrievalLevel({ state: "Submitted", submittedOn: TODAY }, { ...setting, retrievalDeadlineDays: 5 });
    expect(status).toMatchObject({ level: "warning", daysLeft: 5 });
  });

  it("applies only while the case is Submitted and nothing has arrived", () => {
    for (const state of ["Open", "DocumentReceived", "Delivered", "Confirmed", "Closed", "Cancelled", "MaterialsReceived"] as const) {
      expect(calculator.retrievalLevel({ state, submittedOn: "2026-01-01" }, setting).level).toBe("none");
    }
    expect(calculator.retrievalLevel({ state: "Submitted", submittedOn: null }, setting).level).toBe("none");
  });

  it("uses the calendar day of the office time zone", () => {
    const lateUtc = new DeadlineCalculator(new FixedClock(new Date("2026-11-24T15:30:00.000Z")));
    const submittedOn = addDays("2026-11-25", -90);
    expect(lateUtc.retrievalLevel({ state: "Submitted", submittedOn }, setting).daysLeft).toBe(0);
    expect(lateUtc.retrievalLevel({ state: "Submitted", submittedOn }, { ...setting, timezone: "UTC" }).daysLeft).toBe(1);
  });
});

describe("DeadlineCalculator.dueLevel", () => {
  it.each([
    [8, "ok"],
    [7, "caution"],
    [0, "caution"],
    [-1, "expired"],
  ] as const)("with %i days left is %s", (daysLeft, level) => {
    expect(calculator.dueLevel({ state: "Open", dueOn: addDays(TODAY, daysLeft) }, setting)).toMatchObject({ level, daysLeft });
  });

  it("does not apply without a due date or once the case has ended", () => {
    expect(calculator.dueLevel({ state: "Open", dueOn: null }, setting).level).toBe("none");
    expect(calculator.dueLevel({ state: "Closed", dueOn: "2026-01-01" }, setting).level).toBe("none");
    expect(calculator.dueLevel({ state: "Cancelled", dueOn: "2026-01-01" }, setting).level).toBe("none");
  });
});
