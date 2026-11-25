import { describe, expect, it } from "vitest";
import { copyText, parseJevThreshold } from "../../src/app/web/pages/office/settings-input";

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
