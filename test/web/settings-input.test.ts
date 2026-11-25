import { describe, expect, it } from "vitest";
import { copyText, docTypeUpdate, parseJevThreshold, parseOfficeName, submissionCaseTypeOptions, takesSubmissions } from "../../src/app/web/pages/office/settings-input";

describe("parseJevThreshold", () => {
  it("accepts every value the server accepts, including one off the 0.01 grid", () => {
    expect(parseJevThreshold("0.8")).toBe(0.8);
    expect(parseJevThreshold("0.925")).toBe(0.925);
    expect(parseJevThreshold(" 1 ")).toBe(1);
  });

  it("refuses a value outside 0.80 to 1.00 and anything that is not a number", () => {
    expect(parseJevThreshold("0.79")).toBeNull();
    expect(parseJevThreshold("1.01")).toBeNull();
    expect(parseJevThreshold("")).toBeNull();
    expect(parseJevThreshold("0.9x")).toBeNull();
    expect(parseJevThreshold("NaN")).toBeNull();
  });
});

describe("parseOfficeName", () => {
  it("returns the name trimmed when it is 1 to 100 characters", () => {
    expect(parseOfficeName(" Aoba Labor Office ")).toBe("Aoba Labor Office");
    expect(parseOfficeName("事".repeat(100))).toBe("事".repeat(100));
  });

  it("refuses an empty or blank name and one longer than 100 characters", () => {
    expect(parseOfficeName("")).toBeNull();
    expect(parseOfficeName("   ")).toBeNull();
    expect(parseOfficeName("a".repeat(101))).toBeNull();
    expect(parseOfficeName("事".repeat(101))).toBeNull();
  });
});

describe("copyText", () => {
  it("reports success when the clipboard takes the text", async () => {
    const written: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    };
    expect(await copyText(clipboard, "https://portal.example/redeem#code")).toBe(true);
    expect(written).toEqual(["https://portal.example/redeem#code"]);
  });

  it("reports failure when the Clipboard API is missing, as outside a secure context", async () => {
    expect(await copyText(undefined, "link")).toBe(false);
  });

  it("reports failure when the write is refused, by rejection or by a synchronous throw", async () => {
    expect(await copyText({ writeText: () => Promise.reject(new Error("denied")) }, "link")).toBe(false);
    expect(
      await copyText(
        {
          writeText: () => {
            throw new Error("not allowed");
          },
        },
        "link",
      ),
    ).toBe(false);
  });
});

describe("the case type of a document type", () => {
  const caseTypes = [
    { id: "t1", kind: "Procedure" as const, label: "Social insurance" },
    { id: "t2", kind: "Payroll" as const, label: "Monthly payroll" },
    { id: "t3", kind: "Other" as const, label: "Consulting" },
    { id: "t4", kind: "Payroll" as const, label: "Bonus payroll" },
  ];
  const existing = { id: "d1", label: "Payroll material", shortCode: "KYUYO", direction: "Inbound" as const, caseTypeId: null };

  it("offers no case type first and then the monthly (Payroll) case types only", () => {
    expect(submissionCaseTypeOptions(caseTypes, "None")).toEqual([
      { value: "", label: "None" },
      { value: "t2", label: "Monthly payroll" },
      { value: "t4", label: "Bonus payroll" },
    ]);
  });

  it("builds the update of an existing document type: everything kept, the case type set or removed", () => {
    expect(docTypeUpdate(existing, "t2")).toEqual({ label: "Payroll material", shortCode: "KYUYO", direction: "Inbound", caseTypeId: "t2" });
    expect(docTypeUpdate({ ...existing, caseTypeId: "t2" }, "")).toEqual({ label: "Payroll material", shortCode: "KYUYO", direction: "Inbound", caseTypeId: null });
  });

  it("is chosen only for document types a client can submit", () => {
    expect(takesSubmissions({ ...existing, direction: "Inbound" })).toBe(true);
    expect(takesSubmissions({ ...existing, direction: "Both" })).toBe(true);
    expect(takesSubmissions({ ...existing, direction: "Outbound" })).toBe(false);
  });
});
