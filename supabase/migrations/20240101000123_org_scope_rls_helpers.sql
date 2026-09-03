-- is_request_approver()/is_agent() were org-unscoped SECURITY DEFINER
-- helpers used as unguarded top-level OR clauses in approvals_select and
-- comments_select — safe today only because application code always assigns
-- an org-scoped approver/team, with no DB constraint enforcing that
-- invariant. Hardening the functions themselves (rather than patching the
-- two call sites) closes the gap everywhere they're used, including future
-- policies that OR them in without remembering to add an org check.
CREATE OR REPLACE FUNCTION public.is_request_approver(p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM approvals a
    JOIN approval_workflow_steps aws ON aws.workflow_id = a.workflow_id
    JOIN requests r ON r.id = a.request_id
    WHERE a.request_id = p_request_id
      AND aws.approver_type = 'specific_user'
      AND aws.approver_user_id = auth.uid()
      AND r.org_id = current_org_id()
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_agent()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members WHERE user_id = auth.uid() AND org_id = current_org_id()
  )
$function$;
