import { describe, expect, it } from "vitest";
import type { CaseView, DocTypeRecord, FileView } from "../../src/app/web/api/office-types";
import {
  cancelledByClient, caseLabel, docTypesFor, firstView, linkTarget, loadAllPages, monthFilter, SHELF_VIEWS, shelfActions, shelfCountPath, shelfDirectionOf, shelfListPath,
  shelfPath, shownCounts, shownList, sortedReaders, withdrawReasonOf,
} from "../../src/app/web/pages/office/shelf-view";

describe("withdrawReasonOf", () => {
  it("has no reason until one of the four reasons is chosen", () => {
    expect(withdrawReasonOf("")).toBeNull();
    expect(withdrawReasonOf("WrongClient")).toBe("WrongClient");
    expect(withdrawReasonOf("WrongFile")).toBe("WrongFile");
    expect(withdrawReasonOf("Superseded")).toBe("Superseded");
    expect(withdrawReasonOf("Other")).toBe("Other");
  });

  it("refuses a value that is not a withdraw reason instead of passing it on", () => {
    expect(withdrawReasonOf("Trashed")).toBeNull();
    expect(withdrawReasonOf("wrongclient")).toBeNull();
  });
});

describe("shelfCountPath", () => {
  it("counts every view of a direction in one request, without fetching rows", () => {
    const outbound = new URL(shelfCountPath({ clientId: "c1", direction: "Outbound", docTypeId: "", targetMonth: "", caseId: "" }), "https://example.invalid");
    expect(outbound.pathname).toBe("/api/office/files");
    expect(outbound.searchParams.get("direction")).toBe("Outbound");
    expect(outbound.searchParams.get("clientId")).toBe("c1");
    expect(outbound.searchParams.get("states")?.split(",").sort()).toEqual(["Published", "Trashed", "Withdrawn"]);
    expect(outbound.searchParams.get("limit")).toBe("1");
  });

  it("counts the submissions of a direction across its views", () => {
    const inbound = new URL(shelfCountPath({ clientId: "c1", direction: "Inbound", docTypeId: "", targetMonth: "", caseId: "" }), "https://example.invalid");
    expect(inbound.searchParams.get("direction")).toBe("Inbound");
    expect(inbound.searchParams.get("states")?.split(",").sort()).toEqual(["Acknowledged", "Submitted", "Trashed"]);
  });

  it("applies the same filters as the list, so the count matches what the tab shows", () => {
    const query = new URL(
      shelfCountPath({ clientId: "c1", direction: "Outbound", docTypeId: "d1", targetMonth: "2026-11", caseId: "k1" }),
      "https://example.invalid",
    ).searchParams;
    expect(query.get("docTypeId")).toBe("d1");
    expect(query.get("targetMonth")).toBe("2026-11");
    expect(query.get("caseId")).toBe("k1");
  });
});

function file(overrides: Partial<FileView>): FileView {
  return {
    id: "f1", direction: "Outbound", displayName: "C0031_SHAHO_20261117_03", format: "pdf", sizeBytes: 10, state: "Published",
    client: null, caseId: null, caseRef: null, docType: null, targetMonth: null, resolutionMethod: null, reviewReason: null, evidence: [],
    unmatchedArrivalNumber: null, typeSource: null, jev: null, withdrawReason: null, incident: false,
    receivedAt: "2026-11-17T00:00:00.000Z", publishedAt: "2026-11-17T01:00:00.000Z", acknowledgedAt: null, trashedAt: null, trashedFrom: null, readers: [], version: 1,
    ...overrides,
  };
}

describe("shelfListPath", () => {
  it("lists what the client sent as inbound files that are submitted or acknowledged", () => {
    const path = shelfListPath({ clientId: "c 1", direction: "Inbound", view: "Received", docTypeId: "", targetMonth: "", caseId: "" });
    expect(path).toBe("/api/office/files?direction=Inbound&clientId=c%201&states=Submitted%2CAcknowledged&limit=200");
  });

  it("lists published outbound files without filters by default", () => {
    const path = shelfListPath({ clientId: "c1", direction: "Outbound", view: "Published", docTypeId: "", targetMonth: "", caseId: "" });
    expect(path).toBe("/api/office/files?direction=Outbound&clientId=c1&states=Published&limit=200");
  });

  it("narrows by document type, target month and case", () => {
    const path = shelfListPath({ clientId: "c1", direction: "Outbound", view: "Withdrawn", docTypeId: "d1", targetMonth: "2026-11", caseId: "k1" });
    const query = new URL(path, "https://example.invalid").searchParams;
    expect(query.get("states")).toBe("Withdrawn");
    expect(query.get("docTypeId")).toBe("d1");
    expect(query.get("targetMonth")).toBe("2026-11");
    expect(query.get("caseId")).toBe("k1");
  });

  it("refuses a view that does not belong to the direction", () => {
    expect(() => shelfListPath({ clientId: "c1", direction: "Inbound", view: "Published", docTypeId: "", targetMonth: "", caseId: "" })).toThrow("view");
  });

  it("offers a trash view in both directions", () => {
    expect(SHELF_VIEWS.Outbound).toEqual(["Published", "Withdrawn", "Trashed"]);
    expect(SHELF_VIEWS.Inbound).toEqual(["Received", "Trashed"]);
  });
});

