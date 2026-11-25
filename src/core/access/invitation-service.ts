import type { AuditRecorder, MetricRecorder } from "../audit/recorders";
import type { Actor } from "../model/actor";
import { DomainError, invalidInput, invalidState, notFound } from "../model/errors";
import type { Id, Invitation, Membership, MembershipStatus, OfficeRole, User } from "../model/types";
import { OFFICE_ROLES } from "../model/types";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Repository } from "../ports/repository";
import type { AccessPolicy } from "./access-policy";
import { ActorLoader } from "./actor-loader";
import type { Guard } from "./guard";
import { hashSecret } from "./secret-compare";

export type InvitationTargetInput = { type: "Client"; clientId: Id } | { type: "Office"; role: OfficeRole };

export interface IssuedInvitation {
  invitation: Invitation;
  /** The one-time code. Returned once and never stored; only its hash is kept. */
  code: string;
}

export interface MemberView {
  membership: Membership;
  displayName: string;
  /** When this person used the invitation, so staff can judge whether to approve. */
  redeemedAt: Date | null;
}

/** An office member as shown to the Owner. The sign-in subject is never included. */
export interface OfficeMemberView {
  userId: Id;
  displayName: string;
  officeRole: OfficeRole | null;
  officeStatus: MembershipStatus | null;
  redeemedAt: Date | null;
}

export const INVITATION_VALID_HOURS = 72;
export const INVITATION_CODE_BYTES = 32;
const HOUR_MS = 60 * 60 * 1000;
const INVITATION_TARGET = "invitation";
const MEMBERSHIP_TARGET = "membership";
const USER_TARGET = "user";
/** Single answer for expired, used, cancelled and unknown codes, so they cannot be told apart. */
const INVALID_CODE = "invitation";

export interface InvitationServiceDeps {
  repository: Repository;
  policy: AccessPolicy;
  guard: Guard;
  audit: AuditRecorder;
  metrics: MetricRecorder;
  clock: Clock;
  ids: IdGenerator;
}

/** Invitations by one-time link, approval by staff, and revocation (instructions.md 1.8). */
export class InvitationService {
  private readonly actors: ActorLoader;

  constructor(private readonly deps: InvitationServiceDeps) {
    this.actors = new ActorLoader(deps.repository);
  }

  async issue(actor: Actor, target: InvitationTargetInput): Promise<IssuedInvitation> {
    if (actor.kind !== "user") {
      throw invalidInput("actor");
    }
    if (target.type === "Client") {
      await this.deps.guard.require(actor, "staff.operate", { type: INVITATION_TARGET, id: target.clientId });
      const client = await this.deps.repository.clients.findById(target.clientId);
      if (client === null) {
        throw notFound("client");
      }
      if (client.status === "Closed") {
        throw invalidState("client_closed");
      }
    } else {
      await this.deps.guard.require(actor, "office.staff.manage", { type: INVITATION_TARGET, id: "office" });
      if (!OFFICE_ROLES.includes(target.role)) {
        throw invalidInput("office_role");
      }
    }
    const code = this.deps.ids.randomToken(INVITATION_CODE_BYTES);
    const now = this.deps.clock.now();
    const invitation: Invitation = {
      id: this.deps.ids.newId(),
      codeHash: await hashSecret(code),
      targetType: target.type,
      clientId: target.type === "Client" ? target.clientId : null,
      officeRole: target.type === "Office" ? target.role : null,
      issuedBy: actor.userId,
      expiresAt: new Date(now.getTime() + INVITATION_VALID_HOURS * HOUR_MS),
      status: "Issued",
      redeemedBy: null,
      redeemedAt: null,
      createdAt: now,
    };
    await this.deps.repository.invitations.insert(invitation);
    await this.deps.audit.record(actor, "invitation.issue", INVITATION_TARGET, invitation.id);
    return { invitation, code };
  }

  async cancel(actor: Actor, invitationId: Id): Promise<void> {
    await this.deps.guard.require(actor, "staff.operate", { type: INVITATION_TARGET, id: invitationId });
    const invitation = await this.deps.repository.invitations.findById(invitationId);
    // Staff who are not Owner learn nothing about office invitations: they look like unknown IDs.
    const hidden = invitation !== null && invitation.targetType === "Office" && !this.deps.guard.allows(actor, "office.staff.manage");
    if (invitation === null || hidden) {
      if (hidden) {
        await this.deps.audit.record(actor, "invitation.cancel", INVITATION_TARGET, invitationId, "denied");
      }
      throw notFound("invitation");
    }
    if (!(await this.deps.repository.invitations.transition({ ...invitation, status: "Cancelled" }, "Issued"))) {
      throw invalidState("invitation_not_issued");
    }
    await this.deps.audit.record(actor, "invitation.cancel", INVITATION_TARGET, invitationId);
  }

