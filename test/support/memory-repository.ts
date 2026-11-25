import type {
  AuditEntry, CaseArrival, CaseRecord, CaseType, Client, DocRule, DocType, FileReceipt, FileRecord, Id, Invitation,
  InvitationStatus, LocalDate, Membership, MembershipStatus, MetricEvent, OfficeSetting, PendingPurge, UploadBatch, User, YearMonth,
} from "../../src/core/model/types";
import type {
  CaseFileSummary, CaseFilter, ClientFilter, FileFilter, FileWriteResult, MemberCounts, Page, Repository,
} from "../../src/core/ports/repository";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function paged<T>(rows: T[], page: Page): T[] {
  return rows.slice(page.offset, page.offset + page.limit).map(copy);
}

/** SQLite lower() folds ASCII letters only; the memory search does the same. */
function asciiLower(value: string): string {
  return value.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
}

const ONGOING: readonly MembershipStatus[] = ["Pending", "Active"];

/** In-memory Repository with the same uniqueness and locking behaviour as the D1 schema. */
export class MemoryRepository implements Repository {
  setting: OfficeSetting = {
    timezone: "Asia/Tokyo",
    arrivalNumberPattern: "[0-9]{17,18}",
    retrievalDeadlineDays: 90,
    autoPublishEnabled: false,
    jevThreshold: 0.9,
    version: 1,
  };
  userRows: User[] = [];
  clientRows: Client[] = [];
  membershipRows: Membership[] = [];
  invitationRows: Invitation[] = [];
  caseTypeRows: CaseType[] = [];
  caseRows: CaseRecord[] = [];
  arrivalRows: CaseArrival[] = [];
  docTypeRows: DocType[] = [];
  ruleRows: DocRule[] = [];
  fileRows: FileRecord[] = [];
  /** Mirrors file_records.purging_at: when the purge of a file began. */
  purgingSince = new Map<Id, Date>();
  batchRows: UploadBatch[] = [];
  receiptRows: FileReceipt[] = [];
  auditRows: AuditEntry[] = [];
  metricRows: MetricEvent[] = [];
  revokedSessionsOf: Id[] = [];

  settings = {
    get: async (): Promise<OfficeSetting> => copy(this.setting),
    update: async (setting: OfficeSetting, expectedVersion: number): Promise<boolean> => {
      if (this.setting.version !== expectedVersion) {
        return false;
      }
      this.setting = copy(setting);
      return true;
    },
  };

  users = {
    findById: async (id: Id): Promise<User | null> => copy(this.userRows.find((row) => row.id === id) ?? null),
    findByGoogleSub: async (googleSub: string): Promise<User | null> =>
      copy(this.userRows.find((row) => row.googleSub === googleSub) ?? null),
    insert: async (user: User): Promise<void> => {
      if (this.userRows.some((row) => row.id === user.id || row.googleSub === user.googleSub)) {
        throw new Error("UNIQUE constraint failed: users");
      }
      this.userRows.push(copy(user));
    },
    updateDisplayName: async (id: Id, displayName: string): Promise<void> => {
      const row = this.userRows.find((candidate) => candidate.id === id);
      if (row !== undefined) {
        row.displayName = displayName;
      }
    },
    transitionOffice: async (user: User, expectedStatus: MembershipStatus | null): Promise<boolean> => {
      const row = this.userRows.find((candidate) => candidate.id === user.id);
      if (row === undefined || row.officeStatus !== expectedStatus) {
        return false;
      }
      row.officeRole = user.officeRole;
      row.officeStatus = user.officeStatus;
      return true;
    },
    revokeOfficeUnlessLastOwner: async (id: Id): Promise<"ok" | "last_owner" | "not_active"> => {
      const row = this.userRows.find((candidate) => candidate.id === id);
      if (row === undefined || row.officeStatus !== "Active") {
        return "not_active";
      }
      if (row.officeRole === "Owner" && (await this.users.countActiveOwners()) <= 1) {
        return "last_owner";
      }
      row.officeStatus = "Revoked";
      return "ok";
    },
    claimOwnerIfNone: async (id: Id): Promise<boolean> => {
      const row = this.userRows.find((candidate) => candidate.id === id);
      const ongoing = row !== undefined && row.officeStatus !== null && ONGOING.includes(row.officeStatus);
      if (row === undefined || ongoing || (await this.users.countActiveOwners()) > 0) {
        return false;
      }
      row.officeRole = "Owner";
      row.officeStatus = "Active";
      return true;
    },
    listOffice: async (): Promise<User[]> => this.userRows.filter((row) => row.officeRole !== null).map(copy),
    countActiveOwners: async (): Promise<number> =>
      this.userRows.filter((row) => row.officeRole === "Owner" && row.officeStatus === "Active").length,
  };

