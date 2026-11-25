import type { Actor } from "../model/actor";
import { actorUserId } from "../model/actor";
import type { AuditEntry, Id, MetricActorKind, MetricEvent } from "../model/types";
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

/**
 * How a measurement event names its actor: the kind and, for a person, the internal user ID.
 * A user with an active office role acts as staff; any other signed-in user acts as a client
 * member (the two roles never combine). The scheduled jobs act as the system.
 */
export function metricActorOf(actor: Actor | null): Pick<MetricEvent, "actorKind" | "actorUserId"> {
  if (actor === null) {
    return { actorKind: null, actorUserId: null };
  }
  if (actor.kind === "system") {
    return { actorKind: "system", actorUserId: null };
  }
  const actorKind: MetricActorKind = actor.officeRole !== null && actor.officeStatus === "Active" ? "staff" : "member";
  return { actorKind, actorUserId: actor.userId };
}

/** Appends measurement events. Attributes hold internal IDs and codes only, never names. */
export class MetricRecorder {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Appends an event. `actor` is who caused it, or null when nobody identified did. */
  async record(actor: Actor | null, name: string, clientId: Id | null, attributes: MetricEvent["attributes"] = {}): Promise<void> {
    await this.metrics.append({ id: this.ids.newId(), name, clientId, ...metricActorOf(actor), attributes, occurredAt: this.clock.now() });
  }
}
