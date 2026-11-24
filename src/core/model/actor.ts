import type { ClientStatus, Id, MembershipStatus, OfficeRole } from "./types";

export interface ActorMembership {
  clientId: Id;
  status: MembershipStatus;
  clientStatus: ClientStatus;
}

export interface UserActor {
  kind: "user";
  userId: Id;
  officeRole: OfficeRole | null;
  officeStatus: MembershipStatus | null;
  memberships: readonly ActorMembership[];
}

/** The scheduled jobs act as the system. */
export interface SystemActor {
  kind: "system";
}

export type Actor = UserActor | SystemActor;

export function systemActor(): SystemActor {
  return { kind: "system" };
}

export function actorUserId(actor: Actor): Id | null {
  return actor.kind === "user" ? actor.userId : null;
}
