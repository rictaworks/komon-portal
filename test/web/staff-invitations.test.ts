import { describe, expect, it } from "vitest";
import type { InvitationView } from "../../src/app/web/api/office-types";
import { outstandingInvitations } from "../../src/app/web/pages/office/staff-invitations";

const NOW = new Date("2026-11-25T10:00:00Z");
const HOUR = 60 * 60 * 1000;

function invitation(id: string, status: string, expiresAt: Date): InvitationView {
  return { id, targetType: "Office", clientId: null, officeRole: "Staff", expiresAt: expiresAt.toISOString(), status };
}

describe("outstandingInvitations", () => {
  it("keeps only issued invitations that have not expired at the given moment", () => {
    const listed = [
      invitation("open", "Issued", new Date(NOW.getTime() + HOUR)),
      invitation("used", "Redeemed", new Date(NOW.getTime() + HOUR)),
      invitation("cancelled", "Cancelled", new Date(NOW.getTime() + HOUR)),
      invitation("expired-status", "Expired", new Date(NOW.getTime() + HOUR)),
      invitation("past-expiry", "Issued", new Date(NOW.getTime() - HOUR)),
      invitation("at-expiry", "Issued", NOW),
    ];
    expect(outstandingInvitations(listed, NOW).map((row) => row.id)).toEqual(["open"]);
  });

  it("refuses an expiry that is not a time instead of hiding the invitation", () => {
    expect(() => outstandingInvitations([{ ...invitation("broken", "Issued", NOW), expiresAt: "soon" }], NOW)).toThrow("invalid invitation expiry: broken");
  });
});
