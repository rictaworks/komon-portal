import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { englishTranslator, I18nContext } from "../../src/app/web/i18n";
import en from "../../src/locales/en.json";

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({
    api: {},
    config: { environment: "production", signInAvailable: true },
    me: null,
    refresh: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
  }),
}));

import { ClientPicker } from "../../src/app/web/components/ClientPicker";
import { clientLabel, clientSearchPath, moveActive } from "../../src/app/web/components/client-picker";

function ignore(): void {
  // The markup test never chooses a client.
}

const HINODE = { id: "client-1", code: "C0031", corporateName: "Hinode Logistics", status: "Active" as const };

function render(properties: Partial<Parameters<typeof ClientPicker>[0]>): string {
  return renderToStaticMarkup(
    createElement(I18nContext.Provider, { value: englishTranslator() }, createElement(ClientPicker, { label: "Client", emptyLabel: "All clients", value: null, onChange: ignore, ...properties })),
  );
}

describe("client picker requests", () => {
  it("asks the server for clients matching the typed text, one more than is shown", () => {
    expect(clientSearchPath({ search: "", status: "Active", limit: 20 })).toBe("/api/office/clients?limit=21&offset=0&status=Active");
    expect(clientSearchPath({ search: "Hinode & Co", status: "Active", limit: 20 })).toBe("/api/office/clients?limit=21&offset=0&status=Active&query=Hinode+%26+Co");
    expect(clientSearchPath({ search: "c00", status: null, limit: 20 })).toBe("/api/office/clients?limit=21&offset=0&query=c00");
  });

  it("names a client by its code and its name", () => {
    expect(clientLabel(HINODE)).toBe("C0031 Hinode Logistics");
  });
});

describe("client picker keyboard", () => {
  it("moves through the options with the arrow keys and wraps at both ends", () => {
    expect(moveActive("ArrowDown", -1, 3)).toBe(0);
    expect(moveActive("ArrowDown", 0, 3)).toBe(1);
    expect(moveActive("ArrowDown", 2, 3)).toBe(0);
    expect(moveActive("ArrowUp", 0, 3)).toBe(2);
    expect(moveActive("ArrowUp", -1, 3)).toBe(2);
    expect(moveActive("ArrowUp", 2, 3)).toBe(1);
    expect(moveActive("Home", 2, 3)).toBe(0);
    expect(moveActive("End", 0, 3)).toBe(2);
  });

  it("has no active option when there is nothing to choose", () => {
    expect(moveActive("ArrowDown", -1, 0)).toBe(-1);
    expect(moveActive("ArrowUp", 0, 0)).toBe(-1);
  });
});

describe("ClientPicker", () => {
  it("is a labelled combobox that controls a labelled list of options", () => {
    const html = render({});
    const input = /<input[^>]*>/.exec(html)?.[0] ?? "";
    const inputId = /\sid="([^"]+)"/.exec(input)?.[1];
    const listId = /aria-controls="([^"]+)"/.exec(input)?.[1];
    const hintId = /aria-describedby="([^"]+)"/.exec(input)?.[1];
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('placeholder="All clients"');
    expect(input).not.toContain("aria-activedescendant");
    expect(html).toContain(`<label class="field__label" for="${inputId}">Client</label>`);
    expect(html).toMatch(new RegExp(`<ul[^>]* id="${listId}"[^>]* role="listbox"[^>]* aria-label="Client"`));
    expect(html).toContain(`id="${hintId}"`);
    expect(html).toContain(en.office.clientPicker.hint);
    expect(html).toContain('role="status"');
  });

  it("shows the chosen client and offers to clear it only when one is chosen", () => {
    const empty = render({});
    const chosen = render({ value: HINODE });
    expect(chosen).toContain('value="C0031 Hinode Logistics"');
    expect(chosen).toContain(`aria-label="${en.office.clientPicker.clear}"`);
    expect(empty).toContain('value=""');
    expect(empty).not.toContain(en.office.clientPicker.clear);
  });

  it("shows the hint of the screen in place of the general one", () => {
    const html = render({ hint: "Used when a file has no key." });
    expect(html).toContain("Used when a file has no key.");
    expect(html).not.toContain(en.office.clientPicker.hint);
  });
});
