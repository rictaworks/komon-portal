import type { CaseView, DocTypeRecord, FileView, Reader } from "../../api/office-types";
import { formatMonth } from "../../components/format";

/** Rules of the Shelf screen that do not need React: what is listed, and which actions a row offers. */

export type ShelfDirection = "Outbound" | "Inbound";
export type ShelfView = "Published" | "Withdrawn" | "Received" | "Trashed";
export type ShelfAction = "linkCase" | "withdraw" | "trash" | "restore";

export const SHELF_DIRECTIONS: readonly ShelfDirection[] = ["Outbound", "Inbound"];

/** The views of each direction. The first one is shown when the direction is chosen. */
export const SHELF_VIEWS: Readonly<Record<ShelfDirection, readonly ShelfView[]>> = {
  Outbound: ["Published", "Withdrawn", "Trashed"],
  Inbound: ["Received", "Trashed"],
};

const VIEW_STATES: Readonly<Record<ShelfView, readonly string[]>> = {
  Published: ["Published"],
  Withdrawn: ["Withdrawn"],
  Received: ["Submitted", "Acknowledged"],
  Trashed: ["Trashed"],
};

const LIST_LIMIT = 200;

export interface ShelfQuery {
  clientId: string;
  direction: ShelfDirection;
  view: ShelfView;
  /** An empty string means "not narrowed". */
  docTypeId: string;
  targetMonth: string;
  caseId: string;
}

/** Path of the file list for one client, direction and view, narrowed by the chosen filters. */
export function shelfListPath(query: ShelfQuery): string {
  if (!SHELF_VIEWS[query.direction].includes(query.view)) {
    throw new Error(`view ${query.view} does not belong to ${query.direction}`);
  }
  const parameters = new URLSearchParams({ direction: query.direction, clientId: query.clientId, states: VIEW_STATES[query.view].join(",") });
  if (query.docTypeId !== "") {
    parameters.set("docTypeId", query.docTypeId);
  }
  if (query.targetMonth !== "") {
    parameters.set("targetMonth", query.targetMonth);
  }
  if (query.caseId !== "") {
    parameters.set("caseId", query.caseId);
  }
  parameters.set("limit", String(LIST_LIMIT));
  return `/api/office/files?${parameters.toString().replaceAll("+", "%20")}`;
}

/**
 * Actions offered on a row, in display order. Linking to a case exists for submissions only: the
 * server refuses it on anything the office sent. A submission can be trashed once the office has opened it.
 */
export function shelfActions(file: Pick<FileView, "direction" | "state">): ShelfAction[] {
  if (file.state === "Trashed") {
    return ["restore"];
  }
  if (file.direction === "Inbound") {
    return file.state === "Acknowledged" ? ["linkCase", "trash"] : ["linkCase"];
  }
  if (file.state === "Published") {
    return ["withdraw"];
  }
  return file.state === "Withdrawn" ? ["trash"] : [];
}

/** Readers ordered by the time of their first view, earliest first. */
export function sortedReaders(readers: readonly Reader[]): Reader[] {
  return [...readers].sort((left, right) => left.firstViewedAt.localeCompare(right.firstViewedAt));
}

/** When the file was first opened by anyone on the client side, or null when it is unread. */
export function firstView(readers: readonly Reader[]): string | null {
  return sortedReaders(readers)[0]?.firstViewedAt ?? null;
}

/** The month and number are part of the name so two cases of the same type cannot be confused. */
export function caseLabel(record: Pick<CaseView, "caseType" | "targetMonth" | "sequence">): string {
  const parts = [formatMonth(record.targetMonth), `#${record.sequence}`];
  return (record.caseType === null ? parts : [record.caseType.label, ...parts]).join(" ");
}

/** Document types that can travel in the shown direction. */
export function docTypesFor(direction: ShelfDirection, docTypes: readonly DocTypeRecord[]): DocTypeRecord[] {
  return docTypes.filter((docType) => docType.direction === direction || docType.direction === "Both");
}
