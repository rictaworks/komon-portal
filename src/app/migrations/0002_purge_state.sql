-- Purge state (instructions.md 1.6.8). A trashed file whose 30 days have passed is first marked
-- as being purged, then its stored body is removed, and only then is the record erased. If the
-- body cannot be removed the marked record remains, so the next daily run finds it and tries again.
-- A file being purged can no longer leave the trash.
ALTER TABLE file_records ADD COLUMN purging_at TEXT CHECK (purging_at IS NULL OR state = 'Trashed');
CREATE INDEX file_records_purging ON file_records (purging_at) WHERE purging_at IS NOT NULL;
