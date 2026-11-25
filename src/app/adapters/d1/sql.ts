/** Small helpers shared by the D1 repositories. Every statement is parameterised. */

export type Row = Record<string, unknown>;

export function toIso(value: Date): string {
  return value.toISOString();
}

export function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function fromIso(value: unknown): Date {
  return new Date(String(value));
}

export function fromIsoOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(String(value));
}

export function text(value: unknown): string {
  return String(value);
}

export function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** True when D1 rejected a statement because of a UNIQUE constraint, optionally on a given column. */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("UNIQUE constraint failed") && (column === undefined || message.includes(column));
}

/** Escapes LIKE wildcards so that user text is matched literally (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function changes(result: D1Result): number {
  return result.meta.changes ?? 0;
}

export interface Where {
  clauses: string[];
  params: unknown[];
}

export function whereSql(where: Where): string {
  return where.clauses.length === 0 ? "" : ` WHERE ${where.clauses.join(" AND ")}`;
}

/** Largest number of bound values used in one IN list. */
export const IN_CHUNK = 50;

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