describe("shelfActions", () => {
  it("never offers link case on an outbound file", () => {
    for (const state of ["Published", "Withdrawn", "Trashed"]) {
      expect(shelfActions(file({ direction: "Outbound", state }))).not.toContain("linkCase");
    }
    expect(shelfActions(file({ state: "Published" }))).toEqual(["withdraw"]);
    expect(shelfActions(file({ state: "Withdrawn" }))).toEqual(["trash"]);
    expect(shelfActions(file({ state: "Trashed" }))).toEqual(["restore"]);
  });

  it("offers link case on a submission, and the trash only once the office has opened it", () => {
    expect(shelfActions(file({ direction: "Inbound", state: "Submitted" }))).toEqual(["linkCase"]);
    expect(shelfActions(file({ direction: "Inbound", state: "Acknowledged" }))).toEqual(["linkCase", "trash"]);
    expect(shelfActions(file({ direction: "Inbound", state: "Trashed", trashedFrom: "Acknowledged" }))).toEqual(["restore"]);
  });

  it("does not offer to restore a submission the client cancelled", () => {
    const cancelled = file({ direction: "Inbound", state: "Trashed", trashedFrom: "Submitted" });
    expect(cancelledByClient(cancelled)).toBe(true);
    expect(shelfActions(cancelled)).toEqual([]);
    expect(cancelledByClient(file({ direction: "Inbound", state: "Trashed", trashedFrom: "Acknowledged" }))).toBe(false);
    expect(cancelledByClient(file({ direction: "Outbound", state: "Trashed", trashedFrom: "Withdrawn" }))).toBe(false);
    expect(cancelledByClient(file({ direction: "Inbound", state: "Submitted" }))).toBe(false);
  });
});

describe("linkTarget", () => {
  it("follows the listed row, so a retry after a conflict sends the current version", () => {
    const before = [file({ id: "s1", direction: "Inbound", state: "Submitted", version: 1 })];
    const after = [file({ id: "s1", direction: "Inbound", state: "Acknowledged", version: 2 })];
    expect(linkTarget(before, "s1")?.version).toBe(1);
    expect(linkTarget(after, "s1")?.version).toBe(2);
  });

  it("is gone when the row is no longer listed or can no longer be linked", () => {
    expect(linkTarget([], "s1")).toBeNull();
    expect(linkTarget([file({ id: "s1", direction: "Inbound", state: "Trashed", trashedFrom: "Acknowledged" })], "s1")).toBeNull();
    expect(linkTarget([file({ id: "s1", direction: "Inbound", state: "Submitted" })], null)).toBeNull();
  });
});

describe("shownList", () => {
  const list = { items: [file({})], total: 1 };

  it("shows the list only when it answers the question on screen", () => {
    expect(shownList({ path: "/a", list }, "/a", null)).toBe(list);
    expect(shownList({ path: "/a", list }, "/b", null)).toBeNull();
    expect(shownList(null, "/a", null)).toBeNull();
  });

  it("shows nothing after a failed load instead of the rows of the previous view", () => {
    expect(shownList({ path: "/a", list }, "/b", new Error("offline"))).toBeNull();
    expect(shownList({ path: "/a", list }, "/a", new Error("offline"))).toBeNull();
  });
});

describe("shownCounts", () => {
  const totals = { Outbound: 12, Inbound: 3 };

  it("shows the totals only for the filters they were loaded for", () => {
    expect(shownCounts({ key: "client-a", totals }, "client-a", null)).toBe(totals);
    expect(shownCounts({ key: "client-a", totals }, "client-b", null)).toBeNull();
    expect(shownCounts(null, "client-a", null)).toBeNull();
  });

  it("shows nothing after a failed reload, instead of the totals of the previous selection", () => {
    expect(shownCounts({ key: "client-a", totals }, "client-b", new Error("offline"))).toBeNull();
    expect(shownCounts({ key: "client-a", totals }, "client-a", new Error("offline"))).toBeNull();
  });
});

