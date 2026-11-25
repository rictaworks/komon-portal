import { conflict, invalidInput } from "../../core/model/errors";
import type { Id } from "../../core/model/types";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface StoredSubscription {
  id: Id;
  userId: Id;
  endpoint: string;
}

/**
 * Push services of the major browsers. The Worker only ever sends to these hosts, so a stored
 * endpoint can never be used to make it call an arbitrary address.
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
] as const;
const MAX_ENDPOINT_LENGTH = 1000;
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,200}$/;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const known = PUSH_HOST_SUFFIXES.some((suffix) => (suffix.startsWith(".") ? host.endsWith(suffix) : host === suffix));
  return url.protocol === "https:" && url.username === "" && url.password === "" && (url.port === "" || url.port === "443") && known;
}

/** Browser push subscriptions of client members. */
export class PushSubscriptionStore {
  constructor(private readonly db: D1Database) {}

  /** Registers this browser for the user. An endpoint belongs to one user at a time. */
  async save(id: Id, userId: Id, input: PushSubscriptionInput, now: Date): Promise<void> {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw invalidInput("endpoint");
    }
    if (!KEY_SHAPE.test(input.keys.p256dh) || !KEY_SHAPE.test(input.keys.auth)) {
      throw invalidInput("keys");
    }
    // An endpoint already held by another user is never taken over: the update applies to this user's row only.
    const result = await this.db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET keys = excluded.keys, created_at = excluded.created_at
         WHERE push_subscriptions.user_id = excluded.user_id`,
      )
      .bind(id, userId, input.endpoint, JSON.stringify(input.keys), now.toISOString())
      .run();
    if (result.meta.changes === 0) {
      throw conflict("subscription");
    }
  }

  async remove(userId: Id, endpoint: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(userId, endpoint).run();
    return (result.meta.changes ?? 0) > 0;
  }

  /** Removes a subscription the push service reported as gone. */
  async removeEndpoint(endpoint: string): Promise<void> {
    await this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  }

  async countForUser(userId: Id): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").bind(userId).first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** Subscriptions of the users whose membership in this client is Active. */
  async listForClient(clientId: Id): Promise<StoredSubscription[]> {
    const rows = await this.db
      .prepare(
        `SELECT p.id, p.user_id, p.endpoint FROM push_subscriptions p
         JOIN memberships m ON m.user_id = p.user_id
         WHERE m.client_id = ? AND m.status = 'Active'
         ORDER BY p.created_at, p.id`,
      )
      .bind(clientId)
      .all<{ id: string; user_id: string; endpoint: string }>();
    return rows.results.map((row) => ({ id: row.id, userId: row.user_id, endpoint: row.endpoint }));
  }
}
