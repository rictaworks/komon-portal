-- Looks up the latest activation of each office member by its target (approvals and setup).
CREATE INDEX audit_log_target ON audit_log (target_type, target_id);
