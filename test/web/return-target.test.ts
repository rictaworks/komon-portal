import { describe, expect, it } from "vitest";
import { returnTarget } from "../../src/app/web/return-target";

describe("returnTarget", () => {
  it("keeps the query so that a filtered deep link returns to the same view", () => {
    expect(returnTarget("/office/review", "?status=needs-review")).toBe("/office/review?status=needs-review");
    expect(returnTarget("/documents", "")).toBe("/documents");
  });
});
