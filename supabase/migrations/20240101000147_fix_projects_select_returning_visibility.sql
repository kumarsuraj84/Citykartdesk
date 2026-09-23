-- Bug found during the local audit completion pass: creating a project has
-- been silently broken for EVERY role since 20240101000104 tightened
-- projects_select to `can_view_project(id)`. createProject() (and the CSV
-- bulk-import path) both do `.insert(...).select('id').single()` --
-- PostgREST's "return=representation", i.e. INSERT ... RETURNING. Postgres
-- requires a row returned by RETURNING to also satisfy the table's SELECT
-- policy, and can_view_project() checks visibility by re-querying `projects
-- p WHERE p.id = p_project_id` -- an independent lookup of the SAME table
-- for the SAME row the INSERT just produced, within the SAME command. Under
-- normal MVCC command-visibility rules a statement's own nested subqueries
-- cannot see rows it only just inserted (they only become visible to a
-- LATER command in the transaction), so can_view_project(id) always
-- evaluates false for a brand-new row, regardless of role or ownership --
-- the INSERT itself succeeds but RETURNING is then rejected, which
-- supabase-js/PostgREST surfaces as a generic 42501 "permission" error.
-- Confirmed directly in psql: the exact same INSERT succeeds with `RETURNING`
-- removed, and a follow-up SELECT can_view_project(id) in a later command on
-- the identical row correctly returns true.
--
-- Fix: give `projects` its own SELECT policy that checks the row's own
-- columns directly (owner_id/functional_owner_id/created_by/team_id, a
-- project_members EXISTS, or role) instead of routing through
-- can_view_project()'s by-id re-lookup. This has no self-reference, so it
-- sees the new row within the same command. can_view_project() itself is
-- left untouched -- project_members/milestones/project_updates/
-- project_activity's SELECT policies still call it correctly, since those
-- tables looking up their PARENT project (a different, already-committed
-- row from an earlier statement) never hits this race.
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT USING (
  org_id = current_org_id()
  AND (
    owner_id = auth.uid()
    OR functional_owner_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = projects.id AND pm.user_id = auth.uid())
    OR (team_id IS NOT NULL AND team_id = ANY (current_user_team_ids()))
    OR current_user_role() IN ('manager', 'admin', 'platform_owner')
  )
);

NOTIFY pgrst, 'reload schema';
