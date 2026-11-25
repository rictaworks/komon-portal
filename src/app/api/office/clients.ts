import { Hono } from "hono";
import { invalidInput, notFound } from "../../../core/model/errors";
import { CLIENT_STATUSES, OFFICE_ROLES, type Invitation } from "../../../core/model/types";
import { requireAuth, type AppBindings, type AppContext } from "../context";
import { optionalString, readJson, requireEnum, requireInteger, requireString } from "../input";
import { pageOf } from "./views";

function invitationView(invitation: Invitation): Record<string, unknown> {
  return { id: invitation.id, targetType: invitation.targetType, clientId: invitation.clientId, officeRole: invitation.officeRole, expiresAt: invitation.expiresAt, status: invitation.status };
}

function statusFilter(c: AppContext): (typeof CLIENT_STATUSES)[number] | undefined {
  const value = c.req.query("status");
  if (value === undefined || value === "") {
    return undefined;
  }
  const match = CLIENT_STATUSES.find((status) => status === value);
  if (match === undefined) {
    throw invalidInput("status");
  }
  return match;
}

/** Member counts are one extra grouped lookup with one bound value per listed client, so they are opt-in and limited to a small page. */
const MEMBER_COUNT_PAGE_LIMIT = 50;

function includesMemberCounts(c: AppContext): boolean {
  const value = c.req.query("include");
  if (value === undefined || value === "") {
    return false;
  }
  if (value !== "members") {
    throw invalidInput("include");
  }
  return true;
}

export function clientRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/clients", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "client", id: "list" });
    const status = statusFilter(c);
    const query = c.req.query("query");
    const withMembers = includesMemberCounts(c);
    const page = pageOf(c);
    if (withMembers && page.limit > MEMBER_COUNT_PAGE_LIMIT) {
      throw invalidInput("limit");
    }
    const items = await services.repository.clients.list(
      { ...(status === undefined ? {} : { status }), ...(query === undefined || query === "" ? {} : { query }) },
      page,
    );
    if (!withMembers) {
      return c.json({ items });
    }
    const counts = await services.repository.memberships.countOngoingByClients(items.map((client) => client.id));
    // A client without an entry has no active or pending member.
    return c.json({ items: items.map((client) => ({ ...client, members: counts.get(client.id) ?? { active: 0, pending: 0 } })) });
  });

  routes.post("/clients", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const created = await c.get("services").clients.register(actor, {
      code: requireString(body, "code", 32),
      corporateName: requireString(body, "corporateName"),
      corporateNumber: optionalString(body, "corporateNumber", 13),
    });
    return c.json(created, 201);
  });

  routes.get("/clients/:id", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    await services.guard.require(actor, "staff.operate", { type: "client", id: c.req.param("id") });
    const client = await services.repository.clients.findById(c.req.param("id"));
    if (client === null) {
      throw notFound("client");
    }
    return c.json(client);
  });

  routes.patch("/clients/:id", async (c) => {
    const { actor } = requireAuth(c);
    const body = await readJson(c);
    const updated = await c.get("services").clients.update(
      actor,
      c.req.param("id"),
      {
        corporateName: requireString(body, "corporateName"),
        corporateNumber: optionalString(body, "corporateNumber", 13),
        status: requireEnum(body, "status", CLIENT_STATUSES),
      },
      requireInteger(body, "version"),
    );
    return c.json(updated);
  });

  routes.get("/clients/:id/members", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const members = await services.invitations.listClientMembers(actor, c.req.param("id"));
    const invitations = await services.repository.invitations.listIssued(c.req.param("id"));
    return c.json({
      members: members.map((view) => ({
        membershipId: view.membership.id,
        displayName: view.displayName,
        status: view.membership.status,
        redeemedAt: view.redeemedAt,
        approvedAt: view.membership.approvedAt,
      })),
      invitations: invitations.map(invitationView),
    });
  });

  routes.post("/clients/:id/invitations", async (c) => {
    const { actor } = requireAuth(c);
    const issued = await c.get("services").invitations.issue(actor, { type: "Client", clientId: c.req.param("id") });
    // The code is returned once here and never again; only its hash is stored.
    return c.json({ ...invitationView(issued.invitation), code: issued.code }, 201);
  });

  routes.post("/invitations/:id/cancel", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").invitations.cancel(actor, c.req.param("id"));
    return c.json({ status: "ok" });
  });

  routes.post("/memberships/:id/approve", async (c) => {
    const { actor } = requireAuth(c);
    const membership = await c.get("services").invitations.approveMembership(actor, c.req.param("id"));
    return c.json({ membershipId: membership.id, status: membership.status });
  });

  routes.post("/memberships/:id/reject", async (c) => {
    const { actor } = requireAuth(c);
    const membership = await c.get("services").invitations.rejectMembership(actor, c.req.param("id"));
    return c.json({ membershipId: membership.id, status: membership.status });
  });

  routes.post("/memberships/:id/revoke", async (c) => {
    const { actor } = requireAuth(c);
    const membership = await c.get("services").invitations.revokeMembership(actor, c.req.param("id"));
    return c.json({ membershipId: membership.id, status: membership.status });
  });

  routes.get("/staff", async (c) => {
    const { actor } = requireAuth(c);
    const services = c.get("services");
    const members = await services.invitations.listOfficeMembers(actor);
    const invitations = await services.repository.invitations.listIssued(null);
    return c.json({
      members: members.map((view) => ({
        userId: view.userId,
        displayName: view.displayName,
        officeRole: view.officeRole,
        officeStatus: view.officeStatus,
        redeemedAt: view.redeemedAt,
      })),
      invitations: invitations.map(invitationView),
    });
  });

  routes.post("/staff/invitations", async (c) => {
    const { actor } = requireAuth(c);
    const role = requireEnum(await readJson(c), "role", OFFICE_ROLES);
    const issued = await c.get("services").invitations.issue(actor, { type: "Office", role });
    return c.json({ ...invitationView(issued.invitation), code: issued.code }, 201);
  });

  routes.post("/staff/:userId/approve", async (c) => {
    const { actor } = requireAuth(c);
    const user = await c.get("services").invitations.approveOffice(actor, c.req.param("userId"));
    return c.json({ userId: user.id, officeRole: user.officeRole, officeStatus: user.officeStatus });
  });

  routes.post("/staff/:userId/reject", async (c) => {
    const { actor } = requireAuth(c);
    const user = await c.get("services").invitations.rejectOffice(actor, c.req.param("userId"));
    return c.json({ userId: user.id, officeRole: user.officeRole, officeStatus: user.officeStatus });
  });

  routes.post("/staff/:userId/revoke", async (c) => {
    const { actor } = requireAuth(c);
    await c.get("services").invitations.revokeOffice(actor, c.req.param("userId"));
    return c.json({ userId: c.req.param("userId"), officeStatus: "Revoked" });
  });

  return routes;
}
