import type { ListPage, SendResult } from "../../api/client-types";

/** Rows of a client list shown at once. */
export const CLIENT_PAGE_SIZE = 50;

export interface DocumentFilter {
  docTypeId: string;
  targetMonth: string;
  /** Zero-based page. */
  page: number;
}

function paging(page: number): URLSearchParams {
  if (!Number.isInteger(page) || page < 0) {
    throw new Error(`page ${page} does not exist`);
  }
  return new URLSearchParams({ limit: String(CLIENT_PAGE_SIZE), offset: String(page * CLIENT_PAGE_SIZE) });
}

/** The request for one page of the company's published documents. */
export function documentsPath(clientId: string, filter: DocumentFilter): string {
  const query = paging(filter.page);
  if (filter.docTypeId !== "") {
    query.set("docTypeId", filter.docTypeId);
  }
  if (filter.targetMonth !== "") {
    query.set("targetMonth", filter.targetMonth);
  }
  return `/api/client/${encodeURIComponent(clientId)}/documents?${query.toString()}`;
}

/** The request for one page of the files the company has sent. */
export function submissionsPath(clientId: string, page: number): string {
  return `/api/client/${encodeURIComponent(clientId)}/submissions?${paging(page).toString()}`;
}

/** A page as it was loaded: the list and the page its rows belong to, whatever was asked for since. */
export interface PageOf<T> extends ListPage<T> {
  /** Names the list: the company and, where the list has one, the filter. */
  list: string;
  /** Zero-based page. */
  page: number;
}

/** The page last asked for, together with the list it was asked of. */
export interface PageRequest {
  list: string;
  page: number;
}

/** The page to load now. A page asked of another list does not count: a new list starts at its first page. */
export function requestedPage(request: PageRequest, list: string): number {
  return request.list === list ? request.page : 0;
}

/**
 * The rows to put on the screen, with the page they were loaded for. When a later page fails to load, the rows of
 * the earlier page stay, under their own page number. Rows of another list are never shown, and neither is a later
 * page that has become empty: the screen steps back from it (see `emptiedPage`).
 */
export function shownPage<T>(loaded: PageOf<T> | null, list: string): PageOf<T> | null {
  if (loaded === null || loaded.list !== list) {
    return null;
  }
  return loaded.page > 0 && loaded.items.length === 0 ? null : loaded;
}

/**
 * The page to go back to when the page asked for was loaded and has no rows left (its last row was cancelled or
 * withdrawn); null when there is nothing to step back from. An empty first page is simply an empty list.
 */
export function emptiedPage<T>(loaded: PageOf<T> | null, list: string, page: number): number | null {
  if (loaded === null || loaded.list !== list || loaded.page !== page) {
    return null;
  }
  return page > 0 && loaded.items.length === 0 ? page - 1 : null;
}

/** What became of one file of a send: the server's answer, or the error of a request that did not complete. */
export type SendOutcome = SendResult | { outcome: "failed"; error: unknown };

/**
 * Sends the files one request at a time, in order. A file that fails does not stop the ones after it:
 * every file gets its own outcome, reported as soon as it is known. `wanted` is asked before each file: once it
 * answers no (the member has left the screen), the files not yet started are not sent and get no outcome.
 */
export async function sendEach<F>(
  files: readonly F[],
  sendOne: (file: F) => Promise<SendResult>,
  onOutcome: (index: number, outcome: SendOutcome) => void,
  wanted: () => boolean,
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (const [index, file] of files.entries()) {
    if (!wanted()) {
      break;
    }
    let outcome: SendOutcome;
    try {
      outcome = await sendOne(file);
    } catch (error) {
      outcome = { outcome: "failed", error };
    }
    outcomes.push(outcome);
    onOutcome(index, outcome);
  }
  return outcomes;
}

/** The files that were not stored, so they stay chosen and the member can see why and decide again. */
export function unsent<F>(files: readonly F[], outcomes: readonly SendOutcome[]): F[] {
  if (files.length !== outcomes.length) {
    throw new Error("every file needs its own result");
  }
  return files.filter((_file, index) => outcomes[index]?.outcome !== "stored");
}
