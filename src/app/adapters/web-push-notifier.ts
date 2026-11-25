import { importJWK, SignJWT } from "jose";
import type { Id } from "../../core/model/types";
import type { Clock } from "../../core/ports/clock";
import type { Notifier } from "../../core/ports/notifier";
import { isAllowedPushEndpoint, type PushSubscriptionStore } from "./push-subscription-store";

export interface VapidConfig {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). From the environment; never logged. */
  privateKey: string;
  /** Contact of the operator, a mailto: or https: URL, as the push services require. */
  subject: string;
}

const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const TTL_SECONDS = "86400";
const GONE = new Set([404, 410]);
const PUBLIC_KEY_BYTES = 65;
const COORDINATE_BYTES = 32;

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Web Push without a payload. The push message carries nothing at all, so no document name or
 * type can leave the system; the service worker shows a fixed "new document" text.
 */
export class WebPushNotifier implements Notifier {
  constructor(
    private readonly subscriptions: PushSubscriptionStore,
    private readonly vapid: VapidConfig,
    private readonly fetcher: typeof fetch,
    private readonly clock: Clock,
  ) {}

  async notifyNewDocument(clientId: Id): Promise<void> {
    let failed = 0;
    for (const subscription of await this.subscriptions.listForClient(clientId)) {
      if (!isAllowedPushEndpoint(subscription.endpoint)) {
        await this.subscriptions.removeEndpoint(subscription.endpoint);
        continue;
      }
      try {
        const response = await this.fetcher(subscription.endpoint, {
          method: "POST",
          headers: { Authorization: await this.authorization(subscription.endpoint), TTL: TTL_SECONDS, "Content-Length": "0" },
        });
        if (GONE.has(response.status)) {
          await this.subscriptions.removeEndpoint(subscription.endpoint);
        } else if (!response.ok) {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      throw new Error(`push delivery failed for ${failed} subscription(s)`);
    }
  }

  private async authorization(endpoint: string): Promise<string> {
    const publicBytes = fromBase64Url(this.vapid.publicKey);
    if (publicBytes.length !== PUBLIC_KEY_BYTES) {
      throw new Error("VAPID public key must be an uncompressed P-256 point");
    }
    const key = await importJWK(
      {
        kty: "EC",
        crv: "P-256",
        d: this.vapid.privateKey,
        x: toBase64Url(publicBytes.subarray(1, 1 + COORDINATE_BYTES)),
        y: toBase64Url(publicBytes.subarray(1 + COORDINATE_BYTES)),
      },
      "ES256",
    );
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ aud: new URL(endpoint).origin, sub: this.vapid.subject })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
      .sign(key);
    return `vapid t=${token}, k=${this.vapid.publicKey}`;
  }
}
