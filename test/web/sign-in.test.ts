import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { I18nContext, englishTranslator } from "../../src/app/web/i18n";
import en from "../../src/locales/en.json";

const session = vi.hoisted(() => ({ signInAvailable: true }));

vi.mock("../../src/app/web/session", () => ({
  useSession: () => ({
    api: {},
    config: { environment: "production", signInAvailable: session.signInAvailable },
    me: null,
    refresh: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
  }),
}));

import { SignIn } from "../../src/app/web/pages/common/SignIn";

function render(): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: englishTranslator() },
      createElement(MemoryRouter, { initialEntries: ["/sign-in"] }, createElement(SignIn)),
    ),
  );
}

describe("SignIn", () => {
  it("guides a first-time visitor to the invitation page, after the Google button", () => {
    session.signInAvailable = true;
    const html = render();
    const google = html.indexOf(en.signIn.google);
    const divider = html.indexOf(`<span class="divider__label">${en.signIn.firstTime}</span>`);
    const guidance = html.indexOf(en.signIn.firstTimeGuide);
    const invitation = html.indexOf('href="/redeem"');
    expect(google).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(google);
    expect(guidance).toBeGreaterThan(divider);
    expect(invitation).toBeGreaterThan(guidance);
    expect(html).toContain(`>${en.signIn.haveInvitation}</a>`);
  });

  it("keeps the first-time guidance when Google sign-in is not configured", () => {
    session.signInAvailable = false;
    const html = render();
    expect(html).toContain(en.signIn.notConfigured);
    expect(html).toContain(en.signIn.firstTimeGuide);
    expect(html).toContain('href="/redeem"');
  });

  it("puts the Font Awesome Google mark on the sign-in button", () => {
    session.signInAvailable = true;
    const html = render();
    const button = /<a class="button button--block" href="\/api\/auth\/login\?return=%2F">(.*?)<\/a>/.exec(html);
    expect(button).not.toBeNull();
    expect(button?.[1]).toContain('data-prefix="fab"');
    expect(button?.[1]).toContain('data-icon="google"');
    expect(button?.[1]).toContain('aria-hidden="true"');
  });

  it("renders no inline style", () => {
    session.signInAvailable = true;
    expect(render()).not.toContain("style=");
  });
});
