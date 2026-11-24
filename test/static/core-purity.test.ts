import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_ROOT = "src/core";
const FORBIDDEN = [/^hono/, /^react/, /^cloudflare:/, /^@cloudflare\//, /\/app\//, /\/admin\//];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function moduleSpecifiers(sourceText: string): string[] {
  return [...sourceText.matchAll(SPECIFIER)].map((match) => match[1] ?? "");
}

export function forbiddenSpecifiers(sourceText: string): string[] {
  return moduleSpecifiers(sourceText).filter((specifier) => FORBIDDEN.some((pattern) => pattern.test(specifier)));
}

describe("Domain Core purity", () => {
  it("recognises every import form", () => {
    const sample = [
      'import {\n  Hono,\n} from "hono";',
      "import x from 'react';",
      'import "cloudflare:workers";',
      'const m = await import("@cloudflare/x");',
      'export * from "../../app/env";',
      'import type { A } from "../model/types";',
    ].join("\n");
    expect(forbiddenSpecifiers(sample)).toEqual(["hono", "react", "cloudflare:workers", "@cloudflare/x", "../../app/env"]);
  });

  it("imports nothing from Cloudflare, Hono, React or the application layers", () => {
    const files = listFiles(CORE_ROOT).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offending = files.filter((file) => forbiddenSpecifiers(readFileSync(file, "utf8")).length > 0);
    expect(offending).toEqual([]);
  });

  it("keeps the client resolver independent of the classifier", () => {
    const resolver = listFiles(CORE_ROOT).filter((file) => file.endsWith("client-resolver.ts"));
    const offending = resolver.filter((file) => /classifier/i.test(readFileSync(file, "utf8")));
    expect(offending).toEqual([]);
  });
});
