import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CaseView, Dashboard } from "../../src/app/web/api/office-types";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import { DashboardContent } from "../../src/app/web/pages/office/Dashboard";
import { RETRIEVAL_CAUTION_DAYS } from "../../src/core/cases/deadline-calculator";
import { UNREAD_AFTER_DAYS } from "../../src/core/office/dashboard-windows";

function caseView(id: string): CaseView {
  return {
    id, client: { id: "c1", code: "C0031", corporateName: "Hinode Logistics", status: "Active" }, caseType: { id: "t1", kind: "Procedure", label: "Social insurance" },
    targetMonth: "2026-11", sequence: 1, referenceCode: "SHAHO-2611-01", assignee: null, dueOn: "2026-11-30", submittedOn: "2026-11-01",
    state: "Submitted", retrieval: { level: "expired", deadline: "2026-11-20", daysLeft: -5 }, due: { level: "ok", deadline: "2026-11-30", daysLeft: 5 }, version: 1,
  };
}

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    today: "2026-11-25", timezone: "Asia/Tokyo", needsReview: 0, staged: 0, submitted: 0, submissions: [], unread: [],
    truncated: { unread: false, retrieval: false, due: false, submissions: false }, retrieval: [], due: [], incidents: null, ...overrides,
  };
}

function render(data: Dashboard): string {
  return renderToStaticMarkup(
    createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(MemoryRouter, null, createElement(DashboardContent, { data }))),
  );
}

/** The cards in display order: where each one leads and the number it shows. */
function cards(html: string): { href: string; value: string }[] {
  return [...html.matchAll(/<a ([^>]*)>.*?<span class="stat__value">([^<]*)<\/span>/g)]
    .filter((match) => (match[1] ?? "").includes('class="stat"'))
    .map((match) => ({ href: /href="([^"]+)"/.exec(match[1] ?? "")?.[1] ?? "", value: match[2] ?? "" }));
}

describe("Dashboard", () => {
  it("links every card to the list it summarises", () => {
    const html = render(dashboard());
    expect(cards(html).map((card) => card.href)).toEqual(["/office/review", "/office/staged", "#retrieval", "#unread"]);
    for (const anchor of ["retrieval", "due", "unread"]) {
      expect(html).toContain(`<section class="card" id="${anchor}">`);
    }
  });

  it("has four cards and no Submitted card or list", () => {
    const html = render(dashboard({ submitted: 2, submissions: [{ id: "s1", displayName: "C0031_SHAHO_20261117_03", receivedAt: "2026-11-17T00:00:00.000Z", client: null }] }));
    expect(cards(html)).toHaveLength(4);
    expect(html).not.toContain('id="submissions"');
    expect(html).not.toContain("Submissions from clients");
    expect(html).not.toContain("Submitted</span>");
  });

  it("uses the captions of the mock, with the day windows the core applies", () => {
    const html = render(dashboard());
    expect(html).toContain("documents waiting for a client decision");
    expect(html).toContain("documents ready to publish");
    expect(html).toContain(`cases within ${RETRIEVAL_CAUTION_DAYS} days or expired`);
    expect(html).toContain(`published documents unread for ${UNREAD_AFTER_DAYS} days or more`);
    expect(html).not.toContain("client reads pending");
    expect(html).not.toContain("cases awaiting retrieval");
  });

  it("shows the number of listed items on a card when the list is complete", () => {
    const html = render(dashboard({ retrieval: [caseView("k1"), caseView("k2")], unread: [{ id: "f1", displayName: "C0031_SHAHO_20261117_03", publishedAt: "2026-11-17T00:00:00.000Z", client: null }] }));
    expect(cards(html).slice(2, 4).map((card) => card.value)).toEqual(["2", "1"]);
    expect(html).not.toContain("More match than");
  });

  it("does not pass a capped list off as the total: the card and the list say that more exist", () => {
    const unread = Array.from({ length: 3 }, (_, index) => ({ id: `f${index}`, displayName: `C0031_SHAHO_20261117_0${index}`, publishedAt: "2026-11-17T00:00:00.000Z", client: null }));
    const html = render(dashboard({
      retrieval: [caseView("k1"), caseView("k2")], due: [caseView("k3")], unread,
      truncated: { unread: true, retrieval: true, due: true, submissions: false },
    }));
    expect(cards(html).slice(2, 4).map((card) => card.value)).toEqual(["2+", "3+"]);
    expect(html).toMatch(/<section class="card" id="retrieval">.*?More match than the 2 shown here\./);
    expect(html).toMatch(/<section class="card" id="due">.*?More match than the 1 shown here\./);
    expect(html).toMatch(/<section class="card" id="unread">.*?More match than the 3 shown here\./);
  });
});
