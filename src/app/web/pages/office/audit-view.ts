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
