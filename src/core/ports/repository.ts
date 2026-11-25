import type {
  AuditEntry,
  CaseArrival,
  CaseKind,
  CaseRecord,
  CaseState,
  CaseType,
  Client,
  ClientStatus,
  DocRule,
  DocType,
  FileDirection,
  FileReceipt,
  FileRecord,
  FileState,
  Id,
  Invitation,
  InvitationStatus,
  LocalDate,
  Membership,
  MembershipStatus,
  MetricEvent,
  OfficeSetting,
  ReviewReason,
  UploadBatch,
  User,
  YearMonth,
} from "../model/types";

export interface Page {
  limit: number;
  offset: number;
}

export interface SettingsRepository {
  get(): Promise<OfficeSetting>;
  /** Returns false when the stored version differs from `expectedVersion`. */
  update(setting: OfficeSetting, expectedVersion: number): Promise<boolean>;
}

export interface UserRepository {
  findById(id: Id): Promise<User | null>;
  findByGoogleSub(googleSub: string): Promise<User | null>;
  insert(user: User): Promise<void>;
  updateDisplayName(id: Id, displayName: string): Promise<void>;
  /**
   * Writes the office role and status of `user` only while the stored office status equals
   * `expectedStatus`. Returns false otherwise.
   */
  transitionOffice(user: User, expectedStatus: MembershipStatus | null): Promise<boolean>;
  /**
   * Revokes an Active office member in one atomic step. Refuses when the user is the last
   * active Owner or is not an Active office member.
   */
  revokeOfficeUnlessLastOwner(id: Id): Promise<"ok" | "last_owner" | "not_active">;
  /**
   * Makes the user an Active Owner in one atomic step, only while no active Owner exists and the
   * user holds no ongoing office membership. Returns false otherwise.
   */
  claimOwnerIfNone(id: Id): Promise<boolean>;
  listOffice(): Promise<User[]>;
  countActiveOwners(): Promise<number>;
}

export interface ClientFilter {
  status?: ClientStatus;
  /** Matches the start of the code or any part of the corporate name. */
  query?: string;
}

export interface ClientRepository {
  findById(id: Id): Promise<Client | null>;
  findByCode(code: string): Promise<Client | null>;
  findByCorporateNumber(corporateNumber: string): Promise<Client[]>;
  list(filter: ClientFilter, page: Page): Promise<Client[]>;
  listAll(): Promise<Client[]>;
  /** Returns false when the code is already taken. */
  insert(client: Client): Promise<boolean>;
  update(client: Client, expectedVersion: number): Promise<boolean>;
}

export interface MembershipRepository {
  findById(id: Id): Promise<Membership | null>;
  /** The membership that is Pending or Active for this pair, if any. */
  findOngoing(userId: Id, clientId: Id): Promise<Membership | null>;
  listByUser(userId: Id): Promise<Membership[]>;
  listByClient(clientId: Id): Promise<Membership[]>;
  /** Returns false when an ongoing membership already exists for the pair. */
  insert(membership: Membership): Promise<boolean>;
  /** Applies the change only while the stored status equals `expectedStatus`. Returns false otherwise. */
  transition(membership: Membership, expectedStatus: MembershipStatus): Promise<boolean>;
}

export interface InvitationRepository {
  findById(id: Id): Promise<Invitation | null>;
  findByCodeHash(codeHash: string): Promise<Invitation | null>;
  /** Issued invitations for one client, or for the office when `clientId` is null. */
  listIssued(clientId: Id | null): Promise<Invitation[]>;
  /** The most recent invitation this user redeemed for the given target, if any. */
  findLatestRedeemedBy(userId: Id, clientId: Id | null): Promise<Invitation | null>;
  insert(invitation: Invitation): Promise<void>;
  /** Applies the change only while the stored status equals `expectedStatus`. Returns false otherwise. */
  transition(invitation: Invitation, expectedStatus: InvitationStatus): Promise<boolean>;
  /** Marks Issued invitations past their expiry as Expired and returns how many changed. */
  expireBefore(now: Date): Promise<number>;
}

/** Ends every session of a user. Implemented by the session store of the application. */
export interface SessionRevoker {
  revokeAllForUser(userId: Id): Promise<void>;
}

export interface CaseTypeRepository {
  findById(id: Id): Promise<CaseType | null>;
  list(): Promise<CaseType[]>;
  insert(caseType: CaseType): Promise<void>;
  update(caseType: CaseType): Promise<void>;
}

export interface CaseFilter {
  clientId?: Id;
  kind?: CaseKind;
  states?: readonly CaseState[];
  targetMonth?: YearMonth;
}

