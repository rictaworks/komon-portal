import type { AuditEntry } from "../../api/office-types";

/** Target type of the entries the API writes for a refused request or sign-in. */
const REQUEST_TARGET = "request";

export type AuditActorLabelKey = "office.audit.anonymous" | "office.audit.system";

/**
 * The label for an entry that has no named actor. A refused request from somebody who is not
 * signed in has no actor either, and must not read as something the system did.
 */
export function auditActorLabelKey(entry: Pick<AuditEntry, "actorUserId" | "targetType">): AuditActorLabelKey {
  return entry.actorUserId === null && entry.targetType === REQUEST_TARGET ? "office.audit.anonymous" : "office.audit.system";
}

/** Audit entries shown per page. */
export const AUDIT_PAGE_SIZE = 50;

export interface AuditListFilter {
  /** The client whose entries are listed, or null for every entry. */
  clientId: string | null;
  /** Zero-based index of the first entry shown. */
  offset: number;
  pageSize: number;
}

/** The list request for one page of the audit log. One entry more than a page is requested, which tells whether a next page exists. */
export function auditListPath(filter: AuditListFilter): string {
  const parameters = new URLSearchParams({ limit: String(filter.pageSize + 1), offset: String(filter.offset) });
  if (filter.clientId !== null) {
    parameters.set("clientId", filter.clientId);
  }
  return `/api/office/audit?${parameters.toString()}`;
}
