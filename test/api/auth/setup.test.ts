import { beforeAll, describe, expect, it } from "vitest";
import { apiKit } from "../../support/api";
import { migrate } from "../../support/d1";

const SETUP_TOKEN = "setup-token-0123456789-abcdef";

describe("first-time setup", () => {
  beforeAll(async () => {
    await migrate();
  });

  it("makes the first user with the token an Owner and then closes", async () => {
    const kit = apiKit();
    const envWithToken = { SETUP_TOKEN };
    const first = kit.client(envWithToken);
    await first.signIn("member");
    const open = (await (await first.call("GET", "/api/config")).json()) as { setupOpen: boolean };
    expect(open.setupOpen).toBe(true);

    const wrong = await first.call("POST", "/api/setup/claim", { body: { token: "wrong-token", turnstileToken: "ok" } });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "invalid_input", detail: "setup_token" });

    // A client member cannot become staff, even with the right token.
    const asMember = await first.call("POST", "/api/setup/claim", { body: { token: SETUP_TOKEN, turnstileToken: "ok" } });
    expect(asMember.status).toBe(422);

    kit.identity.identity = { sub: "setup-owner", displayName: "A. Mori" };
    const owner = kit.client(envWithToken);
    const start = await owner.call("GET", "/api/auth/login");
    const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    await owner.call("GET", `/api/auth/callback?code=c&state=${state}`);
    owner.csrfToken = ((await (await owner.call("GET", "/api/me")).json()) as { csrfToken: string }).csrfToken;
    const claimed = await owner.call("POST", "/api/setup/claim", { body: { token: SETUP_TOKEN, turnstileToken: "ok" } });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ officeRole: "Owner", officeStatus: "Active" });

    const closed = (await (await owner.call("GET", "/api/config")).json()) as { setupOpen: boolean };
    expect(closed.setupOpen).toBe(false);

    kit.identity.identity = { sub: "setup-late", displayName: "Late" };
    const late = kit.client(envWithToken);
    const lateStart = await late.call("GET", "/api/auth/login");
    const lateState = new URL(lateStart.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    await late.call("GET", `/api/auth/callback?code=c&state=${lateState}`);
    late.csrfToken = ((await (await late.call("GET", "/api/me")).json()) as { csrfToken: string }).csrfToken;
    const refused = await late.call("POST", "/api/setup/claim", { body: { token: SETUP_TOKEN, turnstileToken: "ok" } });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid_input", detail: "setup_token" });
  });
});
