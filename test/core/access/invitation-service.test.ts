import { beforeEach, describe, expect, it } from "vitest";
import { AccessPolicy } from "../../../src/core/access/access-policy";
import { InvitationService } from "../../../src/core/access/invitation-service";
import { hashSecret } from "../../../src/core/access/secret-compare";
import { SetupService } from "../../../src/core/access/setup-service";
import { client, coreKit, memberActor, staffActor, user, type CoreKit } from "../../support/builders";
import { MemoryRepository } from "../../support/memory-repository";

const staff = staffActor("Staff", "u-staff");
const owner = staffActor("Owner", "u-owner");
const SETUP_TOKEN = "setup-token-0123456789-abcdef";

describe("InvitationService", () => {
  let repo: MemoryRepository;
  let kit: CoreKit;
  let service: InvitationService;

  beforeEach(() => {
    repo = new MemoryRepository();
    repo.clientRows.push(client({ id: "c1" }), client({ id: "c2", code: "C0142" }), client({ id: "c9", code: "C0999", status: "Closed" }));
    repo.userRows.push(
      user({ id: "u-owner", googleSub: "s-owner", officeRole: "Owner", officeStatus: "Active" }),
      user({ id: "u-staff", googleSub: "s-staff", officeRole: "Staff", officeStatus: "Active" }),
      user({ id: "u-new", googleSub: "s-new", displayName: "K. Tanabe" }),
    );
    kit = coreKit(repo);
    service = new InvitationService({ repository: repo, policy: new AccessPolicy(), ...kit });
  });

  async function newcomer() {
    const found = await repo.users.findById("u-new");
    if (found === null) throw new Error("setup");
    return found;
  }

  describe("issue", () => {
    it("stores only the hash of a long random code, valid for 72 hours", async () => {
      const { invitation, code } = await service.issue(staff, { type: "Client", clientId: "c1" });
      expect(code.length).toBeGreaterThanOrEqual(32);
      expect(invitation.codeHash).toBe(await hashSecret(code));
      expect(JSON.stringify(repo.invitationRows)).not.toContain(code);
      expect(JSON.stringify(repo.auditRows)).not.toContain(code);
      expect(invitation).toMatchObject({ targetType: "Client", clientId: "c1", officeRole: null, status: "Issued", issuedBy: "u-staff" });
      expect(invitation.expiresAt.getTime() - kit.clock.now().getTime()).toBe(72 * 60 * 60 * 1000);
    });

    it("lets only an Owner invite office staff", async () => {
      const { invitation } = await service.issue(owner, { type: "Office", role: "Staff" });
      expect(invitation).toMatchObject({ targetType: "Office", clientId: null, officeRole: "Staff" });
      await expect(service.issue(staff, { type: "Office", role: "Staff" })).rejects.toThrow("forbidden: office.staff.manage");
    });

    it("refuses client members, unknown clients and closed clients", async () => {
      await expect(service.issue(memberActor(), { type: "Client", clientId: "c1" })).rejects.toThrow("forbidden");
      await expect(service.issue(staff, { type: "Client", clientId: "missing" })).rejects.toThrow("not_found: client");
      await expect(service.issue(staff, { type: "Client", clientId: "c9" })).rejects.toThrow("invalid_state: client_closed");
    });
  });

  describe("redeem", () => {
    it("creates a Pending membership that grants nothing", async () => {
      const { code } = await service.issue(staff, { type: "Client", clientId: "c1" });
      const redeemed = await service.redeem(await newcomer(), code);
      expect(redeemed).toMatchObject({ status: "Redeemed", redeemedBy: "u-new" });
      expect(repo.membershipRows).toEqual([expect.objectContaining({ userId: "u-new", clientId: "c1", status: "Pending", approvedBy: null })]);
      const actor = { kind: "user" as const, userId: "u-new", officeRole: null, officeStatus: null, memberships: [{ clientId: "c1", status: "Pending" as const, clientStatus: "Active" as const }] };
      expect(new AccessPolicy().can(actor, "client.read", { clientId: "c1" })).toBe(false);
    });

    it("makes an office invitation Pending with the invited role", async () => {
      const { code } = await service.issue(owner, { type: "Office", role: "Staff" });
      await service.redeem(await newcomer(), code);
      expect(await newcomer()).toMatchObject({ officeRole: "Staff", officeStatus: "Pending" });
      expect(new AccessPolicy().can({ kind: "user", userId: "u-new", officeRole: "Staff", officeStatus: "Pending", memberships: [] }, "staff.operate")).toBe(false);
    });

    it("refuses used, expired, cancelled and unknown codes with one identical error", async () => {
      const used = await service.issue(staff, { type: "Client", clientId: "c1" });
      await service.redeem(await newcomer(), used.code);
      const cancelled = await service.issue(staff, { type: "Client", clientId: "c2" });
      await service.cancel(staff, cancelled.invitation.id);
      const expired = await service.issue(staff, { type: "Client", clientId: "c2" });
      kit.clock.advanceDays(3);
      const other = user({ id: "u-other", googleSub: "s-other" });
      repo.userRows.push(other);
      const messages: string[] = [];
      for (const code of [used.code, cancelled.code, expired.code, "no-such-code"]) {
        await service.redeem(other, code).catch((error: Error) => messages.push(error.message));
      }
      expect(messages).toEqual(Array(4).fill("invalid_input: invitation"));
      expect(repo.membershipRows).toHaveLength(1);
    });

    it("accepts a code just before 72 hours and refuses it at 72 hours", async () => {
      const first = await service.issue(staff, { type: "Client", clientId: "c1" });
      kit.clock.current = new Date(kit.clock.current.getTime() + 72 * 60 * 60 * 1000 - 1);
      await expect(service.redeem(await newcomer(), first.code)).resolves.toMatchObject({ status: "Redeemed" });
      const second = await service.issue(staff, { type: "Client", clientId: "c2" });
      kit.clock.current = new Date(kit.clock.current.getTime() + 72 * 60 * 60 * 1000);
      await expect(service.redeem(await newcomer(), second.code)).rejects.toThrow("invalid_input: invitation");
    });

    it("works only once", async () => {
      const { code } = await service.issue(staff, { type: "Client", clientId: "c1" });
      await service.redeem(await newcomer(), code);
      repo.userRows.push(user({ id: "u-other", googleSub: "s-other" }));
      await expect(service.redeem(user({ id: "u-other", googleSub: "s-other" }), code)).rejects.toThrow("invalid_input: invitation");
    });

    it("keeps staff and client roles apart without consuming the code", async () => {
      const clientInvite = await service.issue(staff, { type: "Client", clientId: "c1" });
      const staffUser = await repo.users.findById("u-staff");
      if (staffUser === null) throw new Error("setup");
      await expect(service.redeem(staffUser, clientInvite.code)).rejects.toThrow("invalid_input: invitation");
      expect(repo.invitationRows[0]?.status).toBe("Issued");
      await service.redeem(await newcomer(), clientInvite.code);
      const officeInvite = await service.issue(owner, { type: "Office", role: "Staff" });
      await expect(service.redeem(await newcomer(), officeInvite.code)).rejects.toThrow("invalid_input: invitation");
    });

    it("refuses a second ongoing membership for the same client but allows another client", async () => {
      const first = await service.issue(staff, { type: "Client", clientId: "c1" });
      await service.redeem(await newcomer(), first.code);
      const again = await service.issue(staff, { type: "Client", clientId: "c1" });
      await expect(service.redeem(await newcomer(), again.code)).rejects.toThrow("invalid_input: invitation");
      const second = await service.issue(staff, { type: "Client", clientId: "c2" });
      await service.redeem(await newcomer(), second.code);
      expect(repo.membershipRows.map((row) => row.clientId)).toEqual(["c1", "c2"]);
    });

    it("does not consume the invitation when the pending record cannot be created", async () => {
      const { code } = await service.issue(staff, { type: "Client", clientId: "c1" });
      const original = repo.memberships.insert;
      repo.memberships.insert = async () => {
        throw new Error("database unavailable");
      };
      await expect(service.redeem(await newcomer(), code)).rejects.toThrow("database unavailable");
      repo.memberships.insert = original;
      expect(repo.invitationRows[0]).toMatchObject({ status: "Issued", redeemedBy: null });
      await expect(service.redeem(await newcomer(), code)).resolves.toMatchObject({ status: "Redeemed" });
    });

    it("audits refused attempts without the code", async () => {
      await service.redeem(await newcomer(), "guess-1234").catch(() => undefined);
      expect(repo.auditRows.at(-1)).toMatchObject({ action: "invitation.redeem", result: "denied", targetId: "unknown", actorUserId: "u-new" });
      expect(JSON.stringify(repo.auditRows)).not.toContain("guess-1234");
    });
  });

  describe("approval of client members", () => {
    async function pendingMembership() {
      const { code } = await service.issue(staff, { type: "Client", clientId: "c1" });
      await service.redeem(await newcomer(), code);
      const id = repo.membershipRows[0]?.id;
      if (id === undefined) throw new Error("setup");
      return id;
    }

    async function pendingMembershipFor(clientId: string) {
      const { code } = await service.issue(staff, { type: "Client", clientId });
      await service.redeem(await newcomer(), code);
      const id = repo.membershipRows.find((row) => row.clientId === clientId)?.id;
      if (id === undefined) throw new Error("setup");
      return id;
    }

    it("shows staff the display name and the time the invitation was used", async () => {
      await pendingMembership();
      const views = await service.listClientMembers(staff, "c1");
      expect(views).toEqual([expect.objectContaining({ displayName: "K. Tanabe", redeemedAt: kit.clock.now() })]);
      await expect(service.listClientMembers(memberActor(), "c1")).rejects.toThrow("forbidden");
    });

    it("approves a pending member", async () => {
      const id = await pendingMembership();
      expect(await service.approveMembership(staff, id)).toMatchObject({ status: "Active", approvedBy: "u-staff", approvedAt: kit.clock.now() });
    });

    it("rejects a pending member, who can then be invited again", async () => {
      const id = await pendingMembership();
      expect(await service.rejectMembership(staff, id)).toMatchObject({ status: "Rejected", approvedBy: null });
      const again = await service.issue(staff, { type: "Client", clientId: "c1" });
      await expect(service.redeem(await newcomer(), again.code)).resolves.toMatchObject({ status: "Redeemed" });
    });

    it("lets only one of a concurrent approve and reject win", async () => {
      const id = await pendingMembership();
      await service.approveMembership(staff, id);
      await expect(service.rejectMembership(staff, id)).rejects.toThrow("invalid_state: membership_not_pending");
      await expect(service.approveMembership(staff, id)).rejects.toThrow("invalid_state: membership_not_pending");
    });

    it("is denied to client members", async () => {
      const id = await pendingMembership();
      await expect(service.approveMembership(memberActor(), id)).rejects.toThrow("forbidden");
      expect(repo.membershipRows[0]?.status).toBe("Pending");
    });

    it("ends the sessions on a second attempt when the first one failed after the status change", async () => {
      const id = await pendingMembership();
      await service.approveMembership(staff, id);
      const original = repo.sessions.revokeAllForUser;
      repo.sessions.revokeAllForUser = async () => {
        throw new Error("database unavailable");
      };
      await expect(service.revokeMembership(staff, id)).rejects.toThrow("database unavailable");
      repo.sessions.revokeAllForUser = original;
      await service.revokeMembership(staff, id);
      expect(repo.revokedSessionsOf).toEqual(["u-new"]);
      const pendingOnly = await pendingMembershipFor("c2");
      await expect(service.revokeMembership(staff, pendingOnly)).rejects.toThrow("invalid_state: membership_not_active");
    });

    it("revokes at once and ends every session of that user", async () => {
      const id = await pendingMembership();
      await service.approveMembership(staff, id);
      expect(await service.revokeMembership(staff, id)).toMatchObject({ status: "Revoked" });
      expect(repo.revokedSessionsOf).toEqual(["u-new"]);
      await service.revokeMembership(staff, id);
      expect(repo.revokedSessionsOf).toEqual(["u-new", "u-new"]);
    });
  });

  describe("office members", () => {
    async function pendingStaff() {
      const { code } = await service.issue(owner, { type: "Office", role: "Staff" });
      await service.redeem(await newcomer(), code);
    }

    it("lets only an Owner approve, reject and list office members", async () => {
      await pendingStaff();
      await expect(service.approveOffice(staff, "u-new")).rejects.toThrow("forbidden: office.staff.manage");
      await expect(service.listOfficeMembers(staff)).rejects.toThrow("forbidden");
      const listed = await service.listOfficeMembers(owner);
      expect(listed.find((view) => view.userId === "u-new")).toEqual({ userId: "u-new", displayName: "K. Tanabe", officeRole: "Staff", officeStatus: "Pending", redeemedAt: kit.clock.now(), approvedAt: null });
      expect(JSON.stringify(listed)).not.toContain("s-new");
      expect(await service.approveOffice(owner, "u-new")).toMatchObject({ officeRole: "Staff", officeStatus: "Active" });
      await expect(service.rejectOffice(owner, "u-new")).rejects.toThrow("invalid_state: office_not_pending");
    });

    it("shows when each active office member was approved, and nothing before that", async () => {
      await pendingStaff();
      const redeemedAt = kit.clock.now();
      const newStaff = async () => (await service.listOfficeMembers(owner)).find((view) => view.userId === "u-new");
      expect(await newStaff()).toMatchObject({ officeStatus: "Pending", approvedAt: null });
      kit.clock.advanceDays(1);
      await service.approveOffice(owner, "u-new");
      expect(await newStaff()).toMatchObject({ officeStatus: "Active", redeemedAt: redeemedAt, approvedAt: kit.clock.now() });
    });

    it("does not approve someone who also has a client membership", async () => {
      await pendingStaff();
      repo.membershipRows.push({ id: "m-x", userId: "u-new", clientId: "c1", status: "Pending", approvedBy: null, approvedAt: null, createdAt: new Date() });
      await expect(service.approveOffice(owner, "u-new")).rejects.toThrow("invalid_state: not_eligible");
      expect(await newcomer()).toMatchObject({ officeStatus: "Pending" });
    });

    it("ends the sessions again when an office revocation is repeated", async () => {
      await service.revokeOffice(owner, "u-staff");
      await service.revokeOffice(owner, "u-staff");
      expect(repo.revokedSessionsOf).toEqual(["u-staff", "u-staff"]);
      await expect(service.revokeOffice(owner, "u-new")).rejects.toThrow("invalid_state: office_not_active");
    });

    it("rejects a pending office member", async () => {
      await pendingStaff();
      expect(await service.rejectOffice(owner, "u-new")).toMatchObject({ officeStatus: "Rejected" });
    });

    it("revokes staff and ends their sessions", async () => {
      await service.revokeOffice(owner, "u-staff");
      expect(await repo.users.findById("u-staff")).toMatchObject({ officeStatus: "Revoked" });
      expect(repo.revokedSessionsOf).toEqual(["u-staff"]);
    });

    it("never revokes the last Owner", async () => {
      await expect(service.revokeOffice(owner, "u-owner")).rejects.toThrow("invalid_state: last_owner");
      expect(await repo.users.findById("u-owner")).toMatchObject({ officeStatus: "Active" });
      repo.userRows.push(user({ id: "u-owner2", googleSub: "s-owner2", officeRole: "Owner", officeStatus: "Active" }));
      await expect(service.revokeOffice(owner, "u-owner2")).resolves.toBeUndefined();
    });
  });

  describe("cancel", () => {
    it("cancels an issued invitation once, by the right role", async () => {
      const office = await service.issue(owner, { type: "Office", role: "Staff" });
      await expect(service.cancel(staff, office.invitation.id)).rejects.toThrow("not_found: invitation");
      await expect(service.cancel(memberActor(), office.invitation.id)).rejects.toThrow("forbidden");
      await service.cancel(owner, office.invitation.id);
      await expect(service.cancel(owner, office.invitation.id)).rejects.toThrow("invalid_state: invitation_not_issued");
      await expect(service.cancel(staff, "missing")).rejects.toThrow("not_found: invitation");
    });
  });
});

