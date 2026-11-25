import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app/api/app";
import specification from "../../../SPEC/api/openapi.json";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Spec = { paths: Record<string, Partial<Record<(typeof METHODS)[number], { summary?: string }>>> };

/** The operations the application registers, as "METHOD /path" with OpenAPI-style parameters. */
function registeredOperations(): Set<string> {
  const operations = new Set<string>();
  for (const route of createApp({}).routes) {
    if (route.method === "ALL" || !route.path.startsWith("/api") || route.path.endsWith("*")) {
      continue;
    }
    operations.add(`${route.method} ${route.path.replace(/:(\w+)/g, "{$1}")}`);
  }
  return operations;
}

/** The operations the specification documents, in the same form. */
function documentedOperations(): Set<string> {
  const operations = new Set<string>();
  for (const [path, item] of Object.entries((specification as Spec).paths)) {
    for (const method of METHODS) {
      if (item[method] !== undefined) {
        operations.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return operations;
}

describe("API documentation", () => {
  it("documents every route the application registers, and no route it does not", () => {
    const registered = [...registeredOperations()].sort();
    const documented = [...documentedOperations()].sort();
    expect(documented).toEqual(registered);
  });

  it("gives every documented operation a summary", () => {
    for (const [path, item] of Object.entries((specification as Spec).paths)) {
      for (const method of METHODS) {
        const operation = item[method];
        if (operation !== undefined) {
          expect(operation.summary?.trim(), `${method} ${path}`).toBeTruthy();
        }
      }
    }
  });
});