  /**
   * Uses a one-time code. The signed-in user becomes Pending and sees nothing until approved.
   * Expired, used, cancelled and unknown codes all fail with the same error.
   */
  async redeem(user: User, code: string): Promise<Invitation> {
    const actor = await this.actors.load(user);
    const now = this.deps.clock.now();
    const invitation = await this.deps.repository.invitations.findByCodeHash(await hashSecret(code));
    if (invitation === null || invitation.status !== "Issued" || invitation.expiresAt.getTime() <= now.getTime()) {
      await this.deps.audit.record(actor, "invitation.redeem", INVITATION_TARGET, invitation?.id ?? "unknown", "denied");
      throw invalidInput(INVALID_CODE);
    }
    const alreadyMember =
      invitation.clientId !== null && (await this.deps.repository.memberships.findOngoing(user.id, invitation.clientId)) !== null;
    // An account that may not join is refused with the same error as a dead code, and the code is
    // left unused. Otherwise a leaked link could be confirmed as live by probing it.
    if (!this.deps.policy.canJoin(actor, invitation.targetType) || alreadyMember) {
      await this.deps.audit.record(actor, "invitation.redeem", INVITATION_TARGET, invitation.id, "denied");
      throw invalidInput(INVALID_CODE);
    }
    const redeemed: Invitation = { ...invitation, status: "Redeemed", redeemedBy: user.id, redeemedAt: now };
    if (!(await this.deps.repository.invitations.transition(redeemed, "Issued"))) {
      await this.deps.audit.record(actor, "invitation.redeem", INVITATION_TARGET, invitation.id, "denied");
      throw invalidInput(INVALID_CODE);
    }
    try {
      await this.createPending(user, redeemed, now);
    } catch (error) {
      // Nothing was created, so the invitation must not stay consumed.
      await this.deps.repository.invitations.transition(invitation, "Redeemed");
      await this.deps.audit.record(actor, "invitation.redeem", INVITATION_TARGET, invitation.id, "failed");
      throw error instanceof DomainError ? invalidInput(INVALID_CODE) : error;
    }
    await this.deps.audit.record(actor, "invitation.redeem", INVITATION_TARGET, invitation.id);
    // The user holds no role yet (the request is only pending), so the event names no actor.
    await this.deps.metrics.record(null, "invitation.redeemed", invitation.clientId, { target: invitation.targetType });
    return redeemed;
  }

  async approveMembership(actor: Actor, membershipId: Id): Promise<Membership> {
    return this.decideMembership(actor, membershipId, "Active", "membership.approve");
  }

  async rejectMembership(actor: Actor, membershipId: Id): Promise<Membership> {
    return this.decideMembership(actor, membershipId, "Rejected", "membership.reject");
  }

  /** Ends a client membership at once and signs the user out everywhere. */
  async revokeMembership(actor: Actor, membershipId: Id): Promise<Membership> {
    await this.deps.guard.require(actor, "staff.operate", { type: MEMBERSHIP_TARGET, id: membershipId });
    const membership = await this.requireMembership(membershipId);
    const revoked: Membership = { ...membership, status: "Revoked" };
    // Repeating a revocation is allowed, so that sessions are ended even if an earlier attempt stopped halfway.
    if (membership.status !== "Revoked" && !(await this.deps.repository.memberships.transition(revoked, "Active"))) {
      throw invalidState("membership_not_active");
    }
    await this.deps.repository.sessions.revokeAllForUser(membership.userId);
    await this.deps.audit.record(actor, "membership.revoke", MEMBERSHIP_TARGET, membershipId);
    return revoked;
  }

  async approveOffice(actor: Actor, userId: Id): Promise<User> {
    return this.decideOffice(actor, userId, "Active", "office.approve");
  }

  async rejectOffice(actor: Actor, userId: Id): Promise<User> {
    return this.decideOffice(actor, userId, "Rejected", "office.reject");
  }

  /** Ends an office membership at once. The last Owner can never be revoked. */
  async revokeOffice(actor: Actor, userId: Id): Promise<void> {
    await this.deps.guard.require(actor, "office.staff.manage", { type: USER_TARGET, id: userId });
    const outcome = await this.deps.repository.users.revokeOfficeUnlessLastOwner(userId);
    if (outcome === "last_owner") {
      throw invalidState("last_owner");
    }
    if (outcome === "not_active" && (await this.deps.repository.users.findById(userId))?.officeStatus !== "Revoked") {
      throw invalidState("office_not_active");
    }
    await this.deps.repository.sessions.revokeAllForUser(userId);
    await this.deps.audit.record(actor, "office.revoke", USER_TARGET, userId);
  }

