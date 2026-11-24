import { strToU8, zipSync } from "fflate";

export const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

export function text(value: string): Uint8Array {
  return strToU8(value);
}

export function zip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries)) {
    input[name] = typeof value === "string" ? strToU8(value) : value;
  }
  return zipSync(input);
}

/** Sets the "encrypted" flag on every entry of a ZIP built by `zip`. */
export function markEncrypted(archive: Uint8Array): Uint8Array {
  const copy = archive.slice();
  const view = new DataView(copy.buffer);
  for (let offset = 0; offset + 4 <= copy.length; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50) {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
    }
  }
  return copy;
}

/** Valid corporate number published as an example by the National Tax Agency of Japan. */
export const CORPORATE_NUMBER = "7000012050002";
