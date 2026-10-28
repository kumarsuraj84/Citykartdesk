-- ============================================================
-- Intake Intelligence — F2: catalog-bound classification
-- ============================================================
-- The engine now resolves a real service from the org's catalog (matching the
-- email against services.keywords within the suggested category) and stores it on
-- the review, so conversion reuses the SAME hierarchy a human uses:
--   service → team_id, default_priority, form_fields.
-- These are SUGGESTIONS that pre-fill the review UI; the reviewer can override.
-- Worker writes them via service-role (bypasses RLS); reviewers already SELECT.

ALTER TABLE intake_reviews
  ADD COLUMN IF NOT EXISTS suggested_service_id  UUID REFERENCES services(id)           ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_team_id     UUID REFERENCES teams(id)              ON DELETE SET NULL;
