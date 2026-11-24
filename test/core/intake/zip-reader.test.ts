import { describe, expect, it } from "vitest";
import { MAX_ZIP_ENTRIES } from "../../../src/core/intake/limits";
import { inspectZip } from "../../../src/core/intake/zip-reader";
import { markEncrypted, text, zip } from "./fixtures";

describe("inspectZip", () => {
  it("lists entry names and reads only XML entries", () => {
    const archive = zip({ "202611240912345678.xml": "<a>hello</a>", "doc/notice.pdf": "%PDF-", "DATA.XML": "<b/>" });
    const result = inspectZip(archive);
    expect(result).toEqual({
      readable: true,
      entryNames: ["202611240912345678.xml", "doc/notice.pdf", "DATA.XML"],
      xmlTexts: ["<a>hello</a>", "<b/>"],
    });
  });

  it("does not read nested archives", () => {
    const inner = zip({ "secret.xml": "<inner>202611240912345678</inner>" });
    const result = inspectZip(zip({ "inner.zip": inner }));
    expect(result).toEqual({ readable: true, entryNames: ["inner.zip"], xmlTexts: [] });
  });

  it("reads an empty archive", () => {
    expect(inspectZip(zip({}))).toEqual({ readable: true, entryNames: [], xmlTexts: [] });
  });

  it("refuses more than 200 entries and accepts exactly 200", () => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < MAX_ZIP_ENTRIES; index += 1) {
      entries[`f${index}.txt`] = "x";
    }
    expect(inspectZip(zip(entries)).readable).toBe(true);
    entries["one-more.txt"] = "x";
    expect(inspectZip(zip(entries))).toEqual({ readable: false, reason: "TooManyEntries" });
  });

  it("refuses when the declared expanded size exceeds the limit", () => {
    const archive = zip({ "a.xml": "<a/>" });
    expect(inspectZip(archive, { maxTotalBytes: 3 })).toEqual({ readable: false, reason: "TooLarge" });
  });

  it("refuses an XML entry that inflates beyond its cap even when its header lies", () => {
    const archive = zip({ "a.xml": "<a>" + "x".repeat(5000) + "</a>" });
    const view = new DataView(archive.buffer);
    for (let offset = 0; offset + 4 <= archive.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 10, true);
      }
    }
    expect(inspectZip(archive, { maxXmlBytes: 100 })).toEqual({ readable: false, reason: "TooLarge" });
  });

  it("refuses encrypted archives", () => {
    expect(inspectZip(markEncrypted(zip({ "a.xml": "<a/>" })))).toEqual({ readable: false, reason: "Encrypted" });
  });

  it.each([
    ["truncated", (archive: Uint8Array) => archive.subarray(0, archive.length - 10)],
    ["garbage", () => text("PK\u0003\u0004 this is not a zip at all")],
    ["bad offsets", (archive: Uint8Array) => {
      const copy = archive.slice();
      new DataView(copy.buffer).setUint32(copy.length - 6, 0xfffffff0, true);
      return copy;
    }],
  ] as const)("reports a corrupt archive (%s)", (_name, damage) => {
    const archive = zip({ "a.xml": "<a/>", "b.txt": "b" });
    expect(inspectZip(damage(archive))).toEqual({ readable: false, reason: "Corrupt" });
  });
});