  clients = {
    findById: async (id: Id): Promise<Client | null> => copy(this.clientRows.find((row) => row.id === id) ?? null),
    findByCode: async (code: string): Promise<Client | null> => copy(this.clientRows.find((row) => row.code === code) ?? null),
    findByCorporateNumber: async (corporateNumber: string): Promise<Client[]> =>
      this.clientRows.filter((row) => row.corporateNumber === corporateNumber).map(copy),
    list: async (filter: ClientFilter, page: Page): Promise<Client[]> =>
      paged(
        this.clientRows.filter(
          (row) =>
            (filter.status === undefined || row.status === filter.status) &&
            (filter.query === undefined || asciiLower(row.code).includes(asciiLower(filter.query)) || asciiLower(row.corporateName).includes(asciiLower(filter.query))),
        ),
        page,
      ),
    listAll: async (): Promise<Client[]> => this.clientRows.map(copy),
    insert: async (client: Client): Promise<boolean> => {
      if (this.clientRows.some((row) => row.code === client.code)) {
        return false;
      }
      this.clientRows.push(copy(client));
      return true;
    },
    update: async (client: Client, expectedVersion: number): Promise<boolean> => {
      const index = this.clientRows.findIndex((row) => row.id === client.id);
      if (index < 0 || this.clientRows[index]?.version !== expectedVersion) {
        return false;
      }
      if (this.clientRows.some((row) => row.id !== client.id && row.code === client.code)) {
        throw new Error("UNIQUE constraint failed: clients.code");
      }
      this.clientRows[index] = copy(client);
      return true;
    },
  };

  memberships = {
    findById: async (id: Id): Promise<Membership | null> => copy(this.membershipRows.find((row) => row.id === id) ?? null),
    findOngoing: async (userId: Id, clientId: Id): Promise<Membership | null> =>
      copy(
        this.membershipRows.find((row) => row.userId === userId && row.clientId === clientId && ONGOING.includes(row.status)) ?? null,
      ),
    listByUser: async (userId: Id): Promise<Membership[]> => this.membershipRows.filter((row) => row.userId === userId).map(copy),
    listByClient: async (clientId: Id): Promise<Membership[]> =>
      this.membershipRows.filter((row) => row.clientId === clientId).map(copy),
    countOngoingByClients: async (clientIds: readonly Id[]): Promise<Map<Id, MemberCounts>> => {
      const counts = new Map<Id, MemberCounts>();
      for (const clientId of [...clientIds].sort()) {
        const rows = this.membershipRows.filter((row) => row.clientId === clientId);
        const active = rows.filter((row) => row.status === "Active").length;
        const pending = rows.filter((row) => row.status === "Pending").length;
        if (active + pending > 0) {
          counts.set(clientId, { active, pending });
        }
      }
      return counts;
    },
    insert: async (membership: Membership): Promise<boolean> => {
      if (ONGOING.includes(membership.status) && (await this.memberships.findOngoing(membership.userId, membership.clientId)) !== null) {
        return false;
      }
      this.membershipRows.push(copy(membership));
      return true;
    },
    transition: async (membership: Membership, expectedStatus: MembershipStatus): Promise<boolean> => {
      const index = this.membershipRows.findIndex((row) => row.id === membership.id);
      if (index < 0 || this.membershipRows[index]?.status !== expectedStatus) {
        return false;
      }
      const clash = this.membershipRows.some(
        (row) => row.id !== membership.id && row.userId === membership.userId && row.clientId === membership.clientId && ONGOING.includes(row.status),
      );
      if (ONGOING.includes(membership.status) && clash) {
        throw new Error("UNIQUE constraint failed: memberships_ongoing");
      }
      this.membershipRows[index] = copy(membership);
      return true;
    },
  };

