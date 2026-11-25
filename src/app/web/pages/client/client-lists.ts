import type { SendResult } from "../../api/client-types";

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

/** What became of one file of a send: the server's answer, or the error of a request that did not complete. */
export type SendOutcome = SendResult | { outcome: "failed"; error: unknown };

/**
 * Sends the files one request at a time, in order. A file that fails does not stop the ones after it:
 * every file gets its own outcome, reported as soon as it is known.
 */
export async function sendEach<F>(
  files: readonly F[],
  sendOne: (file: F) => Promise<SendResult>,
  onOutcome: (index: number, outcome: SendOutcome) => void,
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (const [index, file] of files.entries()) {
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
