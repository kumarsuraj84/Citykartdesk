-- RBAC gap: every SELECT policy in the Projects module (projects, project_members,
-- milestones, project_updates, project_activity) was scoped ONLY by org_id — any
-- authenticated user in the org could read every project, its membership list,
-- milestones, status updates, and activity log, regardless of whether they own,
-- are a member of, or are on the team for that project. Requests/Tasks/Approvals
-- already had real per-user/team scoping (see requests_select, tasks_select,
-- approvals_select) — Projects was simply never brought up to the same standard,
-- which is how the global search bar (querying these same tables) also leaked
-- every project org-wide to every user.

-- SECURITY DEFINER (bypasses RLS internally, same pattern as is_request_collaborator
-- and current_user_team_ids) so project_members_select can check membership without
-- the classic RLS-policy-references-its-own-table recursion problem.
CREATE OR REPLACE FUNCTION public.can_view_project(p_project_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.org_id = current_org_id()
      AND (
        p.owner_id = auth.uid()
        OR p.functional_owner_id = auth.uid()
        OR p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = auth.uid())
        OR (p.team_id IS NOT NULL AND p.team_id = ANY (current_user_team_ids()))
        OR current_user_role() IN ('manager', 'admin', 'platform_owner')
      )
  )
$$;

DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  org_id = current_org_id() AND can_view_project(id)
);

DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT USING (
  org_id = current_org_id() AND (user_id = auth.uid() OR can_view_project(project_id))
);

DROP POLICY IF EXISTS "milestones_select" ON milestones;
CREATE POLICY "milestones_select" ON milestones FOR SELECT USING (
  org_id = current_org_id() AND can_view_project(project_id)
);

DROP POLICY IF EXISTS "project_updates_select" ON project_updates;
CREATE POLICY "project_updates_select" ON project_updates FOR SELECT USING (
  org_id = current_org_id() AND can_view_project(project_id)
);

DROP POLICY IF EXISTS "project_activity_select" ON project_activity;
CREATE POLICY "project_activity_select" ON project_activity FOR SELECT USING (
  org_id = current_org_id() AND can_view_project(project_id)
);

NOTIFY pgrst, 'reload schema';
