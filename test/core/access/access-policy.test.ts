import { describe, expect, it } from "vitest";
import { AccessPolicy } from "../../../src/core/access/access-policy";
import type { ActorMembership, UserActor } from "../../../src/core/model/actor";
import { systemActor } from "../../../src/core/model/actor";
import type { ClientStatus, FileDirection, FileState, MembershipStatus } from "../../../src/core/model/types";

const policy = new AccessPolicy();

function staff(role: "Owner" | "Staff", status: MembershipStatus = "Active"): UserActor {
  return { kind: "user", userId: `u-${role}`, officeRole: role, officeStatus: status, memberships: [] };
}

function member(memberships: ActorMembership[], userId = "u-member"): UserActor {
  return { kind: "user", userId, officeRole: null, officeStatus: null, memberships };
}

function m(clientId: string, status: MembershipStatus = "Active", clientStatus: ClientStatus = "Active"): ActorMembership {
  return { clientId, status, clientStatus };
}

function file(direction: FileDirection, state: FileState, clientId: string | null = "c1") {
  return { direction, state, clientId };
}

describe("AccessPolicy office actions", () => {
  it("lets Owner and Staff operate the office", () => {
    expect(policy.can(staff("Owner"), "staff.operate")).toBe(true);
    expect(policy.can(staff("Staff"), "staff.operate")).toBe(true);
  });

  it("denies office staff whose approval is pending or revoked", () => {
    expect(policy.can(staff("Staff", "Pending"), "staff.operate")).toBe(false);
    expect(policy.can(staff("Owner", "Revoked"), "staff.operate")).toBe(false);
    expect(policy.can(staff("Owner", "Rejected"), "audit.read")).toBe(false);
  });

  it.each(["office.settings.update", "office.staff.manage", "audit.read", "client.close", "incident.read"] as const)(
    "reserves %s for the Owner",
    (action) => {
      expect(policy.can(staff("Owner"), action)).toBe(true);
      expect(policy.can(staff("Staff"), action)).toBe(false);
      expect(policy.can(member([m("c1")]), action)).toBe(false);
    },
  );

  it("denies office actions to client members", () => {
    expect(policy.can(member([m("c1")]), "staff.operate")).toBe(false);
  });

  it("lets only the system run maintenance", () => {
    expect(policy.can(systemActor(), "maintenance.run")).toBe(true);
    expect(policy.can(staff("Owner"), "maintenance.run")).toBe(false);
    expect(policy.can(systemActor(), "staff.operate")).toBe(false);
  });
});

describe("AccessPolicy client reach", () => {
  it("lets staff read any client", () => {
    expect(policy.can(staff("Staff"), "client.read", { clientId: "c9" })).toBe(true);
  });

  it("lets a member read only clients with an Active membership", () => {
    const actor = member([m("c1"), m("c2", "Pending"), m("c3", "Revoked"), m("c4", "Rejected")]);
    expect(policy.can(actor, "client.read", { clientId: "c1" })).toBe(true);
    expect(policy.can(actor, "client.read", { clientId: "c2" })).toBe(false);
    expect(policy.can(actor, "client.read", { clientId: "c3" })).toBe(false);
    expect(policy.can(actor, "client.read", { clientId: "c4" })).toBe(false);
    expect(policy.can(actor, "client.read", { clientId: "other" })).toBe(false);
  });

  it("keeps Archived clients readable but not writable, and Closed clients unreachable", () => {
    const actor = member([m("c1", "Active", "Archived"), m("c2", "Active", "Closed")]);
    expect(policy.can(actor, "client.read", { clientId: "c1" })).toBe(true);
    expect(policy.can(actor, "client.submit", { clientId: "c1" })).toBe(false);
    expect(policy.can(actor, "client.read", { clientId: "c2" })).toBe(false);
    expect(policy.can(actor, "client.submit", { clientId: "c2" })).toBe(false);
  });

  it("lets an active member of an Active client submit, and nobody else", () => {
    expect(policy.can(member([m("c1")]), "client.submit", { clientId: "c1" })).toBe(true);
    expect(policy.can(member([m("c1")]), "client.submit", { clientId: "c2" })).toBe(false);
    expect(policy.can(staff("Staff"), "client.submit", { clientId: "c1" })).toBe(false);
  });

  it("requires a resource for client actions", () => {
    expect(policy.can(member([m("c1")]), "client.read")).toBe(false);
  });
});

