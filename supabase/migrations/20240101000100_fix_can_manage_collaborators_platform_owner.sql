-- can_manage_collaborators() gated collaborator add/remove on
-- current_user_role() IN ('manager','admin') — omitting 'platform_owner',
-- even though every JS-level authorization check for this same feature
-- (addCollaborator/removeCollaborator in lib/actions/requests.ts) already
-- treats platform_owner as equal-or-greater privilege than admin/manager,
-- matching the pattern used everywhere else in the app. The mismatch meant
-- a platform_owner who isn't also a member of the request's team passed the
-- JS check but was silently rejected by RLS on the actual INSERT/DELETE —
-- exactly the "can't add or remove a collaborator" symptom reported.

CREATE OR REPLACE FUNCTION public.can_manage_collaborators(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = p_request_id
      AND r.org_id = current_org_id()
      AND (
        current_user_role() IN ('manager','admin','platform_owner')
        OR is_team_member(r.team_id)
      )
  )
$function$;

NOTIFY pgrst, 'reload schema';
