-- Case type of a document type (instructions.md 1.6.7). A client submission is linked automatically
-- to the open case of its client and target month whose case type is the one named here, when exactly
-- one such case exists. A document type without a case type is never linked automatically.
ALTER TABLE doc_types ADD COLUMN case_type_id TEXT REFERENCES case_types (id);
