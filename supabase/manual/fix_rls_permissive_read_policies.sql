-- Fix cross-org RLS leak from leftover permissive SELECT policies.
--
-- The initial schema created "<table>_read ... USING (true)" SELECT policies.
-- Migrations 033/036 later added org-scoped SELECT policies under NEW names
-- (profiles_select, dept_select, team_members_select, workflows_select, ...)
-- but never dropped the original "_read" policies. Postgres combines permissive
-- policies with OR, so "USING (true)" silently defeated all org isolation on
-- these tables — every authenticated user could read every org's rows.
--
-- This drops the stale permissive policies. Each table either already has an
-- org-scoped replacement (noted below) or gets one created here first.
--
-- Apply against the CognixDesk Supabase project (jhdzjzrimjjtqwnkrwha).

-- profiles  → replaced by profiles_select (033): org_id = current_org_id() OR id = auth.uid()
DROP POLICY IF EXISTS "profiles_read" ON profiles;

-- departments → replaced by dept_select (033): org_id = current_org_id()
DROP POLICY IF EXISTS "departments_read" ON departments;

-- team_members → replaced by team_members_select (036): org_id = current_org_id()
DROP POLICY IF EXISTS "team_members_read" ON team_members;

-- approval_workflows → replaced by workflows_select (033): org_id = current_org_id()
DROP POLICY IF EXISTS "approval_workflows_read" ON approval_workflows;

-- teams → had NO org-scoped SELECT policy. Create one, then drop the permissive.
DROP POLICY IF EXISTS "teams_select" ON teams;
CREATE POLICY "teams_select" ON teams FOR SELECT USING (org_id = current_org_id());
DROP POLICY IF EXISTS "teams_read" ON teams;

-- approval_workflow_steps → no org_id column; scope via the parent workflow.
DROP POLICY IF EXISTS "workflow_steps_select" ON approval_workflow_steps;
CREATE POLICY "workflow_steps_select" ON approval_workflow_steps FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM approval_workflows w
    WHERE w.id = workflow_id AND w.org_id = current_org_id()
  )
);
DROP POLICY IF EXISTS "approval_workflow_steps_read" ON approval_workflow_steps;

-- app_settings → intentionally global app config (no org_id); left as-is.
