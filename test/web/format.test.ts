import { describe, expect, it } from "vitest";
import { formatDay, formatDayWithWeekday } from "../../src/app/web/components/format";

describe("formatDayWithWeekday", () => {
  it("shows the weekday before the day, as the dashboard date line does", () => {
    expect(formatDayWithWeekday("2026-11-24")).toBe("Tuesday, 24 November 2026");
  });

  it("reads the calendar day as written, whatever the time zone of the reader", () => {
    expect(formatDayWithWeekday("2026-12-31")).toBe("Thursday, 31 December 2026");
  });

  it("shows nothing when there is no day", () => {
    expect(formatDayWithWeekday(null)).toBe("");
  });

  it("leaves formatDay without a weekday for lists and tables", () => {
    expect(formatDay("2026-11-24")).toBe("24 Nov 2026");
  });
});
