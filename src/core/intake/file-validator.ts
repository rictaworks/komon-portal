import type { FileFormat, RejectionReason } from "../model/types";
import { extensionOf } from "./file-name";
import { MAX_FILE_BYTES, TEXT_SNIFF_BYTES } from "./limits";

export interface IncomingFile {
  fileName: string;
  bytes: Uint8Array;
}

export type ValidationResult = { ok: true; format: FileFormat } | { ok: false; reason: RejectionReason };

const EXTENSIONS: Readonly<Record<string, FileFormat>> = {
  pdf: "pdf",
  zip: "zip",
  xml: "xml",
  csv: "csv",
  xlsx: "xlsx",
  docx: "docx",
  txt: "txt",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
};

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  zipLocal: [0x50, 0x4b, 0x03, 0x04],
  zipEmpty: [0x50, 0x4b, 0x05, 0x06],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
} as const;

const BOMS = [
  [0xef, 0xbb, 0xbf],
  [0xff, 0xfe],
  [0xfe, 0xff],
] as const;

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function bomLength(bytes: Uint8Array): number {
  const bom = BOMS.find((candidate) => startsWith(bytes, candidate));
  return bom === undefined ? 0 : bom.length;
}

function isBinaryMagic(bytes: Uint8Array): boolean {
  return Object.values(MAGIC).some((prefix) => startsWith(bytes, prefix));
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (isBinaryMagic(bytes)) {
    return false;
  }
  const utf16 = bomLength(bytes) === 2;
  return utf16 || !bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0);
}

function looksLikeXml(bytes: Uint8Array): boolean {
  if (!looksLikeText(bytes)) {
    return false;
  }
  const head = new TextDecoder().decode(bytes.subarray(bomLength(bytes), 256)).replaceAll(String.fromCharCode(0), "");
  return head.trimStart().startsWith("<");
}

function contentMatches(format: FileFormat, bytes: Uint8Array): boolean {
  switch (format) {
    case "pdf":
      return startsWith(bytes, MAGIC.pdf);
    case "zip":
      return startsWith(bytes, MAGIC.zipLocal) || startsWith(bytes, MAGIC.zipEmpty);
    case "xlsx":
    case "docx":
      return startsWith(bytes, MAGIC.zipLocal);
    case "png":
      return startsWith(bytes, MAGIC.png);
    case "jpeg":
      return startsWith(bytes, MAGIC.jpeg);
    case "xml":
      return looksLikeXml(bytes);
    case "csv":
    case "txt":
      return looksLikeText(bytes);
  }
}

/** Checks size, allowed format and that the leading bytes agree with the extension. */
export function validateFile(file: IncomingFile): ValidationResult {
  if (file.bytes.length === 0) {
    return { ok: false, reason: "Empty" };
  }
  if (file.bytes.length > MAX_FILE_BYTES) {
    return { ok: false, reason: "TooLarge" };
  }
  const format = EXTENSIONS[extensionOf(file.fileName)];
  if (format === undefined) {
    return { ok: false, reason: "UnsupportedFormat" };
  }
  if (!contentMatches(format, file.bytes)) {
    return { ok: false, reason: "ContentMismatch" };
  }
  return { ok: true, format };
}
