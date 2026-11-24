import { describe, expect, it } from "vitest";
import { validateFile } from "../../../src/core/intake/file-validator";
import { MAX_FILE_BYTES } from "../../../src/core/intake/limits";
import { JPEG, PDF, PNG, text, zip } from "./fixtures";

describe("validateFile", () => {
  it.each([
    ["a.pdf", PDF, "pdf"],
    ["a.PDF", PDF, "pdf"],
    ["a.zip", zip({ "x.txt": "x" }), "zip"],
    ["a.zip", zip({}), "zip"],
    ["a.xlsx", zip({ "xl/workbook.xml": "<a/>" }), "xlsx"],
    ["a.docx", zip({ "word/document.xml": "<a/>" }), "docx"],
    ["a.xml", text('<?xml version="1.0"?><a/>'), "xml"],
    ["a.xml", new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, 0x3c, 0x61, 0x2f, 0x3e]), "xml"],
    ["a.csv", text("a,b\n1,2\n"), "csv"],
    ["a.txt", new Uint8Array([0x82, 0xa0, 0x82, 0xa2]), "txt"],
    ["a.png", PNG, "png"],
    ["a.jpg", JPEG, "jpeg"],
    ["dir/sub/a.jpeg", JPEG, "jpeg"],
  ] as const)("accepts %s", (fileName, bytes, format) => {
    expect(validateFile({ fileName, bytes })).toEqual({ ok: true, format });
  });

  it("rejects an empty file", () => {
    expect(validateFile({ fileName: "a.pdf", bytes: new Uint8Array(0) })).toEqual({ ok: false, reason: "Empty" });
  });

  it("rejects a file over 50 MB and accepts exactly 50 MB", () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PDF);
    expect(validateFile({ fileName: "a.pdf", bytes: big })).toEqual({ ok: false, reason: "TooLarge" });
    expect(validateFile({ fileName: "a.pdf", bytes: big.subarray(0, MAX_FILE_BYTES) })).toEqual({ ok: true, format: "pdf" });
  });

  it.each(["a.exe", "a.html", "a.svg", "a.xls", "a", "a.pdf.exe", ".pdf/a"])("rejects the unsupported name %s", (fileName) => {
    expect(validateFile({ fileName, bytes: PDF })).toEqual({ ok: false, reason: "UnsupportedFormat" });
  });

  it.each([
    ["a.pdf", PNG],
    ["a.png", PDF],
    ["a.jpg", PNG],
    ["a.zip", PDF],
    ["a.xlsx", PDF],
    ["a.xlsx", zip({})],
    ["a.docx", text("hello")],
    ["a.xml", text("not xml")],
    ["a.xml", PDF],
    ["a.csv", PDF],
    ["a.txt", zip({ "x.txt": "x" })],
    ["a.txt", PNG],
    ["a.csv", new Uint8Array([0x61, 0x00, 0x62])],
  ] as const)("rejects %s when the content is another format", (fileName, bytes) => {
    expect(validateFile({ fileName, bytes })).toEqual({ ok: false, reason: "ContentMismatch" });
  });
});