  invitations = {
    findById: async (id: Id): Promise<Invitation | null> => copy(this.invitationRows.find((row) => row.id === id) ?? null),
    findByCodeHash: async (codeHash: string): Promise<Invitation | null> =>
      copy(this.invitationRows.find((row) => row.codeHash === codeHash) ?? null),
    listIssued: async (clientId: Id | null): Promise<Invitation[]> =>
      this.invitationRows.filter((row) => row.status === "Issued" && row.clientId === clientId).map(copy),
    findLatestRedeemedBy: async (userId: Id, clientId: Id | null): Promise<Invitation | null> => {
      const rows = this.invitationRows
        .filter((row) => row.redeemedBy === userId && row.clientId === clientId && row.redeemedAt !== null)
        .sort((a, b) => (b.redeemedAt?.getTime() ?? 0) - (a.redeemedAt?.getTime() ?? 0));
      return copy(rows[0] ?? null);
    },
    insert: async (invitation: Invitation): Promise<void> => {
      if (this.invitationRows.some((row) => row.codeHash === invitation.codeHash)) {
        throw new Error("UNIQUE constraint failed: invitations.code_hash");
      }
      this.invitationRows.push(copy(invitation));
    },
    transition: async (invitation: Invitation, expectedStatus: InvitationStatus): Promise<boolean> => {
      const index = this.invitationRows.findIndex((row) => row.id === invitation.id);
      if (index < 0 || this.invitationRows[index]?.status !== expectedStatus) {
        return false;
      }
      this.invitationRows[index] = copy(invitation);
      return true;
    },
    expireBefore: async (now: Date): Promise<number> => {
      const expired = this.invitationRows.filter((row) => row.status === "Issued" && row.expiresAt.getTime() <= now.getTime());
      expired.forEach((row) => {
        row.status = "Expired";
      });
      return expired.length;
    },
  };

  sessions = {
    revokeAllForUser: async (userId: Id): Promise<void> => {
      this.revokedSessionsOf.push(userId);
    },
  };

  caseTypes = {
    findById: async (id: Id): Promise<CaseType | null> => copy(this.caseTypeRows.find((row) => row.id === id) ?? null),
    list: async (): Promise<CaseType[]> => this.caseTypeRows.map(copy),
    insert: async (caseType: CaseType): Promise<void> => {
      this.caseTypeRows.push(copy(caseType));
    },
    update: async (caseType: CaseType): Promise<void> => {
      const index = this.caseTypeRows.findIndex((row) => row.id === caseType.id);
      if (index >= 0) {
        this.caseTypeRows[index] = copy(caseType);
      }
    },
  };

  private kindOf(caseTypeId: Id): string | undefined {
    return this.caseTypeRows.find((row) => row.id === caseTypeId)?.kind;
  }

