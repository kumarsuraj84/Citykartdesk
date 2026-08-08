-- Free-text space for links/inspiration/reference material captured at project
-- creation time (or added later) — separate from `description` so the summary
-- stays clean while reference material has its own place.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS reference_notes text;
