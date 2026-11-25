/** Shapes of the client API responses used by the client screens. */

export interface DocTypeRef {
  id: string;
  shortCode: string;
  label: string;
}

export interface ClientDocument {
  id: string;
  displayName: string;
  format: string;
  sizeBytes: number;
  docType: DocTypeRef | null;
  targetMonth: string | null;
  publishedAt: string | null;
  opened: boolean;
}

export interface ClientCase {
  id: string;
  kind: "Procedure" | "Payroll" | "Other";
  typeLabel: string;
  targetMonth: string;
  state: string;
}

export interface ClientHome {
  unread: ClientDocument[];
  cases: ClientCase[];
  truncated: { documents: boolean; cases: boolean };
}

export interface Submission {
  id: string;
  displayName: string;
  format: string;
  sizeBytes: number;
  docType: DocTypeRef | null;
  targetMonth: string | null;
  state: string;
  submittedAt: string;
  acknowledgedAt: string | null;
  canCancel: boolean;
  version: number;
}

export interface DocTypes {
  outbound: DocTypeRef[];
  inbound: DocTypeRef[];
}

export interface NotificationStatus {
  available: boolean;
  vapidPublicKey: string | null;
  subscriptions: number;
}

/** Result of a send: the server answers 200 with an outcome, and a rejected or duplicate file is not stored. */
export interface SendResult {
  outcome: "stored" | "duplicate" | "rejected";
  reason?: string;
}