  cases = {
    findById: async (id: Id): Promise<CaseRecord | null> => copy(this.caseRows.find((row) => row.id === id) ?? null),
    findByArrivalNumber: async (arrivalNumber: string): Promise<CaseRecord | null> => {
      const arrival = this.arrivalRows.find((row) => row.arrivalNumber === arrivalNumber);
      return arrival === undefined ? null : this.cases.findById(arrival.caseId);
    },
    list: async (filter: CaseFilter, page: Page): Promise<CaseRecord[]> =>
      paged(
        this.caseRows.filter(
          (row) =>
            (filter.clientId === undefined || row.clientId === filter.clientId) &&
            (filter.kind === undefined || this.kindOf(row.caseTypeId) === filter.kind) &&
            (filter.states === undefined || filter.states.includes(row.state)) &&
            (filter.targetMonth === undefined || row.targetMonth === filter.targetMonth),
        ),
        page,
      ),
    nextSequence: async (clientId: Id, caseTypeId: Id, targetMonth: YearMonth): Promise<number> => {
      const used = this.caseRows
        .filter((row) => row.clientId === clientId && row.caseTypeId === caseTypeId && row.targetMonth === targetMonth)
        .map((row) => row.sequence);
      return Math.max(0, ...used) + 1;
    },
    insert: async (record: CaseRecord): Promise<boolean> => {
      const taken = this.caseRows.some(
        (row) =>
          row.clientId === record.clientId &&
          row.caseTypeId === record.caseTypeId &&
          row.targetMonth === record.targetMonth &&
          row.sequence === record.sequence,
      );
      if (taken) {
        return false;
      }
      this.caseRows.push(copy(record));
      return true;
    },
    update: async (record: CaseRecord, expectedVersion: number): Promise<boolean> => {
      const index = this.caseRows.findIndex((row) => row.id === record.id);
      if (index < 0 || this.caseRows[index]?.version !== expectedVersion) {
        return false;
      }
      this.caseRows[index] = copy(record);
      return true;
    },
    updateWithArrivals: async (record: CaseRecord, expectedVersion: number, arrivals: readonly CaseArrival[]): Promise<"ok" | "stale" | "arrival_taken"> => {
      const index = this.caseRows.findIndex((row) => row.id === record.id);
      if (index < 0 || this.caseRows[index]?.version !== expectedVersion) {
        return "stale";
      }
      if (arrivals.some((arrival) => this.arrivalRows.some((row) => row.arrivalNumber === arrival.arrivalNumber))) {
        return "arrival_taken";
      }
      this.caseRows[index] = copy(record);
      this.arrivalRows.push(...arrivals.map(copy));
      return "ok";
    },
    listArrivals: async (caseId: Id): Promise<CaseArrival[]> => this.arrivalRows.filter((row) => row.caseId === caseId).map(copy),
    addArrival: async (arrival: CaseArrival): Promise<boolean> => {
      if (this.arrivalRows.some((row) => row.arrivalNumber === arrival.arrivalNumber)) {
        return false;
      }
      this.arrivalRows.push(copy(arrival));
      return true;
    },
  };

  docTypes = {
    findById: async (id: Id): Promise<DocType | null> => copy(this.docTypeRows.find((row) => row.id === id) ?? null),
    list: async (): Promise<DocType[]> => this.docTypeRows.map(copy),
    insert: async (docType: DocType): Promise<boolean> => {
      if (this.docTypeRows.some((row) => row.shortCode === docType.shortCode)) {
        return false;
      }
      this.docTypeRows.push(copy(docType));
      return true;
    },
    update: async (docType: DocType): Promise<boolean> => {
      const index = this.docTypeRows.findIndex((row) => row.id === docType.id);
      if (index < 0 || this.docTypeRows.some((row) => row.id !== docType.id && row.shortCode === docType.shortCode)) {
        return false;
      }
      this.docTypeRows[index] = copy(docType);
      return true;
    },
    listRules: async (): Promise<DocRule[]> => this.ruleRows.map(copy),
    insertRule: async (rule: DocRule): Promise<void> => {
      this.ruleRows.push(copy(rule));
    },
    deleteRule: async (id: Id): Promise<boolean> => {
      const before = this.ruleRows.length;
      this.ruleRows = this.ruleRows.filter((row) => row.id !== id);
      return this.ruleRows.length < before;
    },
  };

  private matchesFile(row: FileRecord, filter: FileFilter): boolean {
    return (
      !this.purgingSince.has(row.id) &&
      (filter.direction === undefined || row.direction === filter.direction) &&
      (filter.states === undefined || filter.states.includes(row.state)) &&
      (filter.clientId === undefined || row.clientId === filter.clientId) &&
      (filter.caseId === undefined || row.caseId === filter.caseId) &&
      (filter.docTypeId === undefined || row.docTypeId === filter.docTypeId) &&
      (filter.untyped !== true || row.docTypeId === null) &&
      (filter.targetMonth === undefined || row.targetMonth === filter.targetMonth) &&
      (filter.reviewReason === undefined || row.reviewReason === filter.reviewReason) &&
      (filter.incidentOnly !== true || row.incidentFlag)
    );
  }