export interface CaseRepository {
  findById(id: Id): Promise<CaseRecord | null>;
  findByArrivalNumber(arrivalNumber: string): Promise<CaseRecord | null>;
  list(filter: CaseFilter, page: Page): Promise<CaseRecord[]>;
  nextSequence(clientId: Id, caseTypeId: Id, targetMonth: YearMonth): Promise<number>;
  /** Returns false when the client, type, month and sequence are already taken. */
  insert(record: CaseRecord): Promise<boolean>;
  update(record: CaseRecord, expectedVersion: number): Promise<boolean>;
  /**
   * Writes the case and adds the arrival numbers as one atomic step. Nothing is written when the
   * version is stale or any arrival number already belongs to a case.
   */
  updateWithArrivals(record: CaseRecord, expectedVersion: number, arrivals: readonly CaseArrival[]): Promise<"ok" | "stale" | "arrival_taken">;
  listArrivals(caseId: Id): Promise<CaseArrival[]>;
  /** Returns false when the arrival number already belongs to a case. */
  addArrival(arrival: CaseArrival): Promise<boolean>;
}

export interface DocTypeRepository {
  findById(id: Id): Promise<DocType | null>;
  list(): Promise<DocType[]>;
  /** Returns false when the short code is already taken. */
  insert(docType: DocType): Promise<boolean>;
  update(docType: DocType): Promise<boolean>;
  listRules(): Promise<DocRule[]>;
  insertRule(rule: DocRule): Promise<void>;
  /** Returns false when no rule had this id. */
  deleteRule(id: Id): Promise<boolean>;
}

export interface FileFilter {
  direction?: FileDirection;
  states?: readonly FileState[];
  clientId?: Id;
  caseId?: Id;
  docTypeId?: Id;
  targetMonth?: YearMonth;
  reviewReason?: ReviewReason;
  incidentOnly?: boolean;
}

/** Counts of the files linked to a case, used to derive the case state. */
export interface CaseFileSummary {
  outbound: number;
  published: number;
  publishedAndOpened: number;
  inbound: number;
}

/**
 * Outcome of writing a file record. `name_taken`: the display name exists (retry with the next
 * sequence). `duplicate_content`: the client already holds this content. `stale`: the stored
 * version differs from the expected one (insert never returns it).
 */
export type FileWriteResult = "ok" | "name_taken" | "duplicate_content" | "stale";

export interface FileRepository {
  findById(id: Id): Promise<FileRecord | null>;
  /** Files with this content that are not trashed. */
  findActiveBySha256(sha256: string): Promise<FileRecord[]>;
  list(filter: FileFilter, page: Page): Promise<FileRecord[]>;
  count(filter: FileFilter): Promise<number>;
  /** Next number for display names of this client (or of unassigned files) on the given day. */
  nextDisplaySequence(clientId: Id | null, receivedOn: LocalDate): Promise<number>;
  insert(file: FileRecord): Promise<FileWriteResult>;
  update(file: FileRecord, expectedVersion: number): Promise<FileWriteResult>;
  summarizeForCase(caseId: Id): Promise<CaseFileSummary>;
  listTrashedBefore(threshold: Date, page: Page): Promise<FileRecord[]>;
  /**
   * Permanently removes the record and its receipts and appends the audit entry, as one atomic
   * step, only while the file is still trashed and was trashed at or before `trashedBefore`.
   * Returns false, writing nothing, when the file was restored or erased in the meantime.
   */
  purge(id: Id, trashedBefore: Date, audit: AuditEntry): Promise<boolean>;
  insertBatch(batch: UploadBatch): Promise<void>;
  findBatch(id: Id): Promise<UploadBatch | null>;
}

export interface ReceiptRepository {
  /** Records the first view. Returns false when this user had already opened the file. */
  insertIfAbsent(receipt: FileReceipt): Promise<boolean>;
  listByFile(fileId: Id): Promise<FileReceipt[]>;
  listByFiles(fileIds: readonly Id[]): Promise<FileReceipt[]>;
  hasOpened(fileId: Id, userId: Id): Promise<boolean>;
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<void>;
  list(page: Page): Promise<AuditEntry[]>;
}

export interface MetricRepository {
  append(event: MetricEvent): Promise<void>;
}

/** Persistence port of the Domain Core. */
export interface Repository {
  settings: SettingsRepository;
  users: UserRepository;
  clients: ClientRepository;
  memberships: MembershipRepository;
  invitations: InvitationRepository;
  sessions: SessionRevoker;
  caseTypes: CaseTypeRepository;
  cases: CaseRepository;
  docTypes: DocTypeRepository;
  files: FileRepository;
  receipts: ReceiptRepository;
  audit: AuditRepository;
  metrics: MetricRepository;
}
