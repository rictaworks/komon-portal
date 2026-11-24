import { describe, expect, it } from "vitest";
import { extractKeys } from "../../../src/core/intake/key-extractor";
import { CORPORATE_NUMBER, markEncrypted, PDF, zip } from "./fixtures";

const options = { arrivalNumberPattern: "[0-9]{17,18}", clientCodes: ["C0031", "C0142", "AB"] };
const ARRIVAL = "202611240912345678";
const ARRIVAL_2 = "202611250912345678";

function keys(fileName: string, bytes: Uint8Array = PDF, format: "pdf" | "zip" = "pdf") {
  return extractKeys({ fileName, format, bytes }, options);
}

describe("extractKeys from the file name", () => {
  it("reads an arrival number", () => {
    expect(keys(`${ARRIVAL}.pdf`)).toEqual({ arrivalNumbers: [ARRIVAL], clientCodes: [], corporateNumbers: [] });
  });

  it("ignores digit runs that are longer or shorter than the pattern", () => {
    expect(keys(`${ARRIVAL}9.pdf`).arrivalNumbers).toEqual([]);
    expect(keys("2026112409123456.pdf").arrivalNumbers).toEqual([]);
  });

  it("reads several distinct arrival numbers once each", () => {
    expect(keys(`${ARRIVAL}_${ARRIVAL_2}_${ARRIVAL}.pdf`).arrivalNumbers).toEqual([ARRIVAL, ARRIVAL_2]);
  });

  it.each(["C0031_notice.pdf", "C0031-notice.pdf", "C0031 notice.pdf", "C0031.pdf", "folder/C0031_notice.pdf", "folder\\C0031(1).pdf"])(
    "reads a client code as the delimited leading word of %s",
    (fileName) => {
      expect(keys(fileName).clientCodes).toEqual(["C0031"]);
    },
  );

  it.each(["C00312_notice.pdf", "XC0031_notice.pdf", "notice_C0031.pdf", "c0031_notice.pdf", "C0031notice.pdf", "ABC_notice.pdf"])(
    "does not read a client code from %s",
    (fileName) => {
      expect(keys(fileName).clientCodes).toEqual([]);
    },
  );

  it("reads a corporate number only with a valid check digit and exact length", () => {
    expect(keys(`notice_${CORPORATE_NUMBER}.pdf`).corporateNumbers).toEqual([CORPORATE_NUMBER]);
    expect(keys("notice_8000012050002.pdf").corporateNumbers).toEqual([]);
    expect(keys(`notice_${CORPORATE_NUMBER}1.pdf`).corporateNumbers).toEqual([]);
  });

  it("does not read a corporate number out of an arrival number", () => {
    expect(keys(`${ARRIVAL}.pdf`).corporateNumbers).toEqual([]);
  });
});

describe("extractKeys from a ZIP", () => {
  it("reads entry names and XML content", () => {
    const archive = zip({ [`${ARRIVAL}.xml`]: `<doc><corp>${CORPORATE_NUMBER}</corp><ref>${ARRIVAL_2}</ref></doc>`, "notice.pdf": "%PDF-" });
    expect(keys("download.zip", archive, "zip")).toEqual({
      arrivalNumbers: [ARRIVAL, ARRIVAL_2],
      clientCodes: [],
      corporateNumbers: [CORPORATE_NUMBER],
    });
  });

  it("does not take a client code from entry names or XML", () => {
    const archive = zip({ "C0031_notice.xml": "<a>C0142_x</a>" });
    expect(keys("download.zip", archive, "zip").clientCodes).toEqual([]);
  });

  it("ignores content of non-XML entries", () => {
    const archive = zip({ "note.txt": ARRIVAL });
    expect(keys("download.zip", archive, "zip").arrivalNumbers).toEqual([]);
  });

  it("still reads the file name of an unreadable ZIP but nothing inside it", () => {
    const archive = markEncrypted(zip({ [`${ARRIVAL_2}.xml`]: "<a/>" }));
    expect(keys(`${ARRIVAL}.zip`, archive, "zip")).toEqual({ arrivalNumbers: [ARRIVAL], clientCodes: [], corporateNumbers: [] });
  });

  it("does not open XLSX or DOCX containers", () => {
    const archive = zip({ "xl/sheet.xml": `<a>${ARRIVAL}</a>` });
    expect(extractKeys({ fileName: "a.xlsx", format: "xlsx", bytes: archive }, options).arrivalNumbers).toEqual([]);
  });
});

describe("extractKeys pattern handling", () => {
  it("rejects an invalid pattern explicitly", () => {
    expect(() => extractKeys({ fileName: "a.pdf", format: "pdf", bytes: PDF }, { arrivalNumberPattern: "[0-9", clientCodes: [] })).toThrow(
      "invalid_input: arrival_number_pattern",
    );
  });
});

describe("extractKeys full-width delimiters", () => {
  it("accepts a full-width space or bracket after the client code", () => {
    const wideSpace = String.fromCharCode(0x3000);
    const wideParen = String.fromCharCode(0xff08);
    expect(extractKeys({ fileName: `C0031${wideSpace}notice.pdf`, format: "pdf", bytes: PDF }, options).clientCodes).toEqual(["C0031"]);
    expect(extractKeys({ fileName: `C0031${wideParen}1.pdf`, format: "pdf", bytes: PDF }, options).clientCodes).toEqual(["C0031"]);
  });

  it("does not treat other non-ASCII text as a delimiter", () => {
    const kanji = String.fromCharCode(0x901a, 0x77e5);
    expect(extractKeys({ fileName: `C0031${kanji}.pdf`, format: "pdf", bytes: PDF }, options).clientCodes).toEqual([]);
  });
});
