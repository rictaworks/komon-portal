-- komon-portal initial schema. Timestamps are ISO-8601 UTC text, dates are YYYY-MM-DD in the office time zone.
-- No column stores an email address, an original file name or an IP address.

CREATE TABLE office_setting (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL,
  arrival_number_pattern TEXT NOT NULL,
  retrieval_deadline_days INTEGER NOT NULL CHECK (retrieval_deadline_days > 0),
  auto_publish_enabled INTEGER NOT NULL CHECK (auto_publish_enabled IN (0, 1)),
  jev_threshold REAL NOT NULL CHECK (jev_threshold >= 0.8 AND jev_threshold <= 1),
  version INTEGER NOT NULL
);

INSERT INTO office_setting (id, timezone, arrival_number_pattern, retrieval_deadline_days, auto_publish_enabled, jev_threshold, version)
VALUES (1, 'Asia/Tokyo', '[0-9]{17,18}', 90, 0, 0.9, 1);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  office_role TEXT CHECK (office_role IN ('Owner', 'Staff')),
  office_status TEXT CHECK (office_status IN ('Pending', 'Active', 'Revoked', 'Rejected')),
  created_at TEXT NOT NULL,
  CHECK ((office_role IS NULL) = (office_status IS NULL))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 32 AND code NOT GLOB '*[^A-Za-z0-9]*'),
  corporate_name TEXT NOT NULL,
  corporate_number TEXT CHECK (corporate_number IS NULL OR (length(corporate_number) = 13 AND corporate_number NOT GLOB '*[^0-9]*')),
  status TEXT NOT NULL CHECK (status IN ('Active', 'Archived', 'Closed')),
  version INTEGER NOT NULL
);
CREATE INDEX clients_corporate_number ON clients (corporate_number);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  client_id TEXT NOT NULL REFERENCES clients (id),
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Active', 'Revoked', 'Rejected')),
  approved_by TEXT REFERENCES users (id),
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX memberships_ongoing ON memberships (user_id, client_id) WHERE status IN ('Pending', 'Active');
CREATE INDEX memberships_client ON memberships (client_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL CHECK (target_type IN ('Office', 'Client')),
  client_id TEXT REFERENCES clients (id),
  office_role TEXT CHECK (office_role IN ('Owner', 'Staff')),
  issued_by TEXT NOT NULL REFERENCES users (id),
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Issued', 'Redeemed', 'Cancelled', 'Expired')),
  redeemed_by TEXT REFERENCES users (id),
  redeemed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (target_type = 'Client' AND client_id IS NOT NULL AND office_role IS NULL)
    OR (target_type = 'Office' AND client_id IS NULL AND office_role IS NOT NULL)
  )
);
CREATE INDEX invitations_status ON invitations (status, expires_at);

CREATE TABLE case_types (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('Procedure', 'Payroll', 'Other')),
  label TEXT NOT NULL
);

CREATE TABLE case_records (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients (id),
  case_type_id TEXT NOT NULL REFERENCES case_types (id),
  target_month TEXT NOT NULL CHECK (target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  reference_code TEXT NOT NULL CHECK (length(reference_code) BETWEEN 1 AND 64 AND reference_code NOT GLOB '*[^A-Za-z0-9-]*'),
  assignee_id TEXT REFERENCES users (id),
  due_on TEXT,
  submitted_on TEXT,
  state TEXT NOT NULL CHECK (state IN ('Open', 'Submitted', 'MaterialsReceived', 'DocumentReceived', 'Delivered', 'Confirmed', 'Closed', 'Cancelled')),
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (client_id, case_type_id, target_month, sequence)
);
CREATE INDEX case_records_client ON case_records (client_id);
CREATE INDEX case_records_state ON case_records (state);

CREATE TABLE case_arrivals (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES case_records (id),
  arrival_number TEXT NOT NULL UNIQUE
);
CREATE INDEX case_arrivals_case ON case_arrivals (case_id);

CREATE TABLE doc_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE CHECK (length(short_code) BETWEEN 1 AND 16 AND short_code NOT GLOB '*[^A-Z0-9]*'),
  direction TEXT NOT NULL CHECK (direction IN ('Outbound', 'Inbound', 'Both'))
);

