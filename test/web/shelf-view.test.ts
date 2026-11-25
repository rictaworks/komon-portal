import { describe, expect, it } from "vitest";
import type { CaseView, DocTypeRecord, FileView } from "../../src/app/web/api/office-types";
import {
  caseLabel, docTypesFor, firstView, SHELF_VIEWS, shelfActions, shelfListPath, sortedReaders,
} from "../../src/app/web/pages/office/shelf-view";

function file(overrides: Partial<FileView>): FileView {
  return {
    id: "f1", direction: "Outbound", displayName: "C0031_SHAHO_20261117_03", format: "pdf", sizeBytes: 10, state: "Published",
    client: null, caseId: null, docType: null, targetMonth: null, resolutionMethod: null, reviewReason: null, evidence: [],
    unmatchedArrivalNumber: null, typeSource: null, jev: null, withdrawReason: null, incident: false,
    receivedAt: "2026-11-17T00:00:00.000Z", publishedAt: "2026-11-17T01:00:00.000Z", acknowledgedAt: null, trashedAt: null, readers: [], version: 1,
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
    expect(shelfActions(file({ direction: "Inbound", state: "Trashed" }))).toEqual(["restore"]);
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
      { id: "1", shortCode: "SHAHO", label: "Social insurance notice", direction: "Outbound" },
      { id: "2", shortCode: "TIME", label: "Time sheet", direction: "Inbound" },
      { id: "3", shortCode: "OTHER", label: "Other", direction: "Both" },
    ];
    expect(docTypesFor("Outbound", types).map((type) => type.id)).toEqual(["1", "3"]);
    expect(docTypesFor("Inbound", types).map((type) => type.id)).toEqual(["2", "3"]);
  });
});
