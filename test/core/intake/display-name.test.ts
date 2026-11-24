import { describe, expect, it } from "vitest";
import { buildDisplayName } from "../../../src/core/intake/display-name";
import { addDays, daysBetween, localDateOf } from "../../../src/core/time/local-date";

describe("buildDisplayName", () => {
  it("joins client code, short code, date and sequence", () => {
    expect(buildDisplayName({ clientCode: "C0031", shortCode: "SHAHO", receivedOn: "2026-11-24", sequence: 1 })).toBe("C0031_SHAHO_20261124_01");
  });

  it("uses UNCLASSIFIED and UNASSIGNED when type or client is unknown", () => {
    expect(buildDisplayName({ clientCode: "C0031", shortCode: null, receivedOn: "2026-11-24", sequence: 12 })).toBe("C0031_UNCLASSIFIED_20261124_12");
    expect(buildDisplayName({ clientCode: null, shortCode: null, receivedOn: "2026-11-24", sequence: 123 })).toBe("UNASSIGNED_UNCLASSIFIED_20261124_123");
  });
});

describe("local dates", () => {
  it("uses the office time zone for the calendar day", () => {
    const instant = new Date("2026-11-23T15:30:00.000Z");
    expect(localDateOf(instant, "Asia/Tokyo")).toBe("2026-11-24");
    expect(localDateOf(instant, "UTC")).toBe("2026-11-23");
    expect(localDateOf(new Date("2026-11-23T14:59:59.000Z"), "Asia/Tokyo")).toBe("2026-11-23");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-09-03", 90)).toBe("2026-12-02");
  });

  it("counts calendar days between two dates", () => {
    expect(daysBetween("2026-11-24", "2026-11-24")).toBe(0);
    expect(daysBetween("2026-11-24", "2026-12-02")).toBe(8);
    expect(daysBetween("2026-11-24", "2026-11-18")).toBe(-6);
  });

  it("rejects malformed dates and time zones", () => {
    expect(() => addDays("2026-13-01", 1)).toThrow("invalid_input: local_date");
    expect(() => daysBetween("x", "2026-01-01")).toThrow("invalid_input: local_date");
    expect(() => localDateOf(new Date(), "Mars/Base")).toThrow("invalid_input: timezone");
  });
});
