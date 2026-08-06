-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036 — Phase 1: Pilot Readiness (continued)
-- Depends on migration 035 having committed the agent + platform_owner enum values.
-- • Assigns platform_owner role to the founding admin of the owner org
-- • Adds org_id FK to team_members (explicit org isolation)
-- • Hardens is_team_member() with an explicit org check
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add org_id FK to team_members ────────────────────────────────────────────
-- NOTE: The platform_owner role assignment for the founding admin is handled
-- in seed.sql for local dev and in the provisionOrg() action for production.

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 3. Backfill org_id from the parent teams row ────────────────────────────────

UPDATE team_members tm
SET org_id = t.org_id
FROM teams t
WHERE tm.team_id = t.id
  AND tm.org_id IS NULL;

-- 4. Enforce NOT NULL now that every row has a value ──────────────────────────

ALTER TABLE team_members ALTER COLUMN org_id SET NOT NULL;

-- 5. Index for fast org-scoped lookups ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_team_members_org ON team_members(org_id);

-- 6. Replace RLS policies on team_members with org-explicit versions ───────────

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_members_select" ON team_members;
CREATE POLICY "team_members_select" ON team_members FOR SELECT USING (
  org_id = current_org_id()
);

DROP POLICY IF EXISTS "team_members_insert" ON team_members;
CREATE POLICY "team_members_insert" ON team_members FOR INSERT WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);

DROP POLICY IF EXISTS "team_members_delete" ON team_members;
CREATE POLICY "team_members_delete" ON team_members FOR DELETE USING (
  org_id = current_org_id()
  AND current_user_role() IN ('manager', 'admin', 'platform_owner')
);

-- 7. Harden is_team_member() — add explicit org check ─────────────────────────

CREATE OR REPLACE FUNCTION is_team_member(p_team_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
      AND t.org_id   = current_org_id()
  )
$$;

-- 8. Ensure service_role access is preserved ──────────────────────────────────

GRANT ALL ON team_members TO service_role;