describe("monthFilter", () => {
  it("accepts an empty text as no filter and a complete month as the filter", () => {
    expect(monthFilter("")).toEqual({ valid: true, value: "" });
    expect(monthFilter("2026-11")).toEqual({ valid: true, value: "2026-11" });
  });

  it("refuses partial or differently written months, and never sends them", () => {
    for (const text of ["2", "2026-1", "11/2026", "2026/11", "2026-13", "2026-00", " 2026-11", "2026-11-01"]) {
      expect([text, monthFilter(text)]).toEqual([text, { valid: false, value: "" }]);
    }
  });
});

describe("loadAllPages", () => {
  it("reads page after page until one is not full, so nothing is cut off", async () => {
    const all = Array.from({ length: 5 }, (_, index) => index);
    const offsets: number[] = [];
    const loaded = await loadAllPages(async (offset) => {
      offsets.push(offset);
      return all.slice(offset, offset + 2);
    }, 2);
    expect(loaded).toEqual(all);
    expect(offsets).toEqual([0, 2, 4]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const offsets: number[] = [];
    const loaded = await loadAllPages(async (offset) => {
      offsets.push(offset);
      return offset === 0 ? ["a", "b"] : [];
    }, 2);
    expect(loaded).toEqual(["a", "b"]);
    expect(offsets).toEqual([0, 2]);
  });

  it("passes a failure on instead of returning a part of the list", async () => {
    await expect(loadAllPages(async (offset) => (offset === 0 ? [1, 2] : Promise.reject(new Error("offline"))), 2)).rejects.toThrow("offline");
  });
});

describe("readers", () => {
  it("orders readers by the time of their first view", () => {
    const readers = [
      { displayName: "B", firstViewedAt: "2026-11-18T09:30:00.000Z" },
      { displayName: "A", firstViewedAt: "2026-11-17T12:00:00.000Z" },
    ];
    expect(sortedReaders(readers).map((reader) => reader.displayName)).toEqual(["A", "B"]);
    expect(readers[0]?.displayName).toBe("B");
  });

  it("gives the earliest view, or null when nobody opened the file", () => {
    expect(firstView([])).toBeNull();
    expect(
      firstView([
        { displayName: "B", firstViewedAt: "2026-11-18T09:30:00.000Z" },
        { displayName: null, firstViewedAt: "2026-11-17T12:00:00.000Z" },
      ]),
    ).toBe("2026-11-17T12:00:00.000Z");
  });
});

describe("caseLabel", () => {
  const record = { id: "k1", caseType: { id: "t1", kind: "Payroll", label: "Payroll" }, targetMonth: "2026-11", sequence: 2 } as CaseView;

  it("names a case by type, month and number so two cases of a month are not confused", () => {
    expect(caseLabel(record)).toBe("Payroll November 2026 #2");
  });

  it("leaves out a missing case type instead of inventing one", () => {
    expect(caseLabel({ ...record, caseType: null })).toBe("November 2026 #2");
  });
});

describe("docTypesFor", () => {
  it("keeps the document types that can travel in the shown direction", () => {
    const types: DocTypeRecord[] = [
      { id: "1", shortCode: "SHAHO", label: "Social insurance notice", direction: "Outbound", caseTypeId: null },
      { id: "2", shortCode: "TIME", label: "Time sheet", direction: "Inbound", caseTypeId: null },
      { id: "3", shortCode: "OTHER", label: "Other", direction: "Both", caseTypeId: null },
    ];
    expect(docTypesFor("Outbound", types).map((type) => type.id)).toEqual(["1", "3"]);
    expect(docTypesFor("Inbound", types).map((type) => type.id)).toEqual(["2", "3"]);
  });
});

describe("opening the shelf on a direction", () => {
  it("builds a link that opens a client's shelf on what the client sent", () => {
    expect(shelfPath("c 1", "Inbound")).toBe("/office/shelf/c%201?direction=Inbound");
    expect(shelfDirectionOf(new URL(shelfPath("c1", "Inbound"), "https://portal.test").search)).toBe("Inbound");
  });

  it("opens on what the office sent unless the link names the other direction", () => {
    expect(shelfPath("c1", "Outbound")).toBe("/office/shelf/c1");
    expect(shelfDirectionOf("")).toBe("Outbound");
    expect(shelfDirectionOf("?direction=Outbound")).toBe("Outbound");
    expect(shelfDirectionOf("?direction=inbound")).toBe("Outbound");
  });
});
