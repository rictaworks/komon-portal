import { describe, expect, it } from "vitest";
import { clientListPath, rowsFor } from "../../src/app/web/pages/office/client-list";

describe("client list requests", () => {
  it("asks for one row more than a page, with the member counts and the chosen filters", () => {
    expect(clientListPath({ status: "Active", search: "", offset: 0, pageSize: 25 })).toBe("/api/office/clients?include=members&limit=26&offset=0&status=Active");
    expect(clientListPath({ status: null, search: "Hinode & Co", offset: 50, pageSize: 25 })).toBe("/api/office/clients?include=members&limit=26&offset=50&query=Hinode+%26+Co");
  });

  it("shows only rows that were loaded for the current filters and page", () => {
    const active = clientListPath({ status: "Active", search: "", offset: 0, pageSize: 2 });
    const closed = clientListPath({ status: "Closed", search: "", offset: 0, pageSize: 2 });
    const loaded = { path: active, items: ["a", "b", "c"] };
    expect(rowsFor(loaded, active, 2)).toEqual({ rows: ["a", "b"], hasNext: true });
    expect(rowsFor({ path: active, items: ["a"] }, active, 2)).toEqual({ rows: ["a"], hasNext: false });
    // While the Closed list is loading, or after it failed, the Active rows are not shown under the Closed filter.
    expect(rowsFor(loaded, closed, 2)).toBeNull();
    expect(rowsFor(null, active, 2)).toBeNull();
  });
});
