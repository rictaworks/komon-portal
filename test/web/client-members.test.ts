import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({
    api: {},
    config: { environment: "production", signInAvailable: true },
    me: null,
    refresh: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
  }),
}));

import type { ClientListItem } from "../../src/app/web/api/office-types";
import { memberCountKey, PendingApprovals } from "../../src/app/web/pages/office/Clients";

function ignore(): void {
  // The markup test never presses a button.
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, element));
}

/** Text of the markup with tags and icons removed, so that wording is checked apart from structure. */
function textOf(html: string): string {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The member count cell as the list shows it. */
function countText(status: ClientListItem["status"], members: { active: number; pending: number }): string {
  const t = englishTranslator();
  return t(memberCountKey({ status, members }), members);
}

describe("client list member counts", () => {
  it("shows active and pending counts for an active client", () => {
    expect(countText("Active", { active: 1, pending: 0 })).toBe("1 active");
    expect(countText("Active", { active: 2, pending: 1 })).toBe("2 active, 1 pending");
    expect(countText("Active", { active: 0, pending: 1 })).toBe("1 pending");
    expect(countText("Active", { active: 0, pending: 0 })).toBe("No members");
  });

  it("marks an archived client with active members as read only", () => {
    expect(countText("Archived", { active: 1, pending: 0 })).toBe("1 active, read only");
    expect(countText("Archived", { active: 2, pending: 1 })).toBe("2 active, 1 pending, read only");
  });

  it("keeps the plain wording for an archived client without active members", () => {
    expect(countText("Archived", { active: 0, pending: 0 })).toBe("No members");
    expect(countText("Archived", { active: 0, pending: 1 })).toBe("1 pending");
  });

  it("keeps the plain wording for a closed client", () => {
    expect(countText("Closed", { active: 1, pending: 0 })).toBe("1 active");
  });
});

describe("pending approvals callout", () => {
  it("renders nothing when no member is waiting", () => {
    expect(render(createElement(PendingApprovals, { waiting: [], busy: false, onApprove: ignore, onReject: ignore }))).toBe("");
  });

  it("names the one waiting member with the use time and both actions", () => {
    const html = render(
      createElement(PendingApprovals, {
        waiting: [{ membershipId: "m1", displayName: "K. Tanabe", status: "Pending", redeemedAt: "2026-11-24T08:51:00.000Z", approvedAt: null }],
        busy: false,
        onApprove: ignore,
        onReject: ignore,
      }),
    );
    expect(html).toContain('class="notice notice--review"');
    const text = textOf(html);
    expect(text).toContain("1 person is waiting for approval");
    expect(text).toContain("K. Tanabe");
    expect(text).toContain("Approve");
    expect(text).toContain("Reject");
    expect(text).toContain("Used an invitation on 24 Nov 2026");
    expect(text.indexOf("1 person is waiting for approval")).toBeLessThan(text.indexOf("K. Tanabe"));
  });

  it("says when the use time is unknown", () => {
    const html = render(
      createElement(PendingApprovals, {
        waiting: [{ membershipId: "m1", displayName: "K. Tanabe", status: "Pending", redeemedAt: null, approvedAt: null }],
        busy: false,
        onApprove: ignore,
        onReject: ignore,
      }),
    );
    expect(textOf(html)).toContain(englishTranslator()("office.clients.useTimeUnknown"));
  });

  it("counts every waiting member and lists each one", () => {
    const html = render(
      createElement(PendingApprovals, {
        waiting: [
          { membershipId: "m1", displayName: "K. Tanabe", status: "Pending", redeemedAt: null, approvedAt: null },
          { membershipId: "m2", displayName: "H. Ito", status: "Pending", redeemedAt: null, approvedAt: null },
        ],
        busy: true,
        onApprove: ignore,
        onReject: ignore,
      }),
    );
    const text = textOf(html);
    expect(text).toContain("2 people are waiting for approval");
    expect(text).toContain("K. Tanabe");
    expect(text).toContain("H. Ito");
    expect(html.match(/disabled=""/g)?.length).toBe(4);
  });
});
