-- ============================================================
-- MIGRATION: Phase 2 — Form Sections
-- ============================================================
-- Strategy: additive-only. New columns default to '[]' so all
-- existing services and requests continue to work unchanged.
-- Runtime code checks form_sections.length > 0 first; if empty,
-- falls back to the legacy form_fields / form_schema_snapshot path.
-- ============================================================

-- ── 1. Add form_sections to services ─────────────────────────────────────────
-- Stores the section-based form definition for new/migrated services.
-- Empty array = legacy mode (use form_fields instead).
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS form_sections JSONB NOT NULL DEFAULT '[]';

-- ── 2. Add form_sections_snapshot to requests ─────────────────────────────────
-- Snapshot of the service's form_sections at submission time, for immutable
-- historical display. Empty array = legacy request (use form_schema_snapshot).
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS form_sections_snapshot JSONB NOT NULL DEFAULT '[]';

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
-- GIN index on form_sections for future field-level search / admin queries.
CREATE INDEX IF NOT EXISTS idx_services_form_sections
  ON services USING GIN(form_sections);

-- ── 4. Grants ─────────────────────────────────────────────────────────────────
-- The columns inherit table-level grants; no additional grants required.
-- Included here as a documentation checkpoint — services and requests already
-- have anon/authenticated/service_role grants from prior migrations.
