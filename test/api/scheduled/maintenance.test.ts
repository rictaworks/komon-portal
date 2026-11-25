import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../../src/app/adapters/d1/d1-repository";
import { R2FileStore } from "../../../src/app/adapters/r2-file-store";
import { SessionStore } from "../../../src/app/adapters/session-store";
import { CryptoIdGenerator } from "../../../src/app/adapters/system-clock";
import type { AppEnv } from "../../../src/app/env";
import { runDailyMaintenance } from "../../../src/app/scheduled";
import type { FileStore } from "../../../src/core/ports/file-store";
import { caseRecord, caseType, client, fileRecord, FixedClock, NOW, user } from "../../support/builders";
import { migrate } from "../../support/d1";

const DAY = 24 * 60 * 60 * 1000;
const appEnv = { ...env, ENVIRONMENT: "development" } as unknown as AppEnv;

describe("daily maintenance", () => {
  let repository: D1Repository;
  let store: R2FileStore;
  const clock = new FixedClock();

  beforeAll(async () => {
    repository = new D1Repository(await migrate());
    store = new R2FileStore(env.FILES);
    await repository.users.insert(user({ id: "job-u1", googleSub: "job-s1", officeRole: "Staff", officeStatus: "Active" }));
    await repository.clients.insert(client({ id: "job-c1", code: "JOB1" }));
    await repository.files.insertBatch({ id: "job-b1", uploadedBy: "job-u1", hintClientId: null, createdAt: NOW });
    const trashed = (id: string, days: number) =>
      fileRecord({
        id, batchId: "job-b1", clientId: "job-c1", displayName: `N_${id}`, r2Key: `files/${id}`, sha256: id.padEnd(64, "0"),
        state: "Trashed", trashedFrom: "Staged", trashedAt: new Date(NOW.getTime() - days * DAY),
      });
    for (const file of [trashed("job-old", 31), trashed("job-edge", 30), trashed("job-new", 29)]) {
      await repository.files.insert(file);
      await store.put(file.r2Key, new Uint8Array([1]));
    }
    await repository.files.insert(fileRecord({ id: "job-live", batchId: "job-b1", clientId: "job-c1", displayName: "N_job-live", r2Key: "files/job-live", sha256: "f".repeat(64) }));
    await store.put("files/job-live", new Uint8Array([1]));

    const invitation = (id: string, expiresAt: Date, status: "Issued" | "Redeemed") => ({
      id, codeHash: `hash-${id}`, targetType: "Client" as const, clientId: "job-c1", officeRole: null, issuedBy: "job-u1", expiresAt, status,
      redeemedBy: null, redeemedAt: null, createdAt: NOW,
    });
    await repository.invitations.insert(invitation("job-i-old", new Date(NOW.getTime() - 1000), "Issued"));
    await repository.invitations.insert(invitation("job-i-live", new Date(NOW.getTime() + DAY), "Issued"));
    await repository.invitations.insert(invitation("job-i-used", new Date(NOW.getTime() - 1000), "Redeemed"));

    // NOW is 24 November 2026 in the office time zone and the retrieval deadline is 90 days after submission.
    await repository.caseTypes.insert(caseType({ id: "job-t1" }));
    const submitted = (id: string, sequence: number, submittedOn: string | null, state: "Submitted" | "Open" | "DocumentReceived" = "Submitted") =>
      caseRecord({ id, clientId: "job-c1", caseTypeId: "job-t1", sequence, referenceCode: `JOB-${sequence}`, submittedOn, state });
    await repository.cases.insert(submitted("job-k-warn", 1, "2026-09-05")); // deadline 4 December: 10 days left
    await repository.cases.insert(submitted("job-k-late", 2, "2026-08-01")); // deadline passed
    await repository.cases.insert(submitted("job-k-far", 3, "2026-09-06")); // 11 days left: caution only
    await repository.cases.insert(submitted("job-k-open", 4, null, "Open"));
    await repository.cases.insert(submitted("job-k-done", 5, "2026-08-01", "DocumentReceived"));
  });

  async function events(name: string): Promise<{ client_id: string | null; actor_kind: string | null; actor_user_id: string | null; attributes: string; occurred_at: string }[]> {
    const rows = await env.DB.prepare("SELECT client_id, actor_kind, actor_user_id, attributes, occurred_at FROM metric_events WHERE name = ? ORDER BY occurred_at, id")
      .bind(name).all<{ client_id: string | null; actor_kind: string | null; actor_user_id: string | null; attributes: string; occurred_at: string }>();
    return rows.results;
  }

  it("erases files trashed 30 days ago or more, expires invitations and removes ended sessions", async () => {
    const sessions = new SessionStore(env.DB, new FixedClock(new Date(NOW.getTime() - 13 * 60 * 60 * 1000)), new CryptoIdGenerator());
    await sessions.create("job-u1");
    const live = await new SessionStore(env.DB, clock, new CryptoIdGenerator()).create("job-u1");

    const report = await runDailyMaintenance(appEnv, { clock });
    expect(report).toEqual({ purge: { purged: 2, skipped: 0, failed: 0 }, expiredInvitations: 1, removedSessions: 1, retrievalWarnings: 2 });

    expect(await repository.files.findById("job-old")).toBeNull();
    expect(await repository.files.findById("job-edge")).toBeNull();
    expect(await store.get("files/job-old")).toBeNull();
    expect((await repository.files.findById("job-new"))?.state).toBe("Trashed");
    expect(await store.get("files/job-new")).not.toBeNull();
    expect(await repository.files.findById("job-live")).not.toBeNull();

    expect((await repository.invitations.findById("job-i-old"))?.status).toBe("Expired");
    expect((await repository.invitations.findById("job-i-live"))?.status).toBe("Issued");
    expect((await repository.invitations.findById("job-i-used"))?.status).toBe("Redeemed");
    expect(await new SessionStore(env.DB, clock, new CryptoIdGenerator()).find(live.token)).not.toBeNull();

    const purges = (await repository.audit.list({ limit: 100, offset: 0 })).filter((entry) => entry.action === "file.purge");
    expect(purges.map((entry) => [entry.targetId, entry.actorUserId, entry.result]).sort()).toEqual([["job-edge", null, "ok"], ["job-old", null, "ok"]]);
    expect(purges.every((entry) => entry.occurredAt.getTime() === clock.now().getTime())).toBe(true);
  });

  it("records once, as the system, each case whose retrieval deadline is 10 days away or less", async () => {
    const warned = await events("case.retrieval_warned");
    expect(warned.map((row) => row.attributes).sort()).toEqual([
      JSON.stringify({ caseId: "job-k-late", level: "expired" }),
      JSON.stringify({ caseId: "job-k-warn", level: "warning" }),
    ]);
    expect(warned.map((row) => [row.client_id, row.actor_kind, row.actor_user_id])).toEqual([["job-c1", "system", null], ["job-c1", "system", null]]);
  });

  it("records what the run did, as counts only", async () => {
    const finished = await events("maintenance.finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ client_id: null, actor_kind: "system", actor_user_id: null, occurred_at: clock.now().toISOString() });
    expect(JSON.parse(finished[0]?.attributes ?? "")).toEqual({
      result: "ok", failedSteps: "", purged: 2, purgeSkipped: 0, purgeFailed: 0, expiredInvitations: 1, removedSessions: 1, retrievalWarnings: 2,
    });
  });

  it("does nothing on a second run, and does not record a warned case again", async () => {
    expect(await runDailyMaintenance(appEnv, { clock })).toEqual({
      purge: { purged: 0, skipped: 0, failed: 0 }, expiredInvitations: 0, removedSessions: 0, retrievalWarnings: 0,
    });
    expect(await events("case.retrieval_warned")).toHaveLength(2);
    expect(await events("maintenance.finished")).toHaveLength(2);
  });

  it("keeps going when a file cannot be erased and reports the failure", async () => {
    const later = new FixedClock(new Date(NOW.getTime() + 2 * DAY));
    const failing: FileStore = {
      put: (key, body) => store.put(key, body),
      get: (key) => store.get(key),
      delete: async () => {
        throw new Error("storage unavailable");
      },
    };
    await repository.invitations.insert({
      id: "job-i-2", codeHash: "hash-job-i-2", targetType: "Client", clientId: "job-c1", officeRole: null, issuedBy: "job-u1",
      expiresAt: new Date(NOW.getTime() + DAY), status: "Issued", redeemedBy: null, redeemedAt: null, createdAt: NOW,
    });
    await expect(runDailyMaintenance(appEnv, { clock: later, store: failing })).rejects.toThrow("maintenance finished with failures: purge_files");
    expect((await repository.invitations.findById("job-i-2"))?.status).toBe("Expired");
    const failed = (await repository.audit.list({ limit: 100, offset: 0 })).filter((entry) => entry.action === "file.purge" && entry.result === "failed");
    expect(failed.map((entry) => entry.targetId)).toEqual(["job-new"]);
    // The failed run is recorded too, with the step that failed.
    const last = (await events("maintenance.finished")).at(-1);
    expect(last?.occurred_at).toBe(later.now().toISOString());
    expect(JSON.parse(last?.attributes ?? "")).toMatchObject({ result: "failed", failedSteps: "purge_files", purgeFailed: 1, expiredInvitations: 2, retrievalWarnings: 1 });
    // Two days on, the third case has 9 days left: it entered the warning period and is recorded once.
    expect((await events("case.retrieval_warned")).map((row) => (JSON.parse(row.attributes) as { caseId: string }).caseId).sort()).toEqual(["job-k-far", "job-k-late", "job-k-warn"]);
  });
});
