import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "../../src/app/web/api/base64url";

describe("base64UrlToBytes", () => {
  it("decodes the URL-safe alphabet with and without padding", () => {
    // 0xfb 0xff 0xbf encodes to "-_-_" in base64url.
    expect(Array.from(base64UrlToBytes("-_-_"))).toEqual([0xfb, 0xff, 0xbf]);
    expect(Array.from(base64UrlToBytes("AQI"))).toEqual([1, 2]);
  });
});
