import type {
  Client, ClientStatus, Id, Invitation, InvitationStatus, Membership, MembershipStatus, OfficeRole, OfficeSetting, User,
} from "../../../core/model/types";
import type {
  ClientFilter, ClientRepository, InvitationRepository, MembershipRepository, Page, SessionRevoker, SettingsRepository,
  UserRepository,
} from "../../../core/ports/repository";
import {
  changes, escapeLike, fromIso, fromIsoOrNull, isUniqueViolation, text, textOrNull, toIso, toIsoOrNull, whereSql, type Row,
  type Where,
} from "./sql";

function toSetting(row: Row): OfficeSetting {
  return {
    timezone: text(row.timezone),
    arrivalNumberPattern: text(row.arrival_number_pattern),
    retrievalDeadlineDays: Number(row.retrieval_deadline_days),
    autoPublishEnabled: Number(row.auto_publish_enabled) === 1,
    jevThreshold: Number(row.jev_threshold),
    version: Number(row.version),
  };
}

export class D1SettingsRepository implements SettingsRepository {
  constructor(private readonly db: D1Database) {}

  async get(): Promise<OfficeSetting> {
    const row = await this.db.prepare("SELECT * FROM office_setting WHERE id = 1").first<Row>();
    if (row === null) {
      throw new Error("office_setting row is missing; apply the migrations");
    }
    return toSetting(row);
  }

  async update(setting: OfficeSetting, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE office_setting SET timezone = ?, arrival_number_pattern = ?, retrieval_deadline_days = ?, auto_publish_enabled = ?, jev_threshold = ?, version = ? WHERE id = 1 AND version = ?",
      )
      .bind(
        setting.timezone, setting.arrivalNumberPattern, setting.retrievalDeadlineDays, setting.autoPublishEnabled ? 1 : 0,
        setting.jevThreshold, setting.version, expectedVersion,
      )
      .run();
    return changes(result) === 1;
  }
}

function toUser(row: Row): User {
  return {
    id: text(row.id),
    googleSub: text(row.google_sub),
    displayName: text(row.display_name),
    officeRole: textOrNull(row.office_role) as OfficeRole | null,
    officeStatus: textOrNull(row.office_status) as MembershipStatus | null,
    createdAt: fromIso(row.created_at),
  };
}

