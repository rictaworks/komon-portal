import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_ROOT = "src/core";
const FORBIDDEN = [/from\s+"hono/, /from\s+"react/, /from\s+"cloudflare:/, /from\s+"@cloudflare\//, /\/app\//, /\/admin\//];

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe("Domain Core purity", () => {
  it("imports nothing from Cloudflare, Hono, React or the application layers", () => {
    const files = listFiles(CORE_ROOT).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offending = files.filter((file) => {
      const imports = readFileSync(file, "utf8").split("\n").filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line));
      return imports.some((line) => FORBIDDEN.some((pattern) => pattern.test(line)));
    });
    expect(offending).toEqual([]);
  });

  it("keeps the client resolver independent of the classifier", () => {
    const resolver = listFiles(CORE_ROOT).filter((file) => file.endsWith("client-resolver.ts"));
    const offending = resolver.filter((file) => /classifier/i.test(readFileSync(file, "utf8")));
    expect(offending).toEqual([]);
  });
});
