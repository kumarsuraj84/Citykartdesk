-- Grant an ad-hoc approval's assigned approver read access to the request
-- they were asked to approve, its approval record, and its conversation —
-- even when they are not the requester, not on the request's team, and not
-- a manager/admin.
--
-- Background: sendAdHocApproval() (lib/actions/approvals.ts) can send a
-- request to ANY active org user via approval_workflow_steps
-- (approver_type = 'specific_user'), not just managers or the request's own
-- team. But requests_select/approvals_select/comments_select never granted
-- that approver visibility, so:
--   - the full request page 404s for them (requests_select denies the row),
--   - the notification-bell preview's getApprovalForRequestAction() finds no
--     approval (approvals_select denies the row) and reports "no longer
--     available" even though a real pending approval exists,
--   - and /approvals is manager-gated, so there's no other path in.
-- Net effect: a non-manager, non-team-member specific-user approver has no
-- way whatsoever to see or act on an approval assigned to them.
--
-- Fix follows the exact precedent set by is_request_collaborator (009, then
-- 050 after the 042 recursion fix): an opaque SECURITY DEFINER helper that
-- reads approvals/approval_workflow_steps with RLS bypassed, so referencing
-- it from requests_select/approvals_select/comments_select cannot re-trigger
-- those same policies (no plan-time cycle, unlike an inline correlated
-- subquery would cause).

CREATE OR REPLACE FUNCTION is_request_approver(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM approvals a
    JOIN approval_workflow_steps aws ON aws.workflow_id = a.workflow_id
    WHERE a.request_id = p_request_id
      AND aws.approver_type = 'specific_user'
      AND aws.approver_user_id = auth.uid()
  )
$$;

GRANT EXECUTE ON FUNCTION is_request_approver(UUID) TO authenticated;

-- requests_select: add approver visibility (preserves 050's org + team +
-- collaborator structure). Role check must include platform_owner, same as
-- every other manager-tier check in this policy set (approvals_select below
-- already does) — dropping it here would regress Owner's org-wide visibility.
DROP POLICY IF EXISTS "requests_select" ON requests;
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  org_id = current_org_id()
  AND (
    requester_id = auth.uid()
    OR team_id = ANY(current_user_team_ids())
    OR current_user_role() IN ('manager','admin','platform_owner')
    OR is_request_collaborator(id)
    OR is_request_approver(id)
  )
);

-- approvals_select: same addition (preserves 080's org + team + manager
-- structure).
DROP POLICY IF EXISTS "approvals_select" ON approvals;
CREATE POLICY "approvals_select" ON approvals FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_id
      AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY(current_user_team_ids())
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
  OR is_request_approver(request_id)
);

-- comments_select: same addition, and the manager-tier checks include
-- platform_owner (same fix as requests_select above — a bare 'manager','admin'
-- list would regress Owner's ability to see requests/internal notes org-wide).
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