  async listClientMembers(actor: Actor, clientId: Id): Promise<MemberView[]> {
    await this.deps.guard.require(actor, "staff.operate", { type: MEMBERSHIP_TARGET, id: clientId });
    const views: MemberView[] = [];
    for (const membership of await this.deps.repository.memberships.listByClient(clientId)) {
      const user = await this.deps.repository.users.findById(membership.userId);
      const invitation = await this.deps.repository.invitations.findLatestRedeemedBy(membership.userId, clientId);
      views.push({ membership, displayName: user?.displayName ?? "", redeemedAt: invitation?.redeemedAt ?? null });
    }
    return views;
  }

  async listOfficeMembers(actor: Actor): Promise<OfficeMemberView[]> {
    await this.deps.guard.require(actor, "office.staff.manage", { type: USER_TARGET, id: "office" });
    const views: OfficeMemberView[] = [];
    for (const user of await this.deps.repository.users.listOffice()) {
      const invitation = await this.deps.repository.invitations.findLatestRedeemedBy(user.id, null);
      views.push({
        userId: user.id,
        displayName: user.displayName,
        officeRole: user.officeRole,
        officeStatus: user.officeStatus,
        redeemedAt: invitation?.redeemedAt ?? null,
      });
    }
    return views;
  }

  private async createPending(user: User, invitation: Invitation, now: Date): Promise<void> {
    if (invitation.clientId !== null) {
      const inserted = await this.deps.repository.memberships.insert({
        id: this.deps.ids.newId(),
        userId: user.id,
        clientId: invitation.clientId,
        status: "Pending",
        approvedBy: null,
        approvedAt: null,
        createdAt: now,
      });
      if (!inserted) {
        throw invalidState("not_eligible");
      }
      return;
    }
    const pending: User = { ...user, officeRole: invitation.officeRole, officeStatus: "Pending" };
    if (!(await this.deps.repository.users.transitionOffice(pending, user.officeStatus))) {
      throw invalidState("not_eligible");
    }
  }

  private async decideMembership(actor: Actor, membershipId: Id, status: "Active" | "Rejected", action: string): Promise<Membership> {
    await this.deps.guard.require(actor, "staff.operate", { type: MEMBERSHIP_TARGET, id: membershipId });
    const membership = await this.requireMembership(membershipId);
    if (status === "Active") {
      const user = await this.deps.repository.users.findById(membership.userId);
      const client = await this.deps.repository.clients.findById(membership.clientId);
      if (user === null || !this.deps.policy.canJoin(await this.actors.load(user), "Client") || client === null || client.status === "Closed") {
        throw invalidState("not_eligible");
      }
    }
    const decided: Membership = {
      ...membership,
      status,
      approvedBy: status === "Active" && actor.kind === "user" ? actor.userId : null,
      approvedAt: status === "Active" ? this.deps.clock.now() : null,
    };
    if (!(await this.deps.repository.memberships.transition(decided, "Pending"))) {
      throw invalidState("membership_not_pending");
    }
    await this.deps.audit.record(actor, action, MEMBERSHIP_TARGET, membershipId);
    return decided;
  }

  private async decideOffice(actor: Actor, userId: Id, status: "Active" | "Rejected", action: string): Promise<User> {
    await this.deps.guard.require(actor, "office.staff.manage", { type: USER_TARGET, id: userId });
    const user = await this.deps.repository.users.findById(userId);
    if (user === null) {
      throw notFound("user");
    }
    // Staff and client roles never combine: someone with a pending or active client membership cannot be approved.
    if (status === "Active" && (await this.actors.load(user)).memberships.some((membership) => membership.status === "Pending" || membership.status === "Active")) {
      throw invalidState("not_eligible");
    }
    const decided: User = { ...user, officeStatus: status };
    if (user.officeRole === null || !(await this.deps.repository.users.transitionOffice(decided, "Pending"))) {
      throw invalidState("office_not_pending");
    }
    await this.deps.audit.record(actor, action, USER_TARGET, userId);
    return decided;
  }

  private async requireMembership(id: Id): Promise<Membership> {
    const membership = await this.deps.repository.memberships.findById(id);
    if (membership === null) {
      throw notFound("membership");
    }
    return membership;
  }
}
