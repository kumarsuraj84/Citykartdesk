-- ROLLBACK for migration 158 (ticket row-security performance). Restores the previous policies and removes the added index. LOCAL; NOT run on production.

DROP INDEX IF EXISTS public.idx_requests_org_updated;

DROP POLICY IF EXISTS "requests_select" ON public.requests;
CREATE POLICY "requests_select" ON public.requests FOR SELECT
  USING (
    org_id = current_org_id()
    AND (
      requester_id = auth.uid()
      OR team_id = ANY (current_user_team_ids())
      OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
      OR is_request_collaborator(id)
      OR is_request_approver(id)
      OR requester_id = ANY (current_user_subordinate_ids())
      OR assigned_to = ANY (current_user_subordinate_ids())
    )
  );

DROP POLICY IF EXISTS "requests_update" ON public.requests;
CREATE POLICY "requests_update" ON public.requests FOR UPDATE
  USING (
    org_id = current_org_id()
    AND (team_id = ANY (current_user_team_ids()) OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
  )
  WITH CHECK (
    (org_id = (SELECT r.org_id FROM public.requests r WHERE r.id = requests.id))
    AND (team_id = ANY (current_user_team_ids()) OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
    AND (requester_id = (SELECT r.requester_id FROM public.requests r WHERE r.id = requests.id))
    AND (service_id = (SELECT r.service_id FROM public.requests r WHERE r.id = requests.id))
    AND (team_id = (SELECT r.team_id FROM public.requests r WHERE r.id = requests.id))
  );

DROP FUNCTION IF EXISTS public.request_identity_unchanged(uuid, uuid, uuid, uuid, uuid);

DROP FUNCTION IF EXISTS public.current_user_collab_request_ids();
DROP FUNCTION IF EXISTS public.current_user_approver_request_ids();
