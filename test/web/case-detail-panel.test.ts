import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/app/web/api/client";
import type { Action } from "../../src/app/web/components/useAction";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import { CaseDetailPanel, type CaseDetailPanelProps } from "../../src/app/web/pages/office/Cases";

function ignore(): void {
  // The markup test never presses a button.
}

const action: Action = { busy: false, error: null, run: () => Promise.resolve(true), clear: ignore };

function render(props: Partial<CaseDetailPanelProps>): string {
  const all: CaseDetailPanelProps = { selectedId: "case-1", record: null, loading: false, error: null, action, onSaved: ignore, onRefused: ignore, onRetry: ignore, ...props };
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(CaseDetailPanel, all)));
}

describe("CaseDetailPanel", () => {
  it("says so and offers a retry when the selected case could not be loaded", () => {
    const html = render({ error: new ApiError(404, "not_found", "case") });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The case could not be loaded.");
    expect(html).toMatch(/<button[^>]*>.*Reload<\/button>/);
  });

  it("shows the loading state, not an error, while the case is being fetched", () => {
    const html = render({ loading: true });
    expect(html).toContain("Loading");
    expect(html).not.toContain('role="alert"');
  });

  it("asks to choose a case when none is selected", () => {
    const html = render({ selectedId: null });
    expect(html).toContain("Open a case from the list to see its progress.");
    expect(html).not.toContain("Reload");
  });
});
