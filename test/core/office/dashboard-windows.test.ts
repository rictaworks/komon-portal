import { describe, expect, it } from "vitest";
import { dueWindowEnd, retrievalWindowEnd, unreadCutoff, UNREAD_AFTER_DAYS } from "../../../src/core/office/dashboard-windows";

describe("dashboard windows", () => {
  it("shows a document as unread after seven days without an opening", () => {
    expect(UNREAD_AFTER_DAYS).toBe(7);
    expect(unreadCutoff(new Date("2026-11-25T00:00:00Z")).toISOString()).toBe("2026-11-18T00:00:00.000Z");
  });

  it("includes cases whose retrieval deadline is within the caution window", () => {
    // Caution starts 30 days before the deadline; a 60-day deadline therefore starts 30 days earlier still.
    expect(retrievalWindowEnd("2026-11-25", 60)).toBe("2026-10-26");
    expect(retrievalWindowEnd("2026-11-25", 30)).toBe("2026-11-25");
  });

  it("includes open cases due within seven days", () => {
    expect(dueWindowEnd("2026-11-25")).toBe("2026-12-02");
  });
});
