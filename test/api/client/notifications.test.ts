import { env } from "cloudflare:test";
import { importJWK, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, PushSubscriptionStore } from "../../../src/app/adapters/push-subscription-store";
import { WebPushNotifier } from "../../../src/app/adapters/web-push-notifier";
import { apiKit, type ApiClient, type ApiKit } from "../../support/api";
import { FixedClock } from "../../support/builders";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
const OWN = "dev-client";
const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const MOZILLA = "https://updates.push.services.mozilla.com/wpush/v2/xyz";
const KEYS = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

interface PushCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

describe("isAllowedPushEndpoint", () => {
  it.each([FCM, MOZILLA, "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/abc"])("accepts %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example/x",
    "https://notify.windows.com.evil.example/x",
    "https://127.0.0.1/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "not a url",
    `https://fcm.googleapis.com/${"x".repeat(1000)}`,
  ])("rejects %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("browser notifications", () => {
  let kit: ApiKit;
  let member: ApiClient;
  let staff: ApiClient;
  let store: PushSubscriptionStore;
  let vapid: { publicKey: string; privateKey: string; subject: string };
  let publicJwk: JsonWebKey;
  const calls: PushCall[] = [];
  let respond: (url: string) => Response = () => new Response(null, { status: 201 });
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ?? null });
    return respond(String(input));
  }) as typeof fetch;

  beforeAll(async () => {
    await migrate();
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
    vapid = { publicKey: base64Url(raw), privateKey: privateJwk.d ?? "", subject: "mailto:info@rictaworks.jp" };
    store = new PushSubscriptionStore(env.DB);
    kit = apiKit({ notifier: undefined, fetcher });
    const withPush = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject };
    member = kit.client(withPush);
    staff = kit.client(withPush);
    await member.signIn("member");
    await staff.signIn("staff");
  });

  it("tells the member whether notifications are available and gives the public key only", async () => {
    const status = (await (await member.call("GET", `/api/client/${OWN}/notifications`)).json()) as Json;
    expect(status).toEqual({ available: true, vapidPublicKey: vapid.publicKey, subscriptions: 0 });
    expect(JSON.stringify(status)).not.toContain(vapid.privateKey);
    const off = (await (await kit.client().call("GET", `/api/client/${OWN}/notifications`)).status);
    expect(off).toBe(401);
    const bare = kit.client();
    await bare.signIn("member");
    expect(await (await bare.call("GET", `/api/client/${OWN}/notifications`)).json()).toMatchObject({ available: false, vapidPublicKey: null });
  });

  it("registers and removes a subscription for this browser", async () => {
    const created = await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: FCM, keys: KEYS } });
    expect(created.status).toBe(201);
    await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: FCM, keys: KEYS } });
    await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: MOZILLA, keys: KEYS } });
    expect(await (await member.call("GET", `/api/client/${OWN}/notifications`)).json()).toMatchObject({ subscriptions: 2 });
    const removed = await member.call("DELETE", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: MOZILLA } });
    expect(await removed.json()).toEqual({ status: "ok", removed: true });
    expect(await (await member.call("DELETE", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: MOZILLA } })).json()).toEqual({ status: "ok", removed: false });
  });

  it("refuses endpoints outside the known push services, malformed keys, staff and other clients", async () => {
    for (const endpoint of ["https://evil.example/hook", "http://fcm.googleapis.com/x", "https://169.254.169.254/latest"]) {
      const response = await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint, keys: KEYS } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input", detail: "endpoint" });
    }
    expect((await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: FCM, keys: { p256dh: "x y", auth: "z" } } })).status).toBe(400);
    expect((await member.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: FCM } })).status).toBe(400);
    expect((await member.call("POST", "/api/client/other-client/notifications/subscriptions", { body: { endpoint: FCM, keys: KEYS } })).status).toBe(404);
    expect((await staff.call("POST", `/api/client/${OWN}/notifications/subscriptions`, { body: { endpoint: FCM, keys: KEYS } })).status).toBe(404);
  });

  it("sends an empty, VAPID-signed push to the client's active members when a document is published", async () => {
    calls.length = 0;
    const batch = (await (await staff.call("POST", "/api/office/batches", { body: { hintClientId: OWN } })).json()) as Json;
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 secret payroll"], "kyuyo_meisai.pdf"));
    const stored = (await (await staff.call("POST", `/api/office/batches/${String(batch.id)}/files`, { form })).json()) as { file: Json };
    const published = (await (await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: stored.file.id, version: 1 }] } })).json()) as Json;
    expect(published.results).toEqual([{ fileId: stored.file.id, outcome: "published", clientId: OWN }]);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(FCM);
    expect(call?.method).toBe("POST");
    expect(call?.body).toBeNull();
    expect(call?.headers.get("Content-Length")).toBe("0");
    expect(call?.headers.get("TTL")).toBe("86400");
    const authorization = call?.headers.get("Authorization") ?? "";
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
    expect(match?.[2]).toBe(vapid.publicKey);
    const verified = await jwtVerify(match?.[1] ?? "", await importJWK(publicJwk as never, "ES256"), { currentDate: kit.clock.now() });
    expect(verified.payload).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:info@rictaworks.jp" });
    expect(Number(verified.payload.exp) - Math.floor(kit.clock.now().getTime() / 1000)).toBe(12 * 60 * 60);
    const everything = JSON.stringify([call?.url, [...(call?.headers ?? new Headers())]]);
    expect(everything).not.toContain(String(stored.file.displayName));
    expect(everything).not.toContain("kyuyo");
    expect(everything).not.toContain(vapid.privateKey);
  });

  it("removes subscriptions the push service reports as gone and keeps the others", async () => {
    const notifier = new WebPushNotifier(store, vapid, fetcher, new FixedClock());
    await store.save("sub-gone", (await env.DB.prepare("SELECT user_id FROM push_subscriptions LIMIT 1").first<{ user_id: string }>())?.user_id ?? "", { endpoint: MOZILLA, keys: KEYS }, new Date());
    calls.length = 0;
    respond = (url) => new Response(null, { status: url === MOZILLA ? 410 : 201 });
    await notifier.notifyNewDocument(OWN);
    expect(calls.map((call) => call.url).sort()).toEqual([FCM, MOZILLA].sort());
    expect((await store.listForClient(OWN)).map((subscription) => subscription.endpoint)).toEqual([FCM]);
  });

  it("tries every subscription and then reports a failure, which never blocks publishing", async () => {
    const userId = (await env.DB.prepare("SELECT user_id FROM push_subscriptions LIMIT 1").first<{ user_id: string }>())?.user_id ?? "";
    await store.save("sub-2", userId, { endpoint: MOZILLA, keys: KEYS }, new Date());
    calls.length = 0;
    respond = (url) => {
      if (url === FCM) {
        throw new TypeError("network down");
      }
      return new Response(null, { status: 201 });
    };
    const notifier = new WebPushNotifier(store, vapid, fetcher, new FixedClock());
    await expect(notifier.notifyNewDocument(OWN)).rejects.toThrow("push delivery failed for 1 subscription(s)");
    expect(calls).toHaveLength(2);

    const batch = (await (await staff.call("POST", "/api/office/batches", { body: { hintClientId: OWN } })).json()) as Json;
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 another"], "another.pdf"));
    const stored = (await (await staff.call("POST", `/api/office/batches/${String(batch.id)}/files`, { form })).json()) as { file: Json };
    const published = (await (await staff.call("POST", "/api/office/publish", { body: { items: [{ fileId: stored.file.id, version: 1 }] } })).json()) as Json;
    expect((published.results as Json[])[0]).toMatchObject({ outcome: "published" });
    respond = () => new Response(null, { status: 201 });
  });

  it("does not notify members whose membership is no longer active, nor other clients", async () => {
    await env.DB.prepare("UPDATE memberships SET status = 'Revoked' WHERE client_id = ?").bind(OWN).run();
    expect(await store.listForClient(OWN)).toEqual([]);
    expect(await store.listForClient("other-client")).toEqual([]);
    await env.DB.prepare("UPDATE memberships SET status = 'Active' WHERE client_id = ?").bind(OWN).run();
    expect((await store.listForClient(OWN)).length).toBeGreaterThan(0);
  });
});
