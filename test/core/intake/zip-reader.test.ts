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

  it("stops a highly compressed entry before it is fully inflated", () => {
    const bomb = zip({ "a.xml": new Uint8Array(64 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200 * 1024);
    const view = new DataView(bomb.buffer);
    for (let offset = 0; offset + 4 <= bomb.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 10, true);
      }
    }
    const before = process.memoryUsage().arrayBuffers;
    expect(inspectZip(bomb)).toEqual({ readable: false, reason: "TooLarge" });
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(32 * 1024 * 1024);
  });

  it("limits the real total of all XML entries even when their headers lie", () => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < 10; index += 1) {
      entries[`e${index}.xml`] = `<a>${String(index).repeat(900)}</a>`;
    }
    const archive = zip(entries);
    const view = new DataView(archive.buffer);
    for (let offset = 0; offset + 4 <= archive.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true);
      }
    }
    expect(inspectZip(archive, { maxXmlBytes: 1000, maxXmlTotalBytes: 5000 })).toEqual({ readable: false, reason: "TooLarge" });
    expect(inspectZip(archive, { maxXmlBytes: 1000, maxXmlTotalBytes: 10000 }).readable).toBe(true);
  });

  it("refuses entries that share one local header", () => {
    const archive = zip({ "a.xml": "<a/>", "b.xml": "<b/>" });
    const view = new DataView(archive.buffer);
    const offsets: number[] = [];
    for (let offset = 0; offset + 4 <= archive.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        offsets.push(offset);
      }
    }
    view.setUint32((offsets[1] ?? 0) + 42, view.getUint32((offsets[0] ?? 0) + 42, true), true);
    expect(inspectZip(archive)).toEqual({ readable: false, reason: "Corrupt" });
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
