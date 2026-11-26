import { describe, expect, it } from "vitest";
import en from "../../src/locales/en.json";
import { LIST_LIMIT, rowsOutside } from "../../src/app/web/pages/office/list-limit";
import { stagedFilesPath } from "../../src/app/web/pages/office/staged-filter";

describe("office list limit", () => {
  it("asks for the largest page the API serves", () => {
    expect(LIST_LIMIT).toBe(200);
    expect(stagedFilesPath({ clientId: "", docType: "" })).toContain(`limit=${LIST_LIMIT}`);
  });

  it("counts the rows of the total that the screen does not hold", () => {
    expect(rowsOutside(200, 250)).toBe(50);
    expect(rowsOutside(3, 3)).toBe(0);
    expect(rowsOutside(0, 0)).toBe(0);
  });
});

describe("office staged labels", () => {
  it("says the send-back action moves the document to Review, as the mock does", () => {
    expect(en.office.staged.sendBack).toBe("Send back to Review");
  });
});
