export interface ClientListFilter {
  /** Null lists clients of every status. */
  status: string | null;
  search: string;
  offset: number;
  pageSize: number;
}

/** The rows of one request, kept with the request they answer. */
export interface ClientListPage<T> {
  path: string;
  items: T[];
}

/** The list request for the given filters. One row more than a page is requested, which tells whether a next page exists. */
export function clientListPath(filter: ClientListFilter): string {
  const parameters = new URLSearchParams({ include: "members", limit: String(filter.pageSize + 1), offset: String(filter.offset) });
  if (filter.status !== null) {
    parameters.set("status", filter.status);
  }
  if (filter.search !== "") {
    parameters.set("query", filter.search);
  }
  return `/api/office/clients?${parameters.toString()}`;
}

/** The rows to show for `path`, or null when the loaded rows answer another request (a load in flight or a failed one). */
export function rowsFor<T>(loaded: ClientListPage<T> | null, path: string, pageSize: number): { rows: T[]; hasNext: boolean } | null {
  if (loaded === null || loaded.path !== path) {
    return null;
  }
  return { rows: loaded.items.slice(0, pageSize), hasNext: loaded.items.length > pageSize };
}
