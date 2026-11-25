import messages from "../locales/en.json";

/**
 * Text for the admin page, from the same language pack as the portal. A missing key or a value that
 * is not supplied is an explicit error, never an empty string.
 */
export function adminText(key: string, values: Record<string, string | number> = {}): string {
  const found = key.split(".").reduce<unknown>((node, part) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined), messages);
  if (typeof found !== "string") {
    throw new Error(`missing message: ${key}`);
  }
  return found.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`message ${key} needs a value for ${name}`);
    }
    return String(value);
  });
}
