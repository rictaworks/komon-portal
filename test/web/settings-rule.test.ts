import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SettingsView } from "../../src/app/web/api/office-types";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import { OfficeNameReloadContext } from "../../src/app/web/pages/office/office-name-context";
import en from "../../src/locales/en.json";

const state = vi.hoisted(() => ({ loads: [] as unknown[] }));

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({
    api: {},
    me: { user: { displayName: "Test User", officeRole: "Owner" } },
  }),
}));

// Settings calls useLoad for the office settings first; any later call (the staff list) gets nothing.
vi.mock("../../src/app/web/components/useLoad", () => ({
  useLoad: () => state.loads.shift() ?? { data: null, error: null, loading: true, reload: () => undefined },
}));

// The Jev key lives in window.localStorage, which does not exist when the tests run under node.
vi.mock("../../src/app/web/pages/office/jev-settings", () => ({
  loadJevSettings: () => ({ key: "", model: "" }),
  saveJevSettings: () => undefined,
  removeJevSettings: () => undefined,
  isFixedModelName: () => true,
}));

import { Settings } from "../../src/app/web/pages/office/Settings";

const view: SettingsView = {
  office: { officeName: "Komon Office", timezone: "Asia/Tokyo", arrivalNumberPattern: "", retrievalDeadlineDays: 5, autoPublishEnabled: false, jevThreshold: 0.8, version: 1 },
  canEditOffice: true,
  docTypes: [],
  docRules: [],
  caseTypes: [],
  notifications: { pushConfigured: false },
};

function render(): string {
  state.loads = [{ data: view, error: null, loading: false, reload: () => undefined }];
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: englishTranslator() },
      createElement(
        OfficeNameReloadContext.Provider,
        { value: () => undefined },
        createElement(MemoryRouter, null, createElement(Settings)),
      ),
    ),
  );
}

describe("Settings document-type rule explanation", () => {
  it("explains the keyword rule on the document types section", () => {
    const html = render();
    expect(html).toContain(en.office.settings.ruleExplanation);
  });

  it("states that the Jev classifier can set a type the keyword rule leaves open, only at or above the threshold", () => {
    expect(en.office.settings.ruleExplanation).toContain("Jev classifier");
    expect(en.office.settings.ruleExplanation).toContain("only at or above the confidence threshold");
  });
});
