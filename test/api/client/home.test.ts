import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../../src/app/adapters/d1/d1-repository";
import { apiKit, type ApiClient } from "../../support/api";
import { fileRecord } from "../../support/builders";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
const OWN = "dev-client";
const T0 = new Date("2026-11-01T00:00:00.000Z");
/** More published documents than the home view shows at once. */
const SHELF = 120;
const HOME_LIMIT = 100;

const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const fileId = (index: number): string => `home-${String(index).padStart(3, "0")}`;

describe("client home: unread documents", () => {
  let member: ApiClient;
  let repository: D1Repository;
  let memberId = "";
  let staffId = "";

  async function home(): Promise<{ unread: Json[]; unreadTotal: number; truncated: { documents: boolean; cases: boolean } }> {
    const response = await member.call("GET", `/api/client/${OWN}/home`);
    expect(response.status).toBe(200);
    return (await response.json()) as { unread: Json[]; unreadTotal: number; truncated: { documents: boolean; cases: boolean } };
  }

  async function open(index: number, userId: string): Promise<void> {
    expect(await repository.receipts.insertIfAbsent({ id: `r-${userId}-${fileId(index)}`, fileId: fileId(index), userId, firstViewedAt: at(9000) })).toBe(true);
  }

  beforeAll(async () => {
    repository = new D1Repository(await migrate());
    const kit = apiKit();
    member = kit.client();
    const staff = kit.client();
    memberId = (await member.signIn("member")).userId;
    staffId = (await staff.signIn("staff")).userId;
    await repository.files.insertBatch({ id: "home-batch", uploadedBy: staffId, hintClientId: OWN, createdAt: T0 });
    // File 0 is the oldest intake and file 119 the newest. Each is published in intake order,
    // except file 0, which is published last of all: old on the shelf, new to the client.
    for (let index = 0; index < SHELF; index += 1) {
      const row = fileRecord({
        id: fileId(index), batchId: "home-batch", clientId: OWN, displayName: `DEMO01_UNCLASSIFIED_20261101_${fileId(index)}`,
        sha256: index.toString(16).padStart(64, "0"), state: "Published", receivedAt: at(index), publishedAt: at(index === 0 ? 5000 : 1000 + index),
      });
      expect(await repository.files.insert(row)).toBe("ok");
    }
  });

  it("puts the most recently published document first and reports how many are unread in all", async () => {
    const view = await home();
    expect(view.unreadTotal).toBe(SHELF);
    expect(view.unread).toHaveLength(HOME_LIMIT);
    expect(view.truncated.documents).toBe(true);
    // Publication order, newest first: file 0, then 119 down to 21.
    expect(view.unread.map((item) => item.id)).toEqual([fileId(0), ...Array.from({ length: HOME_LIMIT - 1 }, (_, offset) => fileId(SHELF - 1 - offset))]);
    expect(view.unread[0]).toMatchObject({ publishedAt: at(5000).toISOString() });
  });

  it("still lists old unread documents when more than 100 newer ones have been read", async () => {
    // The member has read the 110 most recently received documents; files 0 to 9 stay unread.
    for (let index = 10; index < SHELF; index += 1) {
      await open(index, memberId);
    }
    const view = await home();
    expect(view.unread.map((item) => item.id)).toEqual([fileId(0), fileId(9), fileId(8), fileId(7), fileId(6), fileId(5), fileId(4), fileId(3), fileId(2), fileId(1)]);
    expect(view.unreadTotal).toBe(10);
    expect(view.truncated.documents).toBe(false);
  });

  it("counts a document as read only for the member who opened it", async () => {
    await open(5, staffId);
    const view = await home();
    expect(view.unread.map((item) => item.id)).toContain(fileId(5));
    expect(view.unreadTotal).toBe(10);
  });

  it("leaves out documents that were withdrawn, belong to another client or are being purged", async () => {
    await env.DB.prepare("INSERT INTO clients (id, code, corporate_name, status, version) VALUES ('home-other', 'HOME02', 'Other company', 'Active', 1)").run();
    expect(await repository.files.insert(fileRecord({
      id: "home-foreign", batchId: "home-batch", clientId: "home-other", displayName: "HOME02_UNCLASSIFIED_20261101_01",
      sha256: "f".repeat(64), state: "Published", receivedAt: at(1), publishedAt: at(6000),
    }))).toBe("ok");
    const withdrawn = await repository.files.findById(fileId(1));
    const trashed = await repository.files.findById(fileId(2));
    if (withdrawn === null || trashed === null) {
      throw new Error("seeded files are missing");
    }
    expect(await repository.files.update({ ...withdrawn, state: "Withdrawn", withdrawReason: "Other", version: 2 }, 1)).toBe("ok");
    expect(await repository.files.update({ ...trashed, state: "Trashed", trashedFrom: "Withdrawn", withdrawReason: "Other", trashedAt: at(7000), version: 2 }, 1)).toBe("ok");
    expect(await repository.files.beginPurge(fileId(2), at(7000), at(7001))).toBe(true);

    const view = await home();
    expect(view.unread.map((item) => item.id)).toEqual([fileId(0), fileId(9), fileId(8), fileId(7), fileId(6), fileId(5), fileId(4), fileId(3)]);
    expect(view.unreadTotal).toBe(8);
  });
});