CREATE TABLE doc_rules (
  id TEXT PRIMARY KEY,
  doc_type_id TEXT NOT NULL REFERENCES doc_types (id) ON DELETE CASCADE,
  keyword TEXT NOT NULL CHECK (length(keyword) > 0)
);
CREATE INDEX doc_rules_type ON doc_rules (doc_type_id);

CREATE TABLE upload_batches (
  id TEXT PRIMARY KEY,
  uploaded_by TEXT NOT NULL REFERENCES users (id),
  hint_client_id TEXT REFERENCES clients (id),
  created_at TEXT NOT NULL
);

CREATE TABLE file_records (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES upload_batches (id),
  direction TEXT NOT NULL CHECK (direction IN ('Outbound', 'Inbound')),
  client_id TEXT REFERENCES clients (id),
  case_id TEXT REFERENCES case_records (id),
  doc_type_id TEXT REFERENCES doc_types (id),
  target_month TEXT CHECK (target_month IS NULL OR target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  display_name TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'zip', 'xml', 'csv', 'xlsx', 'docx', 'txt', 'png', 'jpeg')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  r2_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('Staged', 'NeedsReview', 'Published', 'Withdrawn', 'Submitted', 'Acknowledged', 'Trashed')),
  trashed_from TEXT CHECK (trashed_from IN ('Staged', 'NeedsReview', 'Withdrawn', 'Submitted', 'Acknowledged')),
  resolution_method TEXT CHECK (resolution_method IN ('ArrivalNumber', 'ClientCode', 'CorporateNumber', 'StaffSelected')),
  review_reason TEXT CHECK (review_reason IN ('ConflictingKeys', 'MultipleArrivalNumbers', 'NoKey', 'HintMismatch', 'ClientNotActive', 'CaseCancelled', 'DuplicateAcrossClients', 'Withdrawn', 'Restored', 'SentBack')),
  unmatched_arrival_number TEXT,
  type_source TEXT CHECK (type_source IN ('Rule', 'Jev', 'Staff')),
  jev_model TEXT,
  jev_confidence REAL CHECK (jev_confidence IS NULL OR (jev_confidence >= 0 AND jev_confidence <= 1)),
  jev_candidate_doc_type_id TEXT REFERENCES doc_types (id),
  withdraw_reason TEXT CHECK (withdraw_reason IN ('WrongClient', 'WrongFile', 'Superseded', 'Other')),
  incident_flag INTEGER NOT NULL DEFAULT 0 CHECK (incident_flag IN (0, 1)),
  received_at TEXT NOT NULL,
  published_at TEXT,
  acknowledged_at TEXT,
  trashed_at TEXT,
  version INTEGER NOT NULL,
  CHECK (
    (direction = 'Outbound' AND state IN ('Staged', 'NeedsReview', 'Published', 'Withdrawn', 'Trashed'))
    OR (direction = 'Inbound' AND state IN ('Submitted', 'Acknowledged', 'Trashed'))
  ),
  CHECK (state NOT IN ('Staged', 'Published', 'Withdrawn', 'Submitted', 'Acknowledged') OR client_id IS NOT NULL),
  CHECK ((state = 'Trashed') = (trashed_at IS NOT NULL)),
  CHECK ((state = 'Trashed') = (trashed_from IS NOT NULL)),
  CHECK (state <> 'NeedsReview' OR review_reason IS NOT NULL),
  CHECK (state <> 'Published' OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX file_records_client_content ON file_records (client_id, sha256) WHERE state <> 'Trashed' AND client_id IS NOT NULL;
CREATE INDEX file_records_state ON file_records (state, direction);
CREATE INDEX file_records_client_state ON file_records (client_id, state);
CREATE INDEX file_records_case ON file_records (case_id);
CREATE INDEX file_records_sha ON file_records (sha256);
CREATE INDEX file_records_trashed ON file_records (trashed_at);

CREATE TABLE file_receipts (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES file_records (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  first_viewed_at TEXT NOT NULL,
  UNIQUE (file_id, user_id)
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ok', 'denied', 'failed')),
  occurred_at TEXT NOT NULL
);
CREATE INDEX audit_log_occurred ON audit_log (occurred_at);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE metric_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT,
  attributes TEXT NOT NULL CHECK (json_valid(attributes)),
  occurred_at TEXT NOT NULL
);
CREATE INDEX metric_events_name ON metric_events (name, occurred_at);
