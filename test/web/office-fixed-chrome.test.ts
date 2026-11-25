import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync("src/app/web/styles/app.css", "utf8");
const LAYOUT = readFileSync("src/app/web/layouts/OfficeLayout.tsx", "utf8");
const REVIEW = readFileSync("src/app/web/pages/office/Review.tsx", "utf8");
const STAGED = readFileSync("src/app/web/pages/office/Staged.tsx", "utf8");
const SHELF = readFileSync("src/app/web/pages/office/Shelf.tsx", "utf8");

/** The declaration bodies of every top-level rule for one selector, in source order. */
function ruleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "gm"))].map((match) => match[1] ?? "");
}

/** The first rule for a selector, which holds the desktop declarations. */
function firstRule(css: string, selector: string): string {
  return ruleBodies(css, selector)[0] ?? "";
}

describe("office sidebar", () => {
  it("stays in view on desktop widths: sticky to the top, full viewport height, scrolls itself", () => {
    const desktop = firstRule(CSS, ".sidebar");
    expect(desktop).toMatch(/position:\s*sticky/);
    expect(desktop).toMatch(/top:\s*0/);
    expect(desktop).toMatch(/height:\s*100vh/);
    expect(desktop).toMatch(/overflow-y:\s*auto/);
  });

  it("returns to normal flow at phone width so the layout stacks without a fixed height", () => {
    const phone = ruleBodies(CSS, ".sidebar").slice(1).join("\n");
    expect(phone).toMatch(/position:\s*static/);
    expect(phone).toMatch(/height:\s*auto/);
    expect(phone).toMatch(/overflow:\s*visible|overflow-y:\s*visible/);
  });

  it("is the nav element the layout renders", () => {
    expect(LAYOUT).toMatch(/<nav className="sidebar"/);
  });
});

describe("fixed client banner", () => {
  it("is the only banner style that is sticky", () => {
    expect(firstRule(CSS, ".banner--fixed")).toMatch(/position:\s*sticky/);
    expect(firstRule(CSS, ".banner--fixed")).toMatch(/top:\s*0/);
    expect(firstRule(CSS, ".banner")).not.toMatch(/position:\s*sticky/);
  });

  it("Review decision banner uses the fixed style, inside a card that does not clip it", () => {
    expect(REVIEW).toMatch(/<section className="card card--open" aria-label=\{t\("office\.review\.decision"\)\}>\s*<div className="banner banner--fixed">/);
  });

  it("Shelf client banner uses the fixed style", () => {
    expect(SHELF).toMatch(/<div className="banner banner--fixed" role="status">/);
  });

  it("Staged client group banner uses the fixed style, inside a card that does not clip it", () => {
    expect(STAGED).toMatch(/<div key=\{group\.client\.id\} className="card card--open">\s*<label className="banner banner--fixed">/);
  });

  it("a card with overflow hidden never clips the sticky banner: the cards holding fixed banners are card--open", () => {
    expect(firstRule(CSS, ".card--open")).toMatch(/overflow:\s*visible/);
  });
});

describe("no inline styles (content security policy)", () => {
  it.each([
    ["OfficeLayout", LAYOUT],
    ["Review", REVIEW],
    ["Staged", STAGED],
    ["Shelf", SHELF],
  ])("%s has no style attribute", (_name, source) => {
    expect(source).not.toMatch(/\sstyle=\{/);
    expect(source).not.toMatch(/\sstyle="/);
  });
});
