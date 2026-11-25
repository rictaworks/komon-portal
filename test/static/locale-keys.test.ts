import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = "src/app/web";
const MESSAGES = JSON.parse(readFileSync("src/locales/en.json", "utf8")) as Record<string, unknown>;
/** t("a.b") and labelKey: "a.b" */
const LITERAL_KEY = /(?:\bt\(\s*|labelKey:\s*|key:\s*)"([a-zA-Z0-9_.]+\.[a-zA-Z0-9_.]+)"/g;
/** t(`a.b.${x}`): the part before the first placeholder must be an existing group. */
const TEMPLATE_KEY = /\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g;

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined), MESSAGES);
}

function flatten(node: unknown, prefix: string): string[] {
  if (typeof node === "string") {
    return [prefix];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => flatten(value, prefix === "" ? key : `${prefix}.${key}`));
}

describe("language pack", () => {
  const sources = listFiles(WEB_ROOT).filter((file) => /\.tsx?$/.test(file));
  const text = sources.map((file) => readFileSync(file, "utf8")).join("\n");

  it("has a message for every key the screens use", () => {
    const used = [...text.matchAll(LITERAL_KEY)].map((match) => match[1] ?? "");
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((key) => typeof lookup(key) !== "string")).toEqual([]);
  });

  it("has a group for every key that is built at run time", () => {
    const groups = [...text.matchAll(TEMPLATE_KEY)].map((match) => match[1] ?? "");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((group) => typeof lookup(group) !== "object" || lookup(group) === null)).toEqual([]);
  });

  it("contains only non-empty text and no emoji", () => {
    const keys = flatten(MESSAGES, "");
    const bad = keys.filter((key) => {
      const value = String(lookup(key));
      return value.trim() === "" || /\p{Extended_Pictographic}/u.test(value);
    });
    expect(bad).toEqual([]);
  });

  it("uses no native dialogs in the screens", () => {
    expect([...text.matchAll(/\b(?:window\.)?(alert|confirm|prompt)\s*\(/g)].map((match) => match[0])).toEqual([]);
  });
});
