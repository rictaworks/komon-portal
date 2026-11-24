import type { AuditRecorder } from "../audit/recorders";
import type { Actor } from "../model/actor";
import { forbidden } from "../model/errors";
import type { Id } from "../model/types";
import type { AccessPolicy, AccessResource, Action } from "./access-policy";

export interface GuardTarget {
  type: string;
  id: Id;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INVALID_ID = "invalid";

/** Identifiers in denied requests come from the caller, so only well-formed ones are written to the audit log. */
export function auditableId(id: Id): Id {
  return SAFE_ID.test(id) ? id : INVALID_ID;
}

/** Enforces AccessPolicy and writes every denial to the audit log. */
export class Guard {
  constructor(
    private readonly policy: AccessPolicy,
    private readonly audit: AuditRecorder,
  ) {}

  allows(actor: Actor, action: Action, resource: AccessResource = {}): boolean {
    return this.policy.can(actor, action, resource);
  }

  async require(actor: Actor, action: Action, target: GuardTarget, resource: AccessResource = {}): Promise<void> {
    if (!this.policy.can(actor, action, resource)) {
      await this.audit.record(actor, action, target.type, auditableId(target.id), "denied");
      throw forbidden(action);
    }
  }
}
