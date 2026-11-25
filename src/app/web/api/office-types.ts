/** Shapes of the office API responses. */

export interface ClientRef {
  id: string;
  code: string;
  corporateName: string;
  status: "Active" | "Archived" | "Closed";
}

export interface DocTypeRef {
  id: string;
  shortCode: string;
  label: string;
}

export interface Reader {
  displayName: string | null;
  firstViewedAt: string;
}

export interface FileView {
  id: string;
  direction: "Outbound" | "Inbound";
  displayName: string;
  format: string;
  sizeBytes: number;
  state: string;
  client: ClientRef | null;
  caseId: string | null;
  docType: DocTypeRef | null;
  targetMonth: string | null;
  resolutionMethod: string | null;
  reviewReason: string | null;
  evidence: { kind: string; client: ClientRef | null }[];
  unmatchedArrivalNumber: string | null;
  typeSource: string | null;
  jev: { model: string; confidence: number | null; candidate: { id: string; shortCode: string } | null } | null;
  withdrawReason: string | null;
  incident: boolean;
  receivedAt: string;
  publishedAt: string | null;
  acknowledgedAt: string | null;
  trashedAt: string | null;
  /** The state the file had when it went to the trash. */
  trashedFrom: string | null;
  readers: Reader[];
  version: number;
}

export interface Deadline {
  level: "none" | "ok" | "caution" | "warning" | "expired";
  deadline: string | null;
  daysLeft: number | null;
}

export interface CaseView {
  id: string;
  client: ClientRef | null;
  caseType: { id: string; kind: "Procedure" | "Payroll" | "Other"; label: string } | null;
  targetMonth: string;
  sequence: number;
  referenceCode: string;
  assignee: { id: string; displayName: string | null } | null;
  dueOn: string | null;
  submittedOn: string | null;
  state: string;
  retrieval: Deadline;
  due: Deadline;
  arrivalNumbers?: string[];
  version: number;
}

/** The case list, with the active office users a case can be assigned to. */
export interface CaseList {
  items: CaseView[];
  /** True when more cases match than the requested page holds. */
  truncated: boolean;
  assignees: { id: string; displayName: string }[];
}

/** Mis-delivered files with their readers. `total` counts all of them; `truncated` says that more exist than `items` holds. */
export interface IncidentList {
  items: FileView[];
  total: number;
  truncated: boolean;
}

export interface Dashboard {
  today: string;
  /** The office time zone that `today` is counted in. */
  timezone: string;
  needsReview: number;
  staged: number;
  submitted: number;
  /** Submissions the office has not opened yet, newest first. */
  submissions: { id: string; displayName: string; receivedAt: string; client: ClientRef | null }[];
  unread: { id: string; displayName: string; publishedAt: string; client: ClientRef | null }[];
  /** True for a list when more items matched than are shown. */
  truncated: { unread: boolean; retrieval: boolean; due: boolean; submissions: boolean };
  retrieval: CaseView[];
  due: CaseView[];
  /** The most recent mis-deliveries. Null for Staff: only the Owner receives them. */
  incidents: IncidentList | null;
}

export interface ClientRecord {
  id: string;
  code: string;
  corporateName: string;
  corporateNumber: string | null;
  status: "Active" | "Archived" | "Closed";
  version: number;
}

/** A client in the list, with its member counts (`include=members`). */
export interface ClientListItem extends ClientRecord {
  members: { active: number; pending: number };
}

export interface InvitationView {
  id: string;
  targetType: "Office" | "Client";
  clientId: string | null;
  officeRole: "Owner" | "Staff" | null;
  expiresAt: string;
  status: string;
  code?: string;
}

export interface ClientMembers {
  members: { membershipId: string; displayName: string; status: string; redeemedAt: string | null; approvedAt: string | null }[];
  invitations: InvitationView[];
}

export interface StaffList {
  members: { userId: string; displayName: string; officeRole: "Owner" | "Staff" | null; officeStatus: string | null; redeemedAt: string | null }[];
  invitations: InvitationView[];
}

export interface OfficeSetting {
  timezone: string;
  arrivalNumberPattern: string;
  retrievalDeadlineDays: number;
  autoPublishEnabled: boolean;
  jevThreshold: number;
  version: number;
}

export interface DocTypeRecord extends DocTypeRef {
  direction: "Outbound" | "Inbound" | "Both";
}

export interface SettingsView {
  office: OfficeSetting;
  canEditOffice: boolean;
  docTypes: DocTypeRecord[];
  docRules: { id: string; docTypeId: string; keyword: string }[];
  caseTypes: { id: string; kind: "Procedure" | "Payroll" | "Other"; label: string }[];
  notifications: { pushConfigured: boolean };
}

export type IntakeResult =
  | { outcome: "stored"; published: boolean; file: FileView }
  | { outcome: "duplicate"; existing: FileView | null }
  | { outcome: "rejected"; reason: string };

export type PublishResult =
  | { fileId: string; outcome: "published"; clientId: string; warning?: string }
  | { fileId: string; outcome: "skipped"; reason: string };

export type ClassificationResult =
  | { fileId: string; outcome: "classified"; docTypeId: string; confidence: number }
  | { fileId: string; outcome: "below_threshold"; candidateDocTypeId: string; confidence: number }
  | { fileId: string; outcome: "skipped"; reason: string };

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  result: "ok" | "denied" | "failed";
  occurredAt: string;
}
