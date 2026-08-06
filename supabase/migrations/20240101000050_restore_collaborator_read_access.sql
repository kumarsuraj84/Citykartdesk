-- Re-enable collaborator READ access on requests (reverses the limitation from
-- migration 042) WITHOUT reintroducing the RLS recursion that 042 fixed.
--
-- Background (042): re-adding `OR is_request_collaborator(id)` to requests_select caused
-- a plan-time cycle (42P17) that broke every requests query, because the
-- request_collaborators policies (collab_insert from 009, collab_select from 016) each did
-- an inline `... FROM requests ...`, which re-triggers requests_select. PostgreSQL then
-- sees: requests_select -> is_request_collaborator -> request_collaborators policies ->
-- requests -> requests_select.
--
-- Fix (as prescribed in 042's own comment): move the request-access checks on the
-- request_collaborators policies into a SECURITY DEFINER helper that reads `requests` with
-- RLS bypassed, so those policies no longer reference `requests` inline. Then restoring the
-- collaborator clause on requests_select (via the existing SECURITY DEFINER
-- is_request_collaborator) is safe — the only cross-table links are opaque DEFINER calls.
--
-- Scope: CognixDesk-owned tables only.

-- 1. DEFINER helper: may the caller add/see collaborators on this request?
--    Reads requests with RLS bypassed → referencing it in collaborator policies does NOT
--    trigger requests_select. auth.uid() still resolves to the calling user.
CREATE OR REPLACE FUNCTION can_manage_collaborators(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = p_request_id
      AND r.org_id = current_org_id()
      AND (
        current_user_role() IN ('manager','admin')
        OR is_team_member(r.team_id)
      )
  )
$$;

GRANT EXECUTE ON FUNCTION can_manage_collaborators(UUID) TO authenticated;

-- 2. Rewrite collaborator INSERT to use the helper (no inline SELECT on requests).
DROP POLICY IF EXISTS "collab_insert" ON request_collaborators;
CREATE POLICY "collab_insert" ON request_collaborators
  FOR INSERT TO authenticated
  WITH CHECK ( can_manage_collaborators(request_id) );

-- 3. Rewrite collaborator SELECT to use the helper instead of the inline requests EXISTS
--    added in migration 016. (Self + adder + anyone who can manage the request's team.)
DROP POLICY IF EXISTS "collab_select" ON request_collaborators;
CREATE POLICY "collab_select" ON request_collaborators
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR added_by = auth.uid()
    OR can_manage_collaborators(request_id)
  );

-- collab_delete (added_by OR manager/admin) has no requests reference — left unchanged.

-- 4. Restore collaborator visibility on requests_select, preserving the migration-045
--    org-scoped + current_user_team_ids() structure.
DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (
    requester_id = auth.uid()
    OR team_id = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager','admin')
    OR is_request_collaborator(id)
  )
);
