import { invalidInput } from "../../core/model/errors";
import type { AppContext } from "./context";

export type JsonObject = Record<string, unknown>;

/** Parses a JSON object body. Anything else is invalid input. */
export async function readJson(c: AppContext): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw invalidInput("body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalidInput("body");
  }
  return body as JsonObject;
}

export function requireString(body: JsonObject, key: string, maxLength = 200): string {
  const value = body[key];
  if (typeof value !== "string" || value === "" || value.length > maxLength) {
    throw invalidInput(key);
  }
  return value;
}

export function optionalString(body: JsonObject, key: string, maxLength = 200): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw invalidInput(key);
  }
  return value;
}

export function requireInteger(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidInput(key);
  }
  return value;
}

export function requireNumber(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidInput(key);
  }
  return value;
}

export function requireBoolean(body: JsonObject, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw invalidInput(key);
  }
  return value;
}

export function optionalBoolean(body: JsonObject, key: string): boolean {
  return body[key] === undefined ? false : requireBoolean(body, key);
}

export function requireArray(body: JsonObject, key: string, maxItems: number): unknown[] {
  const value = body[key];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw invalidInput(key);
  }
  return value;
}

export function requireEnum<T extends string>(body: JsonObject, key: string, allowed: readonly T[]): T {
  const value = body[key];
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw invalidInput(key);
  }
  return match;
}
