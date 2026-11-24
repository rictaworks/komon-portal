import { hashSecret } from "../../core/access/secret-compare";
import type { Id } from "../../core/model/types";
import type { Clock } from "../../core/ports/clock";
import type { IdGenerator } from "../../core/ports/id-generator";
import { SESSION } from "../config/app-config";

export interface NewSession {
  /** Secret placed in the cookie. Only its hash is stored. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ActiveSession {
  userId: Id;
  csrfToken: string;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Server-side sessions in D1. A session ends after 60 idle minutes or 12 hours from issue. */
export class SessionStore {
  constructor(
    private readonly db: D1Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async create(userId: Id): Promise<NewSession> {
    const now = this.clock.now();
    const token = this.ids.randomToken(SESSION.tokenBytes);
    const csrfToken = this.ids.randomToken(SESSION.tokenBytes);
    const expiresAt = new Date(now.getTime() + SESSION.lifetimeHours * HOUR_MS);
    await this.db
      .prepare("INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await hashSecret(token), userId, csrfToken, now.toISOString(), expiresAt.toISOString(), now.toISOString())
      .run();
    return { token, csrfToken, expiresAt };
  }

  /** Returns the session if it is still valid and records the activity. Expired sessions are removed. */
  async find(token: string): Promise<ActiveSession | null> {
    const id = await hashSecret(token);
    const row = await this.db
      .prepare("SELECT user_id, csrf_token, expires_at, last_seen_at FROM sessions WHERE id = ?")
      .bind(id)
      .first<{ user_id: string; csrf_token: string; expires_at: string; last_seen_at: string }>();
    if (row === null) {
      return null;
    }
    const now = this.clock.now().getTime();
    const lastSeen = new Date(row.last_seen_at).getTime();
    if (now >= new Date(row.expires_at).getTime() || now - lastSeen >= SESSION.idleMinutes * MINUTE_MS) {
      await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
      return null;
    }
    if (now - lastSeen >= SESSION.touchSeconds * 1000) {
      await this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(new Date(now).toISOString(), id).run();
    }
    return { userId: row.user_id, csrfToken: row.csrf_token };
  }

  async destroy(token: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(await hashSecret(token)).run();
  }

  /** Removes sessions past their lifetime. Called by the daily job. */
  async removeExpired(): Promise<number> {
    const result = await this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(this.clock.now().toISOString()).run();
    return result.meta.changes ?? 0;
  }
}
