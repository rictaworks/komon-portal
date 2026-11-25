import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StaffList } from "../../src/app/web/api/office-types";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";

const fixture = vi.hoisted(() => ({ staff: null as unknown }));

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({ api: {}, me: { user: { id: "owner-1", officeRole: "Owner" } } }),
}));

vi.mock("../../src/app/web/components/useLoad", () => ({
  useLoad: () => ({ data: fixture.staff, error: null, loading: false, reload: () => undefined }),
}));

import { StaffSection } from "../../src/app/web/pages/office/Settings";

const APPROVED = "2026-11-20T09:00:00.000Z";
const REDEEMED = "2026-11-21T09:30:00.000Z";
const LATER = "2026-12-31T00:00:00.000Z";

function render(staff: StaffList): string {
  fixture.staff = staff;
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(StaffSection)));
}

function member(overrides: Partial<StaffList["members"][number]>): StaffList["members"][number] {
  return { userId: "u-1", displayName: "Staff Member", officeRole: "Staff", officeStatus: "Pending", redeemedAt: null, approvedAt: null, ...overrides };
}

describe("StaffSection", () => {
  it("shows the unknown-use-time text before Approve and Reject for a pending member who was never recorded as redeeming", () => {
    const html = render({ members: [member({ redeemedAt: null })], invitations: [] });
    const text = "The time the invitation was used is not recorded.";
    expect(html).toContain(text);
    expect(html.indexOf(text)).toBeLessThan(html.indexOf("Approve"));
    expect(html.indexOf(text)).toBeLessThan(html.indexOf("Reject"));
  });

  it("shows the use time before Approve and Reject for a pending member who redeemed an invitation", () => {
    const html = render({ members: [member({ redeemedAt: REDEEMED })], invitations: [] });
    expect(html).toContain("Used an invitation on ");
    expect(html).not.toContain("The time the invitation was used is not recorded.");
    expect(html.indexOf("Used an invitation on ")).toBeLessThan(html.indexOf("Approve"));
  });

  it("shows Active since for an active member with an approval time, and nothing for one without", () => {
    const withTime = render({ members: [member({ officeStatus: "Active", redeemedAt: REDEEMED, approvedAt: APPROVED })], invitations: [] });
    expect(withTime).toMatch(/<span class="muted">Active since [^<]+<\/span>/);
    const withoutTime = render({ members: [member({ officeStatus: "Active", approvedAt: null })], invitations: [] });
    expect(withoutTime).not.toContain("Active since");
  });

  it("lists only outstanding invitations, each with a Cancel invitation button", () => {
    const html = render({
      members: [],
      invitations: [
        { id: "inv-open", targetType: "Office", clientId: null, officeRole: "Staff", expiresAt: LATER, status: "Issued" },
        { id: "inv-used", targetType: "Office", clientId: null, officeRole: "Staff", expiresAt: LATER, status: "Redeemed" },
      ],
    });
    expect(html).toContain("Outstanding invitations");
    expect(html.match(/Cancel invitation/g)).toHaveLength(1);
  });
});
