import { Inflate } from "fflate";
import { MAX_ZIP_ENTRIES, MAX_ZIP_TOTAL_BYTES, MAX_ZIP_XML_BYTES } from "./limits";

export type ZipUnreadableReason = "TooManyEntries" | "TooLarge" | "Encrypted" | "Corrupt";

export type ZipInspection =
  | { readable: true; entryNames: string[]; xmlTexts: string[] }
  | { readable: false; reason: ZipUnreadableReason };

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxXmlBytes: number;
}

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  declaredSize: number;
  localOffset: number;
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_MIN_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const ZIP64_COUNT = 0xffff;
const ZIP64_OFFSET = 0xffffffff;
const FLAG_ENCRYPTED = 1;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

class ZipFailure extends Error {
  readonly reason: ZipUnreadableReason;

  constructor(reason: ZipUnreadableReason) {
    super(reason);
    this.reason = reason;
  }
}

function findEnd(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_MIN_BYTES - MAX_COMMENT_BYTES);
  for (let offset = view.byteLength - END_MIN_BYTES; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_SIGNATURE) {
      return offset;
    }
  }
  throw new ZipFailure("Corrupt");
}

function readCentralDirectory(bytes: Uint8Array, limits: ZipLimits): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === ZIP64_COUNT || directoryOffset === ZIP64_OFFSET) {
    throw new ZipFailure("Corrupt");
  }
  if (count > limits.maxEntries) {
    throw new ZipFailure("TooManyEntries");
  }
  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipFailure("Corrupt");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > end) {
      throw new ZipFailure("Corrupt");
    }
    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, nameEnd)),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      declaredSize: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function entryData(bytes: Uint8Array, entry: CentralEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw new ZipFailure("Corrupt");
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) {
    throw new ZipFailure("Corrupt");
  }
  return bytes.subarray(start, stop);
}

/** Inflates one entry, stopping as soon as the real output exceeds `cap` regardless of the declared size. */
function inflateCapped(data: Uint8Array, cap: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > cap) {
      throw new ZipFailure("TooLarge");
    }
    chunks.push(chunk);
  });
  try {
    inflater.push(data, true);
  } catch (error) {
    throw error instanceof ZipFailure ? error : new ZipFailure("Corrupt");
  }
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

function readXml(bytes: Uint8Array, entry: CentralEntry, cap: number): string {
  const data = entryData(bytes, entry);
  if (entry.method === METHOD_STORED) {
    if (data.length > cap) {
      throw new ZipFailure("TooLarge");
    }
    return new TextDecoder().decode(data);
  }
  if (entry.method === METHOD_DEFLATE) {
    return new TextDecoder().decode(inflateCapped(data, cap));
  }
  throw new ZipFailure("Corrupt");
}

function isXmlEntry(entry: CentralEntry): boolean {
  return entry.name.toLowerCase().endsWith(".xml");
}

/**
 * Reads the entry list and the XML entries of a ZIP without unpacking anything else.
 * Nested archives are never opened. Entry names are returned for reading only and must
 * never be used as paths.
 */
export function inspectZip(bytes: Uint8Array, overrides: Partial<ZipLimits> = {}): ZipInspection {
  const limits: ZipLimits = {
    maxEntries: MAX_ZIP_ENTRIES,
    maxTotalBytes: MAX_ZIP_TOTAL_BYTES,
    maxXmlBytes: MAX_ZIP_XML_BYTES,
    ...overrides,
  };
  try {
    const entries = readCentralDirectory(bytes, limits);
    if (entries.some((entry) => (entry.flags & FLAG_ENCRYPTED) !== 0)) {
      throw new ZipFailure("Encrypted");
    }
    const declaredTotal = entries.reduce((total, entry) => total + entry.declaredSize, 0);
    if (declaredTotal > limits.maxTotalBytes) {
      throw new ZipFailure("TooLarge");
    }
    const xmlTexts = entries.filter(isXmlEntry).map((entry) => readXml(bytes, entry, limits.maxXmlBytes));
    return { readable: true, entryNames: entries.map((entry) => entry.name), xmlTexts };
  } catch (error) {
    if (error instanceof ZipFailure) {
      return { readable: false, reason: error.reason };
    }
    if (error instanceof RangeError) {
      return { readable: false, reason: "Corrupt" };
    }
    throw error;
  }
}
