import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsView } from "../../src/app/web/api/office-types";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import en from "../../src/locales/en.json";

const state = vi.hoisted(() => ({ loads: [] as unknown[], role: "Staff" }));

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({
    api: {},
    me: { user: { displayName: "Test User", officeRole: state.role } },
    signOut: () => Promise.resolve(),
  }),
}));

// OfficeLayout calls useLoad twice: first the dashboard counts, then the office settings.
vi.mock("../../src/app/web/components/useLoad", () => ({
  useLoad: () => state.loads.shift(),
}));

import { OfficeLayout } from "../../src/app/web/layouts/OfficeLayout";

type Loaded = { data: unknown; error: unknown; loading: boolean; reload(): void };

function loaded(data: unknown, error: unknown = null): Loaded {
  return { data, error, loading: false, reload: () => undefined };
}

function settings(officeName: string | null): SettingsView {
  return {
    office: { officeName, timezone: "Asia/Tokyo", arrivalNumberPattern: "", retrievalDeadlineDays: 5, autoPublishEnabled: false, jevThreshold: 0.8, version: 1 },
    canEditOffice: true,
    docTypes: [],
    docRules: [],
    caseTypes: [],
    notifications: { pushConfigured: false },
  };
}

function render(officeSettings: Loaded): string {
  state.loads = [loaded({ needsReview: 0, staged: 0 }), officeSettings];
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: englishTranslator() },
      createElement(MemoryRouter, { initialEntries: ["/office/dashboard"] }, createElement(OfficeLayout)),
    ),
  );
}

/** The text of each span in the sidebar footer, in display order. */
function footerLines(html: string): string[] {
  const foot = /<div class="sidebar__foot">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return [...foot.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((match) => match[1] ?? "");
}

describe("OfficeLayout sidebar", () => {
  beforeEach(() => {
    state.role = "Staff";
  });

  it("shows the office name between the user name and the role", () => {
    expect(footerLines(render(loaded(settings("Komon Office"))))).toEqual(["Test User", "Komon Office", en.office.role.staff]);
  });

  it("asks for the office name when it is unset", () => {
    expect(footerLines(render(loaded(settings(null))))).toEqual(["Test User", en.office.officeNameUnset, en.office.role.staff]);
  });

  it("says the office name could not be loaded when the settings request fails", () => {
    const html = render(loaded(null, new Error("network")));
    expect(footerLines(html)).toEqual(["Test User", en.office.officeNameLoadFailed, en.office.role.staff]);
  });

  it("shows no office line while the settings are still loading", () => {
    expect(footerLines(render(loaded(null)))).toEqual(["Test User", en.office.role.staff]);
  });

  it("shows the Owner role label for an Owner", () => {
    state.role = "Owner";
    expect(footerLines(render(loaded(settings("Komon Office"))))).toEqual(["Test User", "Komon Office", en.office.role.owner]);
  });
});
