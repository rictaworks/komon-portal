import { describe, expect, it } from "vitest";
import type { SendResult } from "../../src/app/web/api/client-types";
import { CLIENT_PAGE_SIZE, documentsPath, emptiedPage, requestedPage, sendEach, shownPage, submissionsPath, unsent, type PageOf, type SendOutcome } from "../../src/app/web/pages/client/client-lists";

describe("client list requests", () => {
  it("asks for the first page of documents with no filter", () => {
    expect(documentsPath("c 1", { docTypeId: "", targetMonth: "", page: 0 })).toBe(`/api/client/c%201/documents?limit=${CLIENT_PAGE_SIZE}&offset=0`);
  });

  it("keeps the filters while moving to a later page", () => {
    const query = new URL(documentsPath("c1", { docTypeId: "d1", targetMonth: "2026-11", page: 3 }), "https://example.invalid").searchParams;
    expect(Object.fromEntries(query)).toEqual({ limit: String(CLIENT_PAGE_SIZE), offset: String(3 * CLIENT_PAGE_SIZE), docTypeId: "d1", targetMonth: "2026-11" });
  });

  it("asks for a page of sent files", () => {
    expect(submissionsPath("c1", 2)).toBe(`/api/client/c1/submissions?limit=${CLIENT_PAGE_SIZE}&offset=${2 * CLIENT_PAGE_SIZE}`);
  });

  it("refuses a page that does not exist", () => {
    expect(() => submissionsPath("c1", -1)).toThrow("page");
    expect(() => documentsPath("c1", { docTypeId: "", targetMonth: "", page: 1.5 })).toThrow("page");
  });
});

describe("the page on the screen", () => {
  const loaded = (page: number, items: string[], hasMore: boolean, list = "sent"): PageOf<string> => ({ list, page, items, hasMore });

  it("labels the rows with the page they were loaded for when a later page fails to load", () => {
    // Page 1 is on the screen, page 2 was asked for and its request failed: the rows are still those of page 1.
    const shown = shownPage(loaded(0, ["a", "b"], true), "sent");
    expect(shown?.page).toBe(0);
    expect(shown?.hasMore).toBe(true);
    expect(shown?.items).toEqual(["a", "b"]);
  });

  it("never shows the rows of another list", () => {
    expect(shownPage(loaded(2, ["a"], false, "documents?docTypeId=d1"), "documents?docTypeId=d2")).toBeNull();
    expect(shownPage(null, "sent")).toBeNull();
  });

  it("starts a new list at its first page", () => {
    expect(requestedPage({ list: "documents?docTypeId=d1", page: 3 }, "documents?docTypeId=d1")).toBe(3);
    expect(requestedPage({ list: "documents?docTypeId=d1", page: 3 }, "documents?docTypeId=d2")).toBe(0);
  });

  it("steps back from a later page that has become empty instead of calling the list empty", () => {
    const emptied = loaded(1, [], false);
    expect(emptiedPage(emptied, "sent", 1)).toBe(0);
    expect(shownPage(emptied, "sent")).toBeNull();
    expect(emptiedPage(loaded(4, [], false), "sent", 4)).toBe(3);
  });

  it("stays on a page that has rows, and on an empty first page", () => {
    expect(emptiedPage(loaded(1, ["a"], false), "sent", 1)).toBeNull();
    expect(emptiedPage(loaded(0, [], false), "sent", 0)).toBeNull();
    expect(shownPage(loaded(0, [], false), "sent")).toEqual(loaded(0, [], false));
  });

  it("does not step back on the rows of another request", () => {
    expect(emptiedPage(loaded(1, [], false), "sent", 0)).toBeNull();
    expect(emptiedPage(loaded(1, [], false, "other"), "sent", 1)).toBeNull();
    expect(emptiedPage(null, "sent", 1)).toBeNull();
  });
});

describe("sending several files", () => {
  const failure = new Error("offline");
  const answers: Record<string, () => Promise<SendResult>> = {
    "a.pdf": () => Promise.resolve({ outcome: "stored" }),
    "b.exe": () => Promise.resolve({ outcome: "rejected", reason: "UnsupportedFormat" }),
    "c.pdf": () => Promise.reject(failure),
    "d.pdf": () => Promise.resolve({ outcome: "duplicate" }),
    "e.pdf": () => Promise.resolve({ outcome: "stored" }),
  };
  const send = (name: string): Promise<SendResult> => {
    const answer = answers[name];
    if (answer === undefined) {
      throw new Error(`unexpected file ${name}`);
    }
    return answer();
  };

  it("sends each file on its own, in order, and gives every file its own result", async () => {
    const calls: string[] = [];
    const reported: Array<[number, string]> = [];
    const outcomes = await sendEach(
      Object.keys(answers),
      (name) => {
        calls.push(name);
        return send(name);
      },
      (index, outcome) => reported.push([index, outcome.outcome]),
      () => true,
    );
    expect(calls).toEqual(["a.pdf", "b.exe", "c.pdf", "d.pdf", "e.pdf"]);
    expect(outcomes).toEqual([
      { outcome: "stored" },
      { outcome: "rejected", reason: "UnsupportedFormat" },
      { outcome: "failed", error: failure },
      { outcome: "duplicate" },
      { outcome: "stored" },
    ]);
    expect(reported).toEqual([[0, "stored"], [1, "rejected"], [2, "failed"], [3, "duplicate"], [4, "stored"]]);
  });

  it("never runs two sends at the same time", async () => {
    let running = 0;
    let most = 0;
    await sendEach([1, 2, 3], async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      return { outcome: "stored" };
    }, () => undefined, () => true);
    expect(most).toBe(1);
  });

  it("stops before the next file once the screen is gone", async () => {
    const calls: string[] = [];
    const reported: number[] = [];
    const outcomes = await sendEach(
      ["a.pdf", "d.pdf", "e.pdf"],
      (name) => {
        calls.push(name);
        return send(name);
      },
      (index) => reported.push(index),
      // The member leaves while the first file is on its way.
      () => calls.length < 1,
    );
    expect(calls).toEqual(["a.pdf"]);
    expect(outcomes).toEqual([{ outcome: "stored" }]);
    expect(reported).toEqual([0]);
  });

  it("sends nothing when the screen is already gone", async () => {
    const calls: string[] = [];
    expect(await sendEach(["a.pdf"], (name) => { calls.push(name); return send(name); }, () => undefined, () => false)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("keeps only the files that were not sent", () => {
    const outcomes: SendOutcome[] = [{ outcome: "stored" }, { outcome: "rejected", reason: "TooLarge" }, { outcome: "failed", error: failure }];
    expect(unsent(["a", "b", "c"], outcomes)).toEqual(["b", "c"]);
    expect(() => unsent(["a"], outcomes)).toThrow("result");
  });
});
