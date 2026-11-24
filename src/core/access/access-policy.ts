import type { Actor, ActorMembership, UserActor } from "../model/actor";
import type { FileDirection, FileState, Id, InvitationTarget, MembershipStatus } from "../model/types";

export const OFFICE_ACTIONS = ["staff.operate"] as const;
export const OWNER_ACTIONS = [
  "office.settings.update",
  "office.staff.manage",
  "audit.read",
  "client.close",
  "incident.read",
] as const;
export const CLIENT_ACTIONS = ["client.read", "client.submit"] as const;
export const FILE_ACTIONS = ["file.read", "submission.cancel"] as const;
export const SYSTEM_ACTIONS = ["maintenance.run"] as const;

export type Action =
  | (typeof OFFICE_ACTIONS)[number]
  | (typeof OWNER_ACTIONS)[number]
  | (typeof CLIENT_ACTIONS)[number]
  | (typeof FILE_ACTIONS)[number]
  | (typeof SYSTEM_ACTIONS)[number];

/** The part of a file record that access decisions depend on. */
export interface FileAccessView {
  direction: FileDirection;
  state: FileState;
  clientId: Id | null;
}

export interface AccessResource {
  clientId?: Id;
  file?: FileAccessView;
  submitterId?: Id;
}

const ONGOING: readonly MembershipStatus[] = ["Pending", "Active"];
const MEMBER_VISIBLE_INBOUND: readonly FileState[] = ["Submitted", "Acknowledged"];

/**
 * The single place where permissions are decided. Screens, API handlers and
 * scheduled jobs all ask this class and nothing else.
 */
export class AccessPolicy {
  can(actor: Actor, action: Action, resource: AccessResource = {}): boolean {
    if (actor.kind === "system") {
      return (SYSTEM_ACTIONS as readonly string[]).includes(action);
    }
    if (this.holdsBothRoles(actor)) {
      return false;
    }
    switch (action) {
      case "staff.operate":
        return this.isActiveStaff(actor);
      case "office.settings.update":
      case "office.staff.manage":
      case "audit.read":
      case "client.close":
      case "incident.read":
        return this.isActiveStaff(actor) && actor.officeRole === "Owner";
      case "client.read":
        return this.canReadClient(actor, resource.clientId);
      case "client.submit":
        return this.canWriteClient(actor, resource.clientId);
      case "file.read":
        return resource.file !== undefined && this.canReadFile(actor, resource.file);
      case "submission.cancel":
        return this.canCancelSubmission(actor, resource);
      case "maintenance.run":
        return false;
    }
  }

  /** Whether a user may start (redeem an invitation for) the given side. Staff and client roles never combine. */
  canJoin(actor: UserActor, target: InvitationTarget): boolean {
    const officeOngoing = actor.officeStatus !== null && ONGOING.includes(actor.officeStatus);
    const clientOngoing = actor.memberships.some((membership) => ONGOING.includes(membership.status));
    return target === "Office" ? !officeOngoing && !clientOngoing : !officeOngoing;
  }

  private isActiveStaff(actor: UserActor): boolean {
    return actor.officeRole !== null && actor.officeStatus === "Active";
  }

  private holdsBothRoles(actor: UserActor): boolean {
    return this.isActiveStaff(actor) && actor.memberships.some((membership) => membership.status === "Active");
  }

  private activeMembership(actor: UserActor, clientId: Id | null | undefined): ActorMembership | undefined {
    if (clientId === undefined || clientId === null) {
      return undefined;
    }
    return actor.memberships.find((membership) => membership.clientId === clientId && membership.status === "Active");
  }

  private canReadClient(actor: UserActor, clientId: Id | undefined): boolean {
    if (clientId === undefined) {
      return false;
    }
    if (this.isActiveStaff(actor)) {
      return true;
    }
    const membership = this.activeMembership(actor, clientId);
    return membership !== undefined && membership.clientStatus !== "Closed";
  }

  private canWriteClient(actor: UserActor, clientId: Id | undefined): boolean {
    const membership = this.activeMembership(actor, clientId);
    return membership !== undefined && membership.clientStatus === "Active";
  }

  private canReadFile(actor: UserActor, file: FileAccessView): boolean {
    if (this.isActiveStaff(actor)) {
      return true;
    }
    if (file.clientId === null || !this.canReadClient(actor, file.clientId)) {
      return false;
    }
    return file.direction === "Outbound" ? file.state === "Published" : MEMBER_VISIBLE_INBOUND.includes(file.state);
  }

  private canCancelSubmission(actor: UserActor, resource: AccessResource): boolean {
    const file = resource.file;
    if (file === undefined || file.direction !== "Inbound" || file.state !== "Submitted") {
      return false;
    }
    return resource.submitterId === actor.userId && this.canWriteClient(actor, file.clientId ?? undefined);
  }
}
