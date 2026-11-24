import { describe, expect, it } from "vitest";
import { isValidCorporateNumber } from "../../../src/core/intake/corporate-number";
import { CORPORATE_NUMBER } from "./fixtures";

describe("isValidCorporateNumber", () => {
  it("accepts a number with a correct check digit", () => {
    expect(isValidCorporateNumber(CORPORATE_NUMBER)).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidCorporateNumber("8000012050002")).toBe(false);
    expect(isValidCorporateNumber("7000012050003")).toBe(false);
  });

  it.each(["", "700001205000", "70000120500020", "70000120500a2", "0000000000000"])("rejects the malformed value %s", (value) => {
    expect(isValidCorporateNumber(value)).toBe(false);
  });
});
