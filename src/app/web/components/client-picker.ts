import type { ClientRef } from "../api/office-types";

export interface ClientSearch {
  /** The typed text, already trimmed. Empty lists the first clients. */
  search: string;
  /** Null searches clients of every status. */
  status: ClientRef["status"] | null;
  /** The number of clients shown at once. */
  limit: number;
}

/** The search request of the picker. One client more than is shown is requested, which tells whether more match. */
export function clientSearchPath(search: ClientSearch): string {
  const parameters = new URLSearchParams({ limit: String(search.limit + 1), offset: "0" });
  if (search.status !== null) {
    parameters.set("status", search.status);
  }
  if (search.search !== "") {
    parameters.set("query", search.search);
  }
  return `/api/office/clients?${parameters.toString()}`;
}

export function clientLabel(client: Pick<ClientRef, "code" | "corporateName">): string {
  return `${client.code} ${client.corporateName}`;
}

export type MoveKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isMoveKey(key: string): key is MoveKey {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

/** The option that becomes active after a key press, or -1 when there is no option. `active` is -1 while none is active. */
export function moveActive(key: MoveKey, active: number, count: number): number {
  if (count === 0) {
    return -1;
  }
  switch (key) {
    case "ArrowDown":
      return active >= count - 1 ? 0 : active + 1;
    case "ArrowUp":
      return active <= 0 ? count - 1 : active - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }
}
