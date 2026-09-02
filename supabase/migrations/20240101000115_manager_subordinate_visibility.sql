-- A manager can see every request their direct reports are involved in —
-- both ones a subordinate raised as a requester, and ones assigned to a
-- subordinate technician — regardless of whether the manager shares a Team
-- with them. This is org-chart visibility (profiles.manager_id), a separate
-- concept from Team-based visibility (current_user_team_ids()): a manager
-- might oversee people spread across several teams, or people not on any
-- team at all.
--
-- Read-only: this grants visibility only, not any operational authority
-- (assigning, changing status, etc. still follow the existing team/role
-- checks in the server actions, untouched here).

CREATE OR REPLACE FUNCTION current_user_subordinate_ids()
RETURNS UUID[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY_AGG(p.id)
  FROM profiles p
  WHERE p.manager_id = auth.uid()
    AND p.org_id = current_org_id()
$$;

GRANT EXECUTE ON FUNCTION current_user_subordinate_ids() TO authenticated;

-- requests_select: add subordinate visibility (preserves 113's org + team +
-- role + collaborator + approver structure).
DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (
    requester_id = auth.uid()
    OR team_id = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager','admin','platform_owner')
    OR is_request_collaborator(id)
    OR is_request_approver(id)
    OR requester_id = ANY(current_user_subordinate_ids())
    OR assigned_to = ANY(current_user_subordinate_ids())
  )
);

-- comments_select: same addition — a manager who can see the request via the
-- subordinate clause above should be able to read its conversation too, not
-- just see it listed. Internal-note gate is untouched (a subordinate's
-- manager isn't automatically an agent).
DROP POLICY IF EXISTS "comments_select" ON request_comments;
CREATE POLICY "comments_select" ON request_comments FOR SELECT USING (
  (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE  r.id = request_id
        AND  r.org_id = current_org_id()
        AND (
          r.requester_id = auth.uid()
          OR r.team_id   = ANY(current_user_team_ids())
          OR current_user_role() IN ('manager','admin','platform_owner')
          OR r.requester_id = ANY(current_user_subordinate_ids())
          OR r.assigned_to  = ANY(current_user_subordinate_ids())
        )
    )
    OR is_request_approver(request_id)
  )
  AND (
    NOT is_internal
    OR is_agent()
    OR current_user_role() IN ('manager','admin','platform_owner')
  )
);