describe("AccessPolicy file reach", () => {
  it("lets staff read every file", () => {
    for (const state of ["Staged", "NeedsReview", "Published", "Withdrawn", "Trashed"] as const) {
      expect(policy.can(staff("Staff"), "file.read", { file: file("Outbound", state, null) })).toBe(true);
    }
  });

  it("shows a member only Published outbound files of a reachable client", () => {
    const actor = member([m("c1")]);
    expect(policy.can(actor, "file.read", { file: file("Outbound", "Published") })).toBe(true);
    for (const state of ["Staged", "NeedsReview", "Withdrawn", "Trashed"] as const) {
      expect(policy.can(actor, "file.read", { file: file("Outbound", state) })).toBe(false);
    }
    expect(policy.can(actor, "file.read", { file: file("Outbound", "Published", "c2") })).toBe(false);
    expect(policy.can(actor, "file.read", { file: file("Outbound", "Published", null) })).toBe(false);
  });

  it("shows a member the submissions of their own client", () => {
    const actor = member([m("c1")]);
    expect(policy.can(actor, "file.read", { file: file("Inbound", "Submitted") })).toBe(true);
    expect(policy.can(actor, "file.read", { file: file("Inbound", "Acknowledged") })).toBe(true);
    expect(policy.can(actor, "file.read", { file: file("Inbound", "Trashed") })).toBe(false);
    expect(policy.can(actor, "file.read", { file: file("Inbound", "Submitted", "c2") })).toBe(false);
  });

  it("hides files of a Closed client and of a pending membership", () => {
    expect(policy.can(member([m("c1", "Active", "Closed")]), "file.read", { file: file("Outbound", "Published") })).toBe(false);
    expect(policy.can(member([m("c1", "Pending")]), "file.read", { file: file("Outbound", "Published") })).toBe(false);
  });

  it("lets only the submitter cancel a submission that is not yet acknowledged", () => {
    const actor = member([m("c1")], "u1");
    const submitted = { file: file("Inbound", "Submitted"), submitterId: "u1" };
    expect(policy.can(actor, "submission.cancel", submitted)).toBe(true);
    expect(policy.can(member([m("c1")], "u2"), "submission.cancel", submitted)).toBe(false);
    expect(policy.can(actor, "submission.cancel", { file: file("Inbound", "Acknowledged"), submitterId: "u1" })).toBe(false);
    expect(policy.can(staff("Staff"), "submission.cancel", submitted)).toBe(false);
    expect(policy.can(member([m("c1", "Active", "Archived")], "u1"), "submission.cancel", submitted)).toBe(false);
  });
});

describe("AccessPolicy role separation", () => {
  it("forbids office staff from joining a client and members from joining the office", () => {
    expect(policy.canJoin(staff("Staff"), "Client")).toBe(false);
    expect(policy.canJoin(staff("Staff", "Pending"), "Client")).toBe(false);
    expect(policy.canJoin(member([m("c1")]), "Office")).toBe(false);
    expect(policy.canJoin(member([m("c1", "Pending")]), "Office")).toBe(false);
  });

  it("allows joining when the other side is absent or ended", () => {
    expect(policy.canJoin(member([]), "Office")).toBe(true);
    expect(policy.canJoin(member([m("c1", "Revoked"), m("c2", "Rejected")]), "Office")).toBe(true);
    expect(policy.canJoin(member([m("c1")]), "Client")).toBe(true);
    expect(policy.canJoin(staff("Staff", "Revoked"), "Client")).toBe(true);
    expect(policy.canJoin(staff("Staff", "Rejected"), "Client")).toBe(true);
  });

  it("forbids joining the office twice", () => {
    expect(policy.canJoin(staff("Staff"), "Office")).toBe(false);
    expect(policy.canJoin(staff("Staff", "Pending"), "Office")).toBe(false);
  });

  it("ignores office access for a user who somehow holds both roles", () => {
    const both: UserActor = { ...staff("Owner"), memberships: [m("c1")] };
    expect(policy.can(both, "staff.operate")).toBe(false);
    expect(policy.can(both, "client.read", { clientId: "c1" })).toBe(false);
  });
});
