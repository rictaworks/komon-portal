import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { apiKit, type ApiClient } from "../../support/api";
import { migrate } from "../../support/d1";

const DEV_CLIENT = "dev-client";

describe("weekly activity of signed-in users", () => {
  let kit: ReturnType<typeof apiKit>;
  let member: ApiClient;
  let staff: ApiClient;
  let memberId = "";
  let staffId = "";

  async function activeRows(userId: string): Promise<{ client_id: string | null; actor_kind: string; attributes: string }[]> {
    const result = await env.DB.prepare("SELECT client_id, actor_kind, attributes FROM metric_events WHERE name = 'active' AND actor_user_id = ? ORDER BY occurred_at")
      .bind(userId)
      .all<{ client_id: string | null; actor_kind: string; attributes: string }>();
    return result.results;
  }

  beforeAll(async () => {
    await migrate();
    kit = apiKit();
    member = kit.client();
    staff = kit.client();
    memberId = (await member.signIn("member")).userId;
    staffId = (await staff.signIn("staff")).userId;
  });

  it("records the member's first authenticated request of the week once, for their client, and nothing more that week", async () => {
    // Signing in already made authenticated requests this week, so the member's event is in place before the test starts.
    const before = await activeRows(memberId);
    expect(before).toEqual([{ client_id: DEV_CLIENT, actor_kind: "member", attributes: "{}" }]);
    for (let index = 0; index < 3; index += 1) {
      expect((await member.call("GET", "/api/me")).status).toBe(200);
    }
    expect(await activeRows(memberId)).toEqual(before);
  });

  it("records an office member's read-only use with no client", async () => {
    expect(await activeRows(staffId)).toEqual([{ client_id: null, actor_kind: "staff", attributes: "{}" }]);
    expect((await staff.call("GET", "/api/me")).status).toBe(200);
    expect(await activeRows(staffId)).toHaveLength(1);
  });

  it("records nothing for a request that nobody is signed in for", async () => {
    const total = async (): Promise<number> =>
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM metric_events WHERE name = 'active'").first<{ count: number }>())?.count ?? 0;
    const anonymous = kit.client();
    const before = await total();
    expect((await anonymous.call("GET", "/api/me")).status).toBe(401);
    expect(await total()).toBe(before);
  });

  // Last: moving the clock on expires the sessions, so nothing signed in may run after this.
  it("records the next week again, on that week's first request", async () => {
    // The session lapses within the week, so the member signs in again in the new week; that sign-in's first request counts.
    kit.clock.advanceDays(7);
    await member.signIn("member");
    expect((await activeRows(memberId)).map((row) => row.client_id)).toEqual([DEV_CLIENT, DEV_CLIENT]);
    expect((await member.call("GET", "/api/me")).status).toBe(200);
    expect(await activeRows(memberId)).toHaveLength(2);
  });
});
