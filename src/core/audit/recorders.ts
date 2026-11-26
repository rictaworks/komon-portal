import type { Actor, UserActor } from "../model/actor";
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

/** The name of the measurement event written once per user, per client and ISO week, on the first authenticated request. */
export const ACTIVE_EVENT = "active";

/**
 * The start of the ISO week (Monday 00:00 UTC) that holds `now`. The summary groups events by ISO week in UTC too,
 * so an event and its week always agree.
 */
export function startOfIsoWeek(now: Date): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
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

  /**
   * Records that a signed-in user used the portal this ISO week, on their first authenticated request of the week.
   * An active office member is counted once, with no client. Any other user is counted once per client they hold an
   * active membership of. A request later in the same week records nothing. Only internal IDs are written.
   */
  async recordWeeklyActivity(actor: Actor | null): Promise<void> {
    if (actor === null || actor.kind !== "user") {
      return;
    }
    const occurredAt = this.clock.now();
    const since = startOfIsoWeek(occurredAt);
    const who = metricActorOf(actor);
    for (const clientId of activityClients(actor)) {
      await this.metrics.appendUnlessSince({ id: this.ids.newId(), name: ACTIVE_EVENT, clientId, ...who, attributes: {}, occurredAt }, since);
    }
  }
}

/** The clients a user's activity is counted for: none for an active office member, else each active membership. */
function activityClients(actor: UserActor): (Id | null)[] {
  if (metricActorOf(actor).actorKind === "staff") {
    return [null];
  }
  return actor.memberships.filter((membership) => membership.status === "Active").map((membership) => membership.clientId);
}
