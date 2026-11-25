import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "../../src/app/web/components/ConfirmDialog";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";

function ignore(): void {
  // The markup test never presses a button.
}

function dialog(title: string) {
  return createElement(ConfirmDialog, { key: title, open: false, title, confirmLabel: "Confirm", onConfirm: ignore, onCancel: ignore, children: "Body" });
}

describe("ConfirmDialog", () => {
  it("labels each dialog with its own title when two are on one page", () => {
    const html = renderToStaticMarkup(createElement(I18nContext.Provider, { value: englishTranslator() }, [dialog("Mark this case as closed?"), dialog("Cancel this case?")]));
    const labelled = [...html.matchAll(/<dialog[^>]* aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
    const titles = [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]]);
    expect(titles).toEqual([
      [labelled[0], "Mark this case as closed?"],
      [labelled[1], "Cancel this case?"],
    ]);
    expect(new Set(labelled).size).toBe(2);
  });
});
