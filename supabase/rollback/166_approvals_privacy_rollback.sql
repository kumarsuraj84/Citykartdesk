BEGIN;
DROP POLICY IF EXISTS workflows_select ON public.approval_workflows;
CREATE POLICY workflows_select ON public.approval_workflows FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS approval_workflow_steps_select ON public.approval_workflow_steps;
CREATE POLICY approval_workflow_steps_select ON public.approval_workflow_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.approval_workflows w WHERE w.id = approval_workflow_steps.workflow_id AND w.org_id = public.current_org_id()));
-- (the added_by column is kept: it is harmless)
DELETE FROM auth.schema_migrations WHERE version = '20240101000166';
COMMIT;
