import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../../../src/app/api/auth/pkce";

describe("safeReturnPath", () => {
  it("keeps same-site paths, including their query", () => {
    expect(safeReturnPath("/documents?month=2026-11")).toBe("/documents?month=2026-11");
  });

  it.each([
    ["undefined", undefined],
    ["a relative path", "evil"],
    ["a protocol-relative path", "//evil.example"],
    ["a backslash path", "/\\evil.example"],
    ["a tab after the slash", "/\t/evil.example"],
    ["a newline after the slash", "/\n/evil.example"],
    ["a carriage return", "/\r/evil.example"],
    ["a space", "/ /evil.example"],
    ["non-ASCII characters", "/　/evil"],
    ["an overlong path", `/${"a".repeat(600)}`],
    ["an API path", "/api/auth/logout"],
    ["an API path written with a dot segment", "/./api/x"],
    ["the API root", "/api"],
  ])("refuses %s", (_name, value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
