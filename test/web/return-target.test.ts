import { describe, expect, it } from "vitest";
import { returnTarget, signInPath } from "../../src/app/web/return-target";

describe("returnTarget", () => {
  it("keeps the query so that a filtered deep link returns to the same view", () => {
    expect(returnTarget("/office/review", "?status=needs-review")).toBe("/office/review?status=needs-review");
    expect(returnTarget("/documents", "")).toBe("/documents");
  });
});

describe("signInPath", () => {
  it("keeps the page to come back to for a visitor who arrived without a session", () => {
    expect(signInPath(false, "/office/review", "?status=needs-review")).toBe("/sign-in?return=%2Foffice%2Freview%3Fstatus%3Dneeds-review");
  });

  it("drops the page after this tab signed out, so the next person is not sent to the previous user's page", () => {
    expect(signInPath(true, "/office/dashboard", "")).toBe("/sign-in");
    expect(signInPath(true, "/client/company-a/home", "")).toBe("/sign-in");
  });
});
