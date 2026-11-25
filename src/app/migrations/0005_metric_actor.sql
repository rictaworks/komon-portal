-- Who caused a measured event (instructions.md 1.12: weekly count of staff using the portal).
-- Only the kind and the internal user ID are kept. A person (staff or client member) always has
-- an ID; the scheduled jobs and events nobody identified caused have none. Events recorded before
-- this migration keep both columns empty.
ALTER TABLE metric_events ADD COLUMN actor_user_id TEXT REFERENCES users (id);
ALTER TABLE metric_events ADD COLUMN actor_kind TEXT CHECK (
  CASE
    WHEN actor_kind IS NULL OR actor_kind = 'system' THEN actor_user_id IS NULL
    WHEN actor_kind IN ('staff', 'member') THEN actor_user_id IS NOT NULL
    ELSE 0
  END
);
CREATE INDEX metric_events_occurred ON metric_events (occurred_at);
