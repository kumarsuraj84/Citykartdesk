-- ============================================================
-- MIGRATION: Pre-Sprint 3 Stabilization
-- ============================================================

-- ── is_internal enforcement: ALREADY PRESENT ─────────────────────────────────
-- The initial schema (20240101000000) already enforces at the DB layer:
--   is_internal = false
--   OR is_team_member(team_id)
--   OR current_user_role() IN ('manager', 'admin')
--
-- No change required. This comment documents the verification.

-- ── request_comments: tighten the INSERT policy to be explicit ───────────────
-- Re-apply the policy with the same semantics but explicit naming so the
-- intent is clear and survives future policy reviews.

DROP POLICY IF EXISTS "request_comments_insert" ON request_comments;

CREATE POLICY "request_comments_insert" ON request_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Author must be the caller
    author_id = auth.uid()
    -- Caller must have access to the parent request
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
        AND (
          r.requester_id = auth.uid()
          OR is_team_member(r.team_id)
          OR current_user_role() IN ('manager', 'admin')
        )
    )
    -- Internal notes are restricted to agents / managers
    AND (
      is_internal = false
      OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
      OR current_user_role() IN ('manager', 'admin')
    )
  );
