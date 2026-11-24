import { sha256Hex } from "../intake/sha256";

/** Hash of a secret string, as stored for invitation codes. */
export async function hashSecret(secret: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(secret));
}

/** Compares two secrets without revealing through timing where they differ. */
export async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = [await hashSecret(left), await hashSecret(right)];
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
