import { describe, expect, it } from "vitest";
import { areaGuard } from "../../src/app/web/area-guard";

describe("areaGuard", () => {
  it("sends a visitor with no session to sign in, whatever the area would allow", () => {
    expect(areaGuard(false, false)).toBe("sign-in");
    expect(areaGuard(false, true)).toBe("sign-in");
  });

  it("refuses a signed-in user the area does not allow, and lets the others in", () => {
    expect(areaGuard(true, false)).toBe("deny");
    expect(areaGuard(true, true)).toBe("allow");
  });
});
