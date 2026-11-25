/** Entity and value types of the Domain Core. Pure data, no behaviour. */

export type Id = string;
/** Calendar day in the office time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;
/** Month formatted YYYY-MM. */
export type YearMonth = string;

export const OFFICE_ROLES = ["Owner", "Staff"] as const;
export type OfficeRole = (typeof OFFICE_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["Pending", "Active", "Revoked", "Rejected"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const CLIENT_STATUSES = ["Active", "Archived", "Closed"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const INVITATION_STATUSES = ["Issued", "Redeemed", "Cancelled", "Expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_TARGETS = ["Office", "Client"] as const;
export type InvitationTarget = (typeof INVITATION_TARGETS)[number];

export const CASE_KINDS = ["Procedure", "Payroll", "Other"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const CASE_STATES = [
  "Open",
  "Submitted",
  "MaterialsReceived",
  "DocumentReceived",
  "Delivered",
  "Confirmed",
  "Closed",
  "Cancelled",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const FILE_DIRECTIONS = ["Outbound", "Inbound"] as const;
export type FileDirection = (typeof FILE_DIRECTIONS)[number];

export const DOC_TYPE_DIRECTIONS = ["Outbound", "Inbound", "Both"] as const;
export type DocTypeDirection = (typeof DOC_TYPE_DIRECTIONS)[number];

export const FILE_STATES = [
  "Staged",
  "NeedsReview",
  "Published",
  "Withdrawn",
  "Submitted",
  "Acknowledged",
  "Trashed",
] as const;
export type FileState = (typeof FILE_STATES)[number];

export const RESOLUTION_METHODS = ["ArrivalNumber", "ClientCode", "CorporateNumber", "StaffSelected"] as const;
export type ResolutionMethod = (typeof RESOLUTION_METHODS)[number];

export const REVIEW_REASONS = [
  "ConflictingKeys",
  "MultipleArrivalNumbers",
  "NoKey",
  "HintMismatch",
  "ClientNotActive",
  "CaseCancelled",
  "DuplicateAcrossClients",
  "Withdrawn",
  "Restored",
  "SentBack",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Reasons that require an explicit confirmation before a file can be staged. */
export const CONFIRMATION_REQUIRED_REASONS: readonly ReviewReason[] = [
  "DuplicateAcrossClients",
  "ConflictingKeys",
  "HintMismatch",
];

export const WITHDRAW_REASONS = ["WrongClient", "WrongFile", "Superseded", "Other"] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

/** Withdraw reasons that mark a mis-delivery when the file had already been opened. */
export const INCIDENT_WITHDRAW_REASONS: readonly WithdrawReason[] = ["WrongClient", "WrongFile"];

export const TYPE_SOURCES = ["Rule", "Jev", "Staff"] as const;
export type TypeSource = (typeof TYPE_SOURCES)[number];

export const FILE_FORMATS = ["pdf", "zip", "xml", "csv", "xlsx", "docx", "txt", "png", "jpeg"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const REJECTION_REASONS = ["Empty", "TooLarge", "UnsupportedFormat", "ContentMismatch"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface OfficeSetting {
  timezone: string;
  arrivalNumberPattern: string;
  retrievalDeadlineDays: number;
  autoPublishEnabled: boolean;
  jevThreshold: number;
  version: number;
}

export interface User {
  id: Id;
  googleSub: string;
  displayName: string;
  officeRole: OfficeRole | null;
  /** Status of the office membership. Null when the user has never been invited to the office. */
  officeStatus: MembershipStatus | null;
  createdAt: Date;
}

export interface Client {
  id: Id;
  code: string;
  corporateName: string;
  corporateNumber: string | null;
  status: ClientStatus;
  version: number;
}

export interface Membership {
  id: Id;
  userId: Id;
  clientId: Id;
  status: MembershipStatus;
  approvedBy: Id | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface Invitation {
  id: Id;
  codeHash: string;
  targetType: InvitationTarget;
  clientId: Id | null;
  /** Role granted on approval. Null for client invitations. */
  officeRole: OfficeRole | null;
  issuedBy: Id;
  expiresAt: Date;
  status: InvitationStatus;
  redeemedBy: Id | null;
  redeemedAt: Date | null;
  createdAt: Date;
}

export interface CaseType {
  id: Id;
  kind: CaseKind;
  label: string;
}

export interface CaseRecord {
  id: Id;
  clientId: Id;
  caseTypeId: Id;
  targetMonth: YearMonth;
  sequence: number;
  referenceCode: string;
  assigneeId: Id | null;
  dueOn: LocalDate | null;
  submittedOn: LocalDate | null;
  state: CaseState;
  version: number;
  createdAt: Date;
}

export interface CaseArrival {
  id: Id;
  caseId: Id;
  arrivalNumber: string;
}

export interface DocType {
  id: Id;
  label: string;
  shortCode: string;
  direction: DocTypeDirection;
  /** The monthly (Payroll) case type a client submission of this document type belongs to; null when it is never linked automatically. */
  caseTypeId: Id | null;
}

export interface DocRule {
  id: Id;
  docTypeId: Id;
  keyword: string;
}

export interface UploadBatch {
  id: Id;
  uploadedBy: Id;
  hintClientId: Id | null;
  createdAt: Date;
}

export interface FileRecord {
  id: Id;
  batchId: Id;
  direction: FileDirection;
  clientId: Id | null;
  caseId: Id | null;
  docTypeId: Id | null;
  targetMonth: YearMonth | null;
  displayName: string;
  format: FileFormat;
  sha256: string;
  sizeBytes: number;
  r2Key: string;
  state: FileState;
  /** State to return to when a trashed file is restored. */
  trashedFrom: FileState | null;
  resolutionMethod: ResolutionMethod | null;
  reviewReason: ReviewReason | null;
  /** What pointed where when the file was sent to review. */
  reviewDetail: KeyEvidence[] | null;
  /** Arrival number that matched the pattern but no registered case. */
  unmatchedArrivalNumber: string | null;
  typeSource: TypeSource | null;
  jevModel: string | null;
  jevConfidence: number | null;
  jevCandidateDocTypeId: Id | null;
  withdrawReason: WithdrawReason | null;
  incidentFlag: boolean;
  /**
   * The mis-delivery as it was at the withdrawal that raised it: the client that had the file,
   * the reason given and the time. A later assignment or publication does not change them.
   * All three are null while `incidentFlag` is false.
   */
  incidentClientId: Id | null;
  incidentReason: WithdrawReason | null;
  incidentAt: Date | null;
  receivedAt: Date;
  publishedAt: Date | null;
  acknowledgedAt: Date | null;
  trashedAt: Date | null;
  version: number;
}

/**
 * A file being purged: its 30 days in the trash have passed and its stored body is being removed.
 * Its record is kept, hidden from every other read, until the body is gone.
 */
export interface PendingPurge {
  id: Id;
  clientId: Id | null;
  r2Key: string;
}

export const EVIDENCE_KINDS = ["ArrivalNumber", "ClientCode", "CorporateNumber", "StaffSelected", "ExistingCopy"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** One clue that pointed to a client. Internal IDs only, so it is safe to store and show to staff. */
export interface KeyEvidence {
  kind: EvidenceKind;
  clientId: Id;
}

export interface FileReceipt {
  id: Id;
  fileId: Id;
  userId: Id;
  firstViewedAt: Date;
}

export interface AuditEntry {
  id: Id;
  /** Null for the scheduled system actor. */
  actorUserId: Id | null;
  action: string;
  targetType: string;
  targetId: string;
  result: "ok" | "denied" | "failed";
  occurredAt: Date;
}

export interface MetricEvent {
  id: Id;
  name: string;
  clientId: Id | null;
  attributes: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}
