-- Incident record (instructions.md, mis-delivery). A file withdrawn as a mis-delivery after a
-- client member opened it keeps who had it, why it was withdrawn and when, as they were at that
-- withdrawal. The file itself may later be assigned to the right client and published again, so
-- its own client_id, withdraw_reason and later receipts no longer describe the incident.
ALTER TABLE file_records ADD COLUMN incident_client_id TEXT REFERENCES clients (id);
ALTER TABLE file_records ADD COLUMN incident_reason TEXT CHECK (incident_reason IN ('WrongClient', 'WrongFile', 'Superseded', 'Other'));
ALTER TABLE file_records ADD COLUMN incident_at TEXT;
-- Incidents flagged before this migration: the client and reason the file has now, and the time
-- of its last recorded withdrawal. Where no withdrawal was recorded, the time of this migration,
-- so that every view recorded so far counts as it did before.
UPDATE file_records
SET incident_client_id = client_id,
    incident_reason = withdraw_reason,
    incident_at = COALESCE(
      (SELECT MAX(occurred_at) FROM audit_log WHERE action = 'file.withdraw' AND target_type = 'file' AND target_id = file_records.id AND result = 'ok'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
WHERE incident_flag = 1;
CREATE INDEX file_records_incident ON file_records (incident_at) WHERE incident_flag = 1;
