import { describe, expect, it } from "vitest";
import { createTranslator } from "../../src/app/web/i18n";

describe("createTranslator", () => {
  const t = createTranslator({ a: { b: "Hello {name}" }, plain: "Plain" });

  it("resolves dotted keys", () => {
    expect(t("plain")).toBe("Plain");
  });

  it("replaces parameters", () => {
    expect(t("a.b", { name: "C0031" })).toBe("Hello C0031");
  });

  it("throws on a missing key instead of falling back", () => {
    expect(() => t("a.missing")).toThrow("Missing message: a.missing");
  });

  it("throws on a missing parameter", () => {
    expect(() => t("a.b")).toThrow("Missing parameter name for message a.b");
  });
});
