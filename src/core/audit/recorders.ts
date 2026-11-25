import type { Actor } from "../model/actor";
import { actorUserId } from "../model/actor";
import type { AuditEntry, Id, MetricEvent } from "../model/types";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { AuditRepository, MetricRepository } from "../ports/repository";

/** Appends to the audit log. Entries carry the actor's ID and internal IDs only. */
export class AuditRecorder {
  constructor(
    private readonly audit: AuditRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Appends an entry. `actor` is null for a request that nobody is signed in for. */
  async record(actor: Actor | null, action: string, targetType: string, targetId: Id, result: AuditEntry["result"] = "ok"): Promise<void> {
    await this.audit.append(this.entry(actor, action, targetType, targetId, result));
  }

  /** Builds an entry without writing it, for a repository write that stores it together with the change it describes. */
  entry(actor: Actor | null, action: string, targetType: string, targetId: Id, result: AuditEntry["result"] = "ok"): AuditEntry {
    return {
      id: this.ids.newId(),
      actorUserId: actor === null ? null : actorUserId(actor),
      action,
      targetType,
      targetId,
      result,
      occurredAt: this.clock.now(),
    };
  }
}

/** Appends measurement events. Attributes hold internal IDs and codes only, never names. */
export class MetricRecorder {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async record(name: string, clientId: Id | null, attributes: MetricEvent["attributes"] = {}): Promise<void> {
    await this.metrics.append({ id: this.ids.newId(), name, clientId, attributes, occurredAt: this.clock.now() });
  }
}
