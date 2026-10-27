-- 185: QA defect QA-D002. LOCAL ONLY until released. Rollback: supabase/rollback/185_config_tables_admin_only_rollback.sql
--
-- Found by the release-candidate QA run (qa-release-candidate-2026-10): a MANAGER could change categories, form templates and technician groups straight through the
-- data API (for example switch a category's CVM approval, AC PMS or OEM routing on or off, or change a form) although every screen and server action for them is
-- administrator-only ("Admin role required"). The database rule allowed 'manager' as well, so the screens were stricter than the database behind them.
-- Now the database rule is the same as the screens: administrators and platform owners only. Reading is unchanged (categories_select and the other read rules stay).
-- Every write the application makes to these three tables comes from an administrator-only action, so nothing a manager can do in the screens changes.
BEGIN;

DROP POLICY IF EXISTS "categories_admin" ON public.service_categories;
CREATE POLICY "categories_admin" ON public.service_categories FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])))
  WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));

DROP POLICY IF EXISTS "form_templates_admin" ON public.form_templates;
CREATE POLICY "form_templates_admin" ON public.form_templates FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])))
  WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));

DROP POLICY IF EXISTS "teams_admin" ON public.teams;
CREATE POLICY "teams_admin" ON public.teams FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])))
  WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role])));

COMMIT;
