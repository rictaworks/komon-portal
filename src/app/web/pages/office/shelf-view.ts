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

const DIRECTION_PARAMETER = "direction";

/** The address of a client's shelf. The direction is named only when it is not the one the shelf opens on. */
export function shelfPath(clientId: string, direction: ShelfDirection): string {
  const path = `/office/shelf/${encodeURIComponent(clientId)}`;
  return direction === SHELF_DIRECTIONS[0] ? path : `${path}?${new URLSearchParams({ [DIRECTION_PARAMETER]: direction }).toString()}`;
}

/** The direction the shelf opens on: what the office sent, unless the address names the other direction exactly. */
export function shelfDirectionOf(search: string): ShelfDirection {
  return new URLSearchParams(search).get(DIRECTION_PARAMETER) === "Inbound" ? "Inbound" : "Outbound";
}

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
 * A submission the client took back before the office opened it. The office can only trash a
 * submission it has opened, so a trashed submission that was still "Submitted" was cancelled by the client.
 */
export function cancelledByClient(file: Pick<FileView, "direction" | "state" | "trashedFrom">): boolean {
  return file.direction === "Inbound" && file.state === "Trashed" && file.trashedFrom === "Submitted";
}

/**
 * Actions offered on a row, in display order. Linking to a case exists for submissions only: the
 * server refuses it on anything the office sent. A submission can be trashed once the office has opened it.
 * A submission the client cancelled is not offered for restoring: that would undo the client's decision.
 */
export function shelfActions(file: Pick<FileView, "direction" | "state" | "trashedFrom">): ShelfAction[] {
  if (file.state === "Trashed") {
    return cancelledByClient(file) ? [] : ["restore"];
  }
  if (file.direction === "Inbound") {
    return file.state === "Acknowledged" ? ["linkCase", "trash"] : ["linkCase"];
  }
  if (file.state === "Published") {
    return ["withdraw"];
  }
  return file.state === "Withdrawn" ? ["trash"] : [];
}

/**
 * The row the Link case panel works on, read from the list as it is now: after a reload the panel
 * carries the current version, and it is gone when the row left the list or can no longer be linked.
 */
export function linkTarget(items: readonly FileView[], fileId: string | null): FileView | null {
  const file = fileId === null ? undefined : items.find((item) => item.id === fileId);
  return file !== undefined && shelfActions(file).includes("linkCase") ? file : null;
}

export interface ShelfList {
  items: FileView[];
  total: number;
}

/**
 * The list to show: only the answer to the question on screen, and nothing after a failed load.
 * Rows of the previous direction, view or filter are never shown under the new one.
 */
export function shownList(loaded: { path: string; list: ShelfList } | null, path: string, error: unknown): ShelfList | null {
  return loaded !== null && loaded.path === path && error === null ? loaded.list : null;
}

const MONTH_TEXT = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month filter as typed. Browsers without a month picker show a text box, so the text is
 * checked here: only a complete YYYY-MM narrows the list, anything else is reported and not sent.
 */
export function monthFilter(text: string): { valid: boolean; value: string } {
  if (text === "") {
    return { valid: true, value: "" };
  }
  return MONTH_TEXT.test(text) ? { valid: true, value: text } : { valid: false, value: "" };
}

/** Reads a paged list to its end, so a long list is never cut off at the page size. */
export async function loadAllPages<T>(loadPage: (offset: number) => Promise<T[]>, pageSize: number): Promise<T[]> {
  const all: T[] = [];
  for (;;) {
    const page = await loadPage(all.length);
    all.push(...page);
    if (page.length < pageSize) {
      return all;
    }
  }
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