export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<User | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toUser(row);
  }

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE google_sub = ?").bind(googleSub).first<Row>();
    return row === null ? null : toUser(row);
  }

  async insert(user: User): Promise<void> {
    await this.db
      .prepare("INSERT INTO users (id, google_sub, display_name, office_role, office_status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(user.id, user.googleSub, user.displayName, user.officeRole, user.officeStatus, toIso(user.createdAt))
      .run();
  }

  async updateDisplayName(id: Id, displayName: string): Promise<void> {
    await this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, id).run();
  }

  async transitionOffice(user: User, expectedStatus: MembershipStatus | null): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE users SET office_role = ?, office_status = ? WHERE id = ? AND office_status IS ?")
      .bind(user.officeRole, user.officeStatus, user.id, expectedStatus)
      .run();
    return changes(result) === 1;
  }

  async revokeOfficeUnlessLastOwner(id: Id): Promise<"ok" | "last_owner" | "not_active"> {
    const result = await this.db
      .prepare(
        `UPDATE users SET office_status = 'Revoked'
         WHERE id = ? AND office_status = 'Active'
           AND (office_role <> 'Owner'
                OR (SELECT COUNT(*) FROM users WHERE office_role = 'Owner' AND office_status = 'Active') > 1)`,
      )
      .bind(id)
      .run();
    if (changes(result) === 1) {
      return "ok";
    }
    const current = await this.findById(id);
    return current !== null && current.officeStatus === "Active" ? "last_owner" : "not_active";
  }

  async claimOwnerIfNone(id: Id): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE users SET office_role = 'Owner', office_status = 'Active'
         WHERE id = ? AND (office_status IS NULL OR office_status IN ('Revoked', 'Rejected'))
           AND NOT EXISTS (SELECT 1 FROM users WHERE office_role = 'Owner' AND office_status = 'Active')`,
      )
      .bind(id)
      .run();
    return changes(result) === 1;
  }

  async listOffice(): Promise<User[]> {
    const rows = await this.db.prepare("SELECT * FROM users WHERE office_role IS NOT NULL ORDER BY created_at, id").all<Row>();
    return rows.results.map(toUser);
  }

  async countActiveOwners(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE office_role = 'Owner' AND office_status = 'Active'")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

function toClient(row: Row): Client {
  return {
    id: text(row.id),
    code: text(row.code),
    corporateName: text(row.corporate_name),
    corporateNumber: textOrNull(row.corporate_number),
    status: text(row.status) as ClientStatus,
    version: Number(row.version),
  };
}

export class D1ClientRepository implements ClientRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Client | null> {
    const row = await this.db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toClient(row);
  }

  async findByCode(code: string): Promise<Client | null> {
    const row = await this.db.prepare("SELECT * FROM clients WHERE code = ?").bind(code).first<Row>();
    return row === null ? null : toClient(row);
  }

  async findByCorporateNumber(corporateNumber: string): Promise<Client[]> {
    const rows = await this.db.prepare("SELECT * FROM clients WHERE corporate_number = ? ORDER BY code").bind(corporateNumber).all<Row>();
    return rows.results.map(toClient);
  }

  async list(filter: ClientFilter, page: Page): Promise<Client[]> {
    const where: Where = { clauses: [], params: [] };
    if (filter.status !== undefined) {
      where.clauses.push("status = ?");
      where.params.push(filter.status);
    }
    if (filter.query !== undefined && filter.query !== "") {
      const escaped = escapeLike(filter.query);
      where.clauses.push("(code LIKE ? ESCAPE '\\' OR corporate_name LIKE ? ESCAPE '\\')");
      where.params.push(`${escaped}%`, `%${escaped}%`);
    }
    const rows = await this.db
      .prepare(`SELECT * FROM clients${whereSql(where)} ORDER BY code LIMIT ? OFFSET ?`)
      .bind(...where.params, page.limit, page.offset)
      .all<Row>();
    return rows.results.map(toClient);
  }

  async listAll(): Promise<Client[]> {
    const rows = await this.db.prepare("SELECT * FROM clients ORDER BY code").all<Row>();
    return rows.results.map(toClient);
  }

  async insert(client: Client): Promise<boolean> {
    try {
      await this.db
        .prepare("INSERT INTO clients (id, code, corporate_name, corporate_number, status, version) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(client.id, client.code, client.corporateName, client.corporateNumber, client.status, client.version)
        .run();
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "clients.code")) {
        return false;
      }
      throw error;
    }
  }

  async update(client: Client, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE clients SET code = ?, corporate_name = ?, corporate_number = ?, status = ?, version = ? WHERE id = ? AND version = ?")
      .bind(client.code, client.corporateName, client.corporateNumber, client.status, client.version, client.id, expectedVersion)
      .run();
    return changes(result) === 1;
  }
}

function toMembership(row: Row): Membership {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    clientId: text(row.client_id),
    status: text(row.status) as MembershipStatus,
    approvedBy: textOrNull(row.approved_by),
    approvedAt: fromIsoOrNull(row.approved_at),
    createdAt: fromIso(row.created_at),
  };
}

export class D1MembershipRepository implements MembershipRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Membership | null> {
    const row = await this.db.prepare("SELECT * FROM memberships WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toMembership(row);
  }

  async findOngoing(userId: Id, clientId: Id): Promise<Membership | null> {
    const row = await this.db
      .prepare("SELECT * FROM memberships WHERE user_id = ? AND client_id = ? AND status IN ('Pending', 'Active')")
      .bind(userId, clientId)
      .first<Row>();
    return row === null ? null : toMembership(row);
  }

  async listByUser(userId: Id): Promise<Membership[]> {
    const rows = await this.db.prepare("SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at, id").bind(userId).all<Row>();
    return rows.results.map(toMembership);
  }

  async listByClient(clientId: Id): Promise<Membership[]> {
    const rows = await this.db.prepare("SELECT * FROM memberships WHERE client_id = ? ORDER BY created_at, id").bind(clientId).all<Row>();
    return rows.results.map(toMembership);
  }

  async insert(membership: Membership): Promise<boolean> {
    try {
      await this.db
        .prepare("INSERT INTO memberships (id, user_id, client_id, status, approved_by, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(
          membership.id, membership.userId, membership.clientId, membership.status, membership.approvedBy,
          toIsoOrNull(membership.approvedAt), toIso(membership.createdAt),
        )
        .run();
      return true;
    } catch (error) {
      if (isUniqueViolation(error, "memberships")) {
        return false;
      }
      throw error;
    }
  }

  async transition(membership: Membership, expectedStatus: MembershipStatus): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE memberships SET status = ?, approved_by = ?, approved_at = ? WHERE id = ? AND status = ?")
      .bind(membership.status, membership.approvedBy, toIsoOrNull(membership.approvedAt), membership.id, expectedStatus)
      .run();
    return changes(result) === 1;
  }
}

function toInvitation(row: Row): Invitation {
  return {
    id: text(row.id),
    codeHash: text(row.code_hash),
    targetType: text(row.target_type) as Invitation["targetType"],
    clientId: textOrNull(row.client_id),
    officeRole: textOrNull(row.office_role) as OfficeRole | null,
    issuedBy: text(row.issued_by),
    expiresAt: fromIso(row.expires_at),
    status: text(row.status) as InvitationStatus,
    redeemedBy: textOrNull(row.redeemed_by),
    redeemedAt: fromIsoOrNull(row.redeemed_at),
    createdAt: fromIso(row.created_at),
  };
}

export class D1InvitationRepository implements InvitationRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Invitation | null> {
    const row = await this.db.prepare("SELECT * FROM invitations WHERE id = ?").bind(id).first<Row>();
    return row === null ? null : toInvitation(row);
  }

  async findByCodeHash(codeHash: string): Promise<Invitation | null> {
    const row = await this.db.prepare("SELECT * FROM invitations WHERE code_hash = ?").bind(codeHash).first<Row>();
    return row === null ? null : toInvitation(row);
  }

  async listIssued(clientId: Id | null): Promise<Invitation[]> {
    const rows = await this.db
      .prepare("SELECT * FROM invitations WHERE status = 'Issued' AND client_id IS ? ORDER BY created_at, id")
      .bind(clientId)
      .all<Row>();
    return rows.results.map(toInvitation);
  }

  async findLatestRedeemedBy(userId: Id, clientId: Id | null): Promise<Invitation | null> {
    const row = await this.db
      .prepare("SELECT * FROM invitations WHERE redeemed_by = ? AND client_id IS ? AND redeemed_at IS NOT NULL ORDER BY redeemed_at DESC LIMIT 1")
      .bind(userId, clientId)
      .first<Row>();
    return row === null ? null : toInvitation(row);
  }

  async insert(invitation: Invitation): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO invitations (id, code_hash, target_type, client_id, office_role, issued_by, expires_at, status, redeemed_by, redeemed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        invitation.id, invitation.codeHash, invitation.targetType, invitation.clientId, invitation.officeRole, invitation.issuedBy,
        toIso(invitation.expiresAt), invitation.status, invitation.redeemedBy, toIsoOrNull(invitation.redeemedAt), toIso(invitation.createdAt),
      )
      .run();
  }

  async transition(invitation: Invitation, expectedStatus: InvitationStatus): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE invitations SET status = ?, redeemed_by = ?, redeemed_at = ? WHERE id = ? AND status = ?")
      .bind(invitation.status, invitation.redeemedBy, toIsoOrNull(invitation.redeemedAt), invitation.id, expectedStatus)
      .run();
    return changes(result) === 1;
  }

  async expireBefore(now: Date): Promise<number> {
    const result = await this.db
      .prepare("UPDATE invitations SET status = 'Expired' WHERE status = 'Issued' AND expires_at <= ?")
      .bind(toIso(now))
      .run();
    return changes(result);
  }
}

export class D1SessionRevoker implements SessionRevoker {
  constructor(private readonly db: D1Database) {}

  async revokeAllForUser(userId: Id): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
}