  /** Mirrors the CHECK and foreign key constraints of file_records. A violation throws, as D1 would. */
  private assertFileConstraints(file: FileRecord): void {
    const fail = (rule: string): never => {
      throw new Error(`CHECK constraint failed: file_records ${rule}`);
    };
    const outbound: readonly string[] = ["Staged", "NeedsReview", "Published", "Withdrawn", "Trashed"];
    const inbound: readonly string[] = ["Submitted", "Acknowledged", "Trashed"];
    if (!(file.direction === "Outbound" ? outbound : inbound).includes(file.state)) fail("direction/state");
    if (["Staged", "Published", "Withdrawn", "Submitted", "Acknowledged"].includes(file.state) && file.clientId === null) fail("client required");
    if ((file.state === "Trashed") !== (file.trashedAt !== null)) fail("trashed_at");
    if ((file.state === "Trashed") !== (file.trashedFrom !== null)) fail("trashed_from");
    if (file.state === "NeedsReview" && file.reviewReason === null) fail("review_reason");
    if (file.state === "Published" && file.publishedAt === null) fail("published_at");
    if (file.state === "Withdrawn" && file.withdrawReason === null) fail("withdraw_reason");
    if (file.state === "Acknowledged" && file.acknowledgedAt === null) fail("acknowledged_at");
    if (file.caseId !== null) {
      const linked = this.caseRows.find((row) => row.id === file.caseId);
      if (linked === undefined || linked.clientId !== file.clientId) fail("case of another client");
    }
    if (this.fileRows.some((row) => row.id !== file.id && row.r2Key === file.r2Key)) fail("r2_key");
  }

  private async displayPrefix(clientId: Id | null): Promise<string> {
    const code = clientId === null ? "UNASSIGNED" : this.clientRows.find((row) => row.id === clientId)?.code;
    return `${code}_`;
  }

  private isDue(row: FileRecord, threshold: Date): boolean {
    return row.state === "Trashed" && row.trashedAt !== null && row.trashedAt.getTime() <= threshold.getTime();
  }

  private fileConflict(file: FileRecord): FileWriteResult {
    this.assertFileConstraints(file);
    const others = this.fileRows.filter((row) => row.id !== file.id);
    if (others.some((row) => row.displayName === file.displayName)) {
      return "name_taken";
    }
    const duplicate =
      file.state !== "Trashed" &&
      file.clientId !== null &&
      others.some((row) => row.state !== "Trashed" && row.clientId === file.clientId && row.sha256 === file.sha256);
    return duplicate ? "duplicate_content" : "ok";
  }