describe("SetupService", () => {
  let repo: MemoryRepository;
  let kit: CoreKit;

  function setup(setupToken: string | undefined) {
    return new SetupService({ repository: repo, policy: new AccessPolicy(), audit: kit.audit, setupToken });
  }

  beforeEach(() => {
    repo = new MemoryRepository();
    repo.userRows.push(user({ id: "u1", googleSub: "s1" }), user({ id: "u2", googleSub: "s2" }));
    kit = coreKit(repo);
  });

  it("makes the first user who presents the token an Owner", async () => {
    const service = setup(SETUP_TOKEN);
    expect(await service.isOpen()).toBe(true);
    expect(await service.claimOwner(user({ id: "u1", googleSub: "s1" }), SETUP_TOKEN)).toMatchObject({ officeRole: "Owner", officeStatus: "Active" });
    expect(await repo.users.countActiveOwners()).toBe(1);
    expect(repo.auditRows.at(-1)).toMatchObject({ action: "setup.claim_owner", result: "ok", targetId: "u1" });
  });

  it("stops accepting the token once an Owner exists", async () => {
    const service = setup(SETUP_TOKEN);
    await service.claimOwner(user({ id: "u1", googleSub: "s1" }), SETUP_TOKEN);
    expect(await service.isOpen()).toBe(false);
    await expect(service.claimOwner(user({ id: "u2", googleSub: "s2" }), SETUP_TOKEN)).rejects.toThrow("invalid_input: setup_token");
    expect(await repo.users.countActiveOwners()).toBe(1);
  });

  it("refuses a wrong token and audits the attempt", async () => {
    await expect(setup(SETUP_TOKEN).claimOwner(user({ id: "u1", googleSub: "s1" }), `${SETUP_TOKEN}x`)).rejects.toThrow("invalid_input: setup_token");
    expect(repo.auditRows.at(-1)).toMatchObject({ result: "denied" });
    expect(await repo.users.countActiveOwners()).toBe(0);
  });

  it.each([undefined, "", "short"])("is closed when the configured token is %j", async (configured) => {
    const service = setup(configured);
    expect(await service.isOpen()).toBe(false);
    await expect(service.claimOwner(user({ id: "u1", googleSub: "s1" }), configured ?? "")).rejects.toThrow("invalid_input: setup_token");
  });

  it("refuses a client member with the same error as a wrong token", async () => {
    repo.clientRows.push(client({ id: "c1" }));
    repo.membershipRows.push({ id: "m1", userId: "u1", clientId: "c1", status: "Active", approvedBy: null, approvedAt: null, createdAt: new Date() });
    await expect(setup(SETUP_TOKEN).claimOwner(user({ id: "u1", googleSub: "s1" }), SETUP_TOKEN)).rejects.toThrow("invalid_input: setup_token");
    expect(repo.auditRows.at(-1)).toMatchObject({ result: "denied" });
  });

  it("creates exactly one Owner when two users present the token at the same moment", async () => {
    const service = setup(SETUP_TOKEN);
    const outcomes = await Promise.allSettled([
      service.claimOwner(user({ id: "u1", googleSub: "s1" }), SETUP_TOKEN),
      service.claimOwner(user({ id: "u2", googleSub: "s2" }), SETUP_TOKEN),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await repo.users.countActiveOwners()).toBe(1);
  });
});
