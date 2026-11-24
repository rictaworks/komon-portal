import type { AuditRecorder } from "../audit/recorders";
import type { Actor } from "../model/actor";
import { forbidden } from "../model/errors";
import type { Id } from "../model/types";
import type { AccessPolicy, AccessResource, Action } from "./access-policy";

export interface GuardTarget {
  type: string;
  id: Id;
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
      await this.audit.record(actor, action, target.type, target.id, "denied");
      throw forbidden(action);
    }
  }
}
