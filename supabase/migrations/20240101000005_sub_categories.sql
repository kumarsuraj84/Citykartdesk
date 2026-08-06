-- ============================================================
-- MIGRATION: Phase 3 — Service Sub-Categories
-- Information architecture only. No workflow changes.
-- ============================================================

-- ── 1. service_sub_categories table ──────────────────────────────────────────
-- Belongs to a category. Slug unique within a category (not globally).
-- Services reference sub-categories optionally — null = uncategorised.
CREATE TABLE IF NOT EXISTS service_sub_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID        NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Slug must be unique within a category (allows same slug in different categories)
  UNIQUE (category_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_sub_categories_category
  ON service_sub_categories(category_id)
  WHERE is_active = true;

-- ── 2. Add sub_category_id to services ───────────────────────────────────────
-- Nullable: services without a sub-category still work (uncategorised bucket).
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS sub_category_id UUID
  REFERENCES service_sub_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_sub_category
  ON services(sub_category_id)
  WHERE is_active = true AND sub_category_id IS NOT NULL;

-- ── 3. Add description to service_categories ─────────────────────────────────
-- Categories currently have no description; adding for richer category landing pages.
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ── 4. RLS — service_sub_categories ──────────────────────────────────────────
ALTER TABLE service_sub_categories ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read active sub-categories (public catalog)
CREATE POLICY "sub_categories_select" ON service_sub_categories
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Only admins can insert/update/delete (enforced additionally in server actions)
CREATE POLICY "sub_categories_admin_write" ON service_sub_categories
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── 5. Grants ─────────────────────────────────────────────────────────────────
GRANT ALL ON TABLE service_sub_categories TO anon, authenticated, service_role;
