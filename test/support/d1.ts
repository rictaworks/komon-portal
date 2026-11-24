import { applyD1Migrations, env } from "cloudflare:test";

/** Applies the real migrations to the isolated test database. */
export async function migrate(): Promise<D1Database> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  return env.DB;
}

/** Runs a statement and reports whether the database rejected it. */
export async function rejects(db: D1Database, sql: string, ...params: unknown[]): Promise<boolean> {
  try {
    await db.prepare(sql).bind(...params).run();
    return false;
  } catch {
    return true;
  }
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...params).run();
}
