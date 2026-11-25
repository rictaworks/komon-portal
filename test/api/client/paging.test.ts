import { beforeAll, describe, expect, it } from "vitest";
import { D1Repository } from "../../../src/app/adapters/d1/d1-repository";
import { apiKit, type ApiClient } from "../../support/api";
import { fileRecord } from "../../support/builders";
import { migrate } from "../../support/d1";

type Json = Record<string, unknown>;
interface ListPage {
  items: Json[];
  hasMore: boolean;
}

const OWN = "dev-client";
const T0 = new Date("2026-11-01T00:00:00.000Z");
const ROWS = 5;

const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

describe("client lists: paging to the end", () => {
  let member: ApiClient;

  async function page(list: "documents" | "submissions", query: string): Promise<ListPage> {
    const response = await member.call("GET", `/api/client/${OWN}/${list}?${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as ListPage;
  }

  /** Follows `hasMore` from the first page until the server says nothing is left. */
  async function walk(list: "documents" | "submissions", limit: number, filter = ""): Promise<string[][]> {
    const pages: string[][] = [];
    let more = true;
    while (more) {
      expect(pages.length).toBeLessThan(ROWS + 1);
      const answer = await page(list, `limit=${limit}&offset=${pages.length * limit}${filter}`);
      pages.push(answer.items.map((item) => String(item.id)));
      more = answer.hasMore;
    }
    return pages;
  }

  beforeAll(async () => {
    const repository = new D1Repository(await migrate());
    const kit = apiKit();
    member = kit.client();
    const staff = kit.client();
    const memberId = (await member.signIn("member")).userId;
    const staffId = (await staff.signIn("staff")).userId;
    await repository.files.insertBatch({ id: "page-out", uploadedBy: staffId, hintClientId: OWN, createdAt: T0 });
    await repository.files.insertBatch({ id: "page-in", uploadedBy: memberId, hintClientId: OWN, createdAt: T0 });
    for (let index = 0; index < ROWS; index += 1) {
      const published = fileRecord({
        id: `doc-${index}`, batchId: "page-out", clientId: OWN, sha256: `a${index}`.padStart(64, "0"), state: "Published",
        targetMonth: index === 0 ? "2026-10" : "2026-11", receivedAt: at(index), publishedAt: at(100 + index),
      });
      const submitted = fileRecord({
        id: `sub-${index}`, batchId: "page-in", direction: "Inbound", clientId: OWN, sha256: `b${index}`.padStart(64, "0"), state: "Submitted",
        targetMonth: "2026-11", resolutionMethod: null, receivedAt: at(index),
      });
      expect(await repository.files.insert(published)).toBe("ok");
      expect(await repository.files.insert(submitted)).toBe("ok");
    }
  });

  it("tells whether published documents exist beyond the page, up to the last one", async () => {
    expect(await walk("documents", 2)).toEqual([["doc-4", "doc-3"], ["doc-2", "doc-1"], ["doc-0"]]);
    expect(await page("documents", "limit=5&offset=0")).toMatchObject({ hasMore: false });
    expect(await page("documents", "limit=4&offset=0")).toMatchObject({ hasMore: true });
    expect(await page("documents", "limit=2&offset=6")).toEqual({ items: [], hasMore: false });
  });

  it("pages within a filter, not over the whole shelf", async () => {
    expect(await walk("documents", 2, "&targetMonth=2026-11")).toEqual([["doc-4", "doc-3"], ["doc-2", "doc-1"]]);
    expect(await walk("documents", 2, "&targetMonth=2026-10")).toEqual([["doc-0"]]);
  });

  it("tells whether sent files exist beyond the page, up to the last one", async () => {
    expect(await walk("submissions", 2)).toEqual([["sub-4", "sub-3"], ["sub-2", "sub-1"], ["sub-0"]]);
    expect(await page("submissions", "limit=5&offset=0")).toMatchObject({ hasMore: false });
    expect(await page("submissions", "limit=200&offset=0")).toMatchObject({ hasMore: false });
  });

  it("answers the default page with the flag when no paging is asked for", async () => {
    const response = await member.call("GET", `/api/client/${OWN}/documents`);
    expect(await response.json()).toMatchObject({ hasMore: false });
  });

  it("refuses malformed paging instead of guessing", async () => {
    for (const query of ["limit=0", "limit=201", "limit=abc", "offset=-1"]) {
      for (const list of ["documents", "submissions"]) {
        const response = await member.call("GET", `/api/client/${OWN}/${list}?${query}`);
        expect([list, query, response.status]).toEqual([list, query, 400]);
      }
    }
  });
});