  files = {
    findById: async (id: Id): Promise<FileRecord | null> => copy(this.fileRows.find((row) => row.id === id && !this.purgingSince.has(row.id)) ?? null),
    findActiveBySha256: async (sha256: string): Promise<FileRecord[]> =>
      this.fileRows.filter((row) => row.sha256 === sha256 && row.state !== "Trashed").map(copy),
    list: async (filter: FileFilter, page: Page): Promise<FileRecord[]> =>
      paged(
        this.fileRows.filter((row) => this.matchesFile(row, filter)).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()),
        page,
      ),
    count: async (filter: FileFilter): Promise<number> => this.fileRows.filter((row) => this.matchesFile(row, filter)).length,
    nextDisplaySequence: async (clientId: Id | null, receivedOn: LocalDate): Promise<number> => {
      const compact = receivedOn.replaceAll("-", "");
      // Display names are unique across all files, so the sequence follows the name prefix, not the current client.
      const prefix = await this.displayPrefix(clientId);
      const used = this.fileRows
        .filter((row) => row.displayName.startsWith(prefix) && row.displayName.includes(`_${compact}_`))
        .map((row) => Number(row.displayName.slice(row.displayName.lastIndexOf("_") + 1)))
        .filter((value) => Number.isFinite(value));
      return Math.max(0, ...used) + 1;
    },
    insert: async (file: FileRecord): Promise<FileWriteResult> => {
      const conflict = this.fileConflict(file);
      if (conflict === "ok") {
        this.fileRows.push(copy(file));
      }
      return conflict;
    },
    update: async (file: FileRecord, expectedVersion: number): Promise<FileWriteResult> => {
      const index = this.fileRows.findIndex((row) => row.id === file.id);
      if (index < 0 || this.fileRows[index]?.version !== expectedVersion || this.purgingSince.has(file.id)) {
        return "stale";
      }
      const conflict = this.fileConflict(file);
      if (conflict === "ok") {
        this.fileRows[index] = copy(file);
      }
      return conflict;
    },
    summarizeForCase: async (caseId: Id): Promise<CaseFileSummary> => {
      const linked = this.fileRows.filter((row) => row.caseId === caseId && row.state !== "Trashed");
      const published = linked.filter((row) => row.direction === "Outbound" && row.state === "Published");
      return {
        outbound: linked.filter((row) => row.direction === "Outbound").length,
        published: published.length,
        publishedAndOpened: published.filter((row) => this.receiptRows.some((receipt) => receipt.fileId === row.id)).length,
        inbound: linked.filter((row) => row.direction === "Inbound").length,
      };
    },
    listTrashedBefore: async (threshold: Date, page: Page): Promise<FileRecord[]> =>
      paged(
        this.fileRows.filter((row) => this.isDue(row, threshold) && !this.purgingSince.has(row.id)),
        page,
      ),
    beginPurge: async (id: Id, trashedBefore: Date, at: Date): Promise<boolean> => {
      const row = this.fileRows.find((candidate) => candidate.id === id);
      if (row === undefined || !this.isDue(row, trashedBefore) || this.purgingSince.has(id)) {
        return false;
      }
      this.purgingSince.set(id, new Date(at.getTime()));
      this.receiptRows = this.receiptRows.filter((candidate) => candidate.fileId !== id);
      return true;
    },
    listPurging: async (page: Page): Promise<PendingPurge[]> =>
      paged(
        this.fileRows
          .filter((row) => this.purgingSince.has(row.id))
          .sort((a, b) => (this.purgingSince.get(a.id)?.getTime() ?? 0) - (this.purgingSince.get(b.id)?.getTime() ?? 0))
          .map((row) => ({ id: row.id, clientId: row.clientId, r2Key: row.r2Key })),
        page,
      ),
    completePurge: async (id: Id, audit: AuditEntry): Promise<boolean> => {
      if (!this.purgingSince.has(id) || !this.fileRows.some((candidate) => candidate.id === id)) {
        return false;
      }
      this.fileRows = this.fileRows.filter((candidate) => candidate.id !== id);
      this.receiptRows = this.receiptRows.filter((candidate) => candidate.fileId !== id);
      this.purgingSince.delete(id);
      this.auditRows.push(copy(audit));
      return true;
    },
    insertBatch: async (batch: UploadBatch): Promise<void> => {
      this.batchRows.push(copy(batch));
    },
    findBatch: async (id: Id): Promise<UploadBatch | null> => copy(this.batchRows.find((row) => row.id === id) ?? null),
  };

  receipts = {
    insertIfAbsent: async (receipt: FileReceipt): Promise<boolean> => {
      if (this.receiptRows.some((row) => row.fileId === receipt.fileId && row.userId === receipt.userId)) {
        return false;
      }
      this.receiptRows.push(copy(receipt));
      return true;
    },
    listByFile: async (fileId: Id): Promise<FileReceipt[]> => this.receiptRows.filter((row) => row.fileId === fileId).map(copy),
    listByFiles: async (fileIds: readonly Id[]): Promise<FileReceipt[]> =>
      this.receiptRows.filter((row) => fileIds.includes(row.fileId)).map(copy),
    hasOpened: async (fileId: Id, userId: Id): Promise<boolean> =>
      this.receiptRows.some((row) => row.fileId === fileId && row.userId === userId),
  };

  audit = {
    append: async (entry: AuditEntry): Promise<void> => {
      this.auditRows.push(copy(entry));
    },
    list: async (page: Page): Promise<AuditEntry[]> => paged([...this.auditRows].reverse(), page),
  };

  metrics = {
    append: async (event: MetricEvent): Promise<void> => {
      this.metricRows.push(copy(event));
    },
  };
}
