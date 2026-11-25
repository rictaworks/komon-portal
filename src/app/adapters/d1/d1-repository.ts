import type { Repository } from "../../../core/ports/repository";
import {
  D1ClientRepository, D1InvitationRepository, D1MembershipRepository, D1SessionRevoker, D1SettingsRepository, D1UserRepository,
} from "./access-repositories";
import { D1CaseRepository, D1CaseTypeRepository, D1DocTypeRepository } from "./case-repositories";
import { D1AuditRepository, D1FileRepository, D1MetricRepository, D1ReceiptRepository } from "./file-repositories";

/** Repository port backed by Cloudflare D1. */
export class D1Repository implements Repository {
  readonly settings: D1SettingsRepository;
  readonly users: D1UserRepository;
  readonly clients: D1ClientRepository;
  readonly memberships: D1MembershipRepository;
  readonly invitations: D1InvitationRepository;
  readonly sessions: D1SessionRevoker;
  readonly caseTypes: D1CaseTypeRepository;
  readonly cases: D1CaseRepository;
  readonly docTypes: D1DocTypeRepository;
  readonly files: D1FileRepository;
  readonly receipts: D1ReceiptRepository;
  readonly audit: D1AuditRepository;
  readonly metrics: D1MetricRepository;

  constructor(db: D1Database) {
    this.settings = new D1SettingsRepository(db);
    this.users = new D1UserRepository(db);
    this.clients = new D1ClientRepository(db);
    this.memberships = new D1MembershipRepository(db);
    this.invitations = new D1InvitationRepository(db);
    this.sessions = new D1SessionRevoker(db);
    this.caseTypes = new D1CaseTypeRepository(db);
    this.cases = new D1CaseRepository(db);
    this.docTypes = new D1DocTypeRepository(db);
    this.files = new D1FileRepository(db);
    this.receipts = new D1ReceiptRepository(db);
    this.audit = new D1AuditRepository(db);
    this.metrics = new D1MetricRepository(db);
  }
}
