-- Remediation phase 2 (LOCAL). Rollback: supabase/rollback/166_approvals_privacy_rollback.sql
--  VAPT-016  who added an approver is recorded (separation of duties: nobody adds themselves)
--  VAPT-015 / VAPT-019 (part)  approval routes, their steps and approvers are readable by staff, and by the people involved in an approval of a ticket they can see —
--                               not by every employee

BEGIN;

ALTER TABLE public.approval_workflow_steps ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- An ordinary employee (role "user") sees a workflow only through an approval that they are allowed to see (their own ticket's, or one they must decide).
-- The inner query on approvals is itself filtered by approvals_select, so it never reaches further than that.
DROP POLICY IF EXISTS workflows_select ON public.approval_workflows;
CREATE POLICY workflows_select ON public.approval_workflows FOR SELECT TO authenticated
  USING (
    org_id = public.current_org_id()
    AND (
      public.current_user_role() <> 'user'
      OR EXISTS (SELECT 1 FROM public.approvals a WHERE a.workflow_id = approval_workflows.id)
    )
  );

DROP POLICY IF EXISTS approval_workflow_steps_select ON public.approval_workflow_steps;
CREATE POLICY approval_workflow_steps_select ON public.approval_workflow_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.approval_workflows w WHERE w.id = approval_workflow_steps.workflow_id));

COMMIT;
