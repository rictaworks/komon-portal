-- The office name shown in the sidebar (instructions.md 1.3: the Owner maintains the office settings).
-- NULL until the Owner sets it; the portal then says so instead of showing a default name.
ALTER TABLE office_setting ADD COLUMN office_name TEXT CHECK (office_name IS NULL OR length(office_name) BETWEEN 1 AND 100);
