-- RLS Performance Optimization
--
-- Problem: requests_select and tasks_select call is_team_member(team_id) once per
-- evaluated row. is_team_member performs a team_members JOIN teams subquery each
-- time — it varies by the row's team_id, so PostgreSQL cannot cache it.
-- On a 25-row list this is 25 separate subqueries.
--
-- Also fixes STEP 1 security regression: migration _042 dropped the
-- org_id = current_org_id() guard from requests_select when fixing the RLS
-- recursion. A manager/admin with no org isolation could read requests from
-- other tenants. Restored here.
--
-- Solution:
--   1. Add current_user_team_ids() — returns UUID[] of all teams the caller
--      belongs to. It is STABLE with no row-varying arguments, so PostgreSQL
--      evaluates it ONCE per statement and reuses the result for every row.
--   2. Replace is_team_member(team_id) with team_id = ANY(current_user_team_ids())
--      in requests_select, tasks_select, and comments_select.
--
-- Execution path change:
--   Before: SELECT from requests (25 rows) → 25 × (team_members JOIN teams)
--   After:  SELECT from requests (25 rows) → 1 × (team_members JOIN teams)  [cached]

-- ── 1. current_user_team_ids() ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_team_ids()
RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT ARRAY_AGG(tm.team_id)
  FROM   team_members tm
  JOIN   teams t ON t.id = tm.team_id
  WHERE  tm.user_id = auth.uid()
    AND  t.org_id   = current_org_id()
$$;

-- ── 2. requests_select — org isolation restored + per-row JOIN eliminated ───────

DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (
    requester_id = auth.uid()
    OR team_id   = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager','admin')
  )
);

-- ── 3. tasks_select — same treatment ───────────────────────────────────────────

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT USING (
  org_id = current_org_id()
  AND (
    created_by  = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND team_id = ANY(current_user_team_ids()))
    OR current_user_role() IN ('manager','admin')
  )
);

-- ── 4. comments_select — flatten triple-nested subquery ─────────────────────────
-- Previous policy nested is_team_member + current_user_role + is_request_collaborator
-- inside an EXISTS(requests) subquery — evaluated per comment row.
-- New version mirrors requests_select logic directly.

DROP POLICY IF EXISTS "comments_select" ON request_comments;
CREATE POLICY "comments_select" ON request_comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE  r.id = request_id
      AND  r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id   = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager','admin')
      )
  )
  AND (
    NOT is_internal
    OR is_agent()
    OR current_user_role() IN ('manager','admin')
  )
);

-- Grant execute on new helper
GRANT EXECUTE ON FUNCTION current_user_team_ids() TO authenticated;
