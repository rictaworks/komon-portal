import { LIST_LIMIT } from "./list-limit";

/** The type filter value for documents that have no type yet. */
export const UNCLASSIFIED = "unclassified";

export interface StagedFilter {
  /** Empty lists the documents of every client. */
  clientId: string;
  /** A document type id, `UNCLASSIFIED`, or empty for every type. */
  docType: string;
}

/** The request for the staged documents of a filter. The server does all the narrowing. */
export function stagedFilesPath(filter: StagedFilter): string {
  const parameters = new URLSearchParams({ direction: "Outbound", states: "Staged", limit: String(LIST_LIMIT) });
  if (filter.clientId !== "") {
    parameters.set("clientId", filter.clientId);
  }
  if (filter.docType === UNCLASSIFIED) {
    parameters.set("untyped", "true");
  } else if (filter.docType !== "") {
    parameters.set("docTypeId", filter.docType);
  }
  return `/api/office/files?${parameters.toString()}`;
}
