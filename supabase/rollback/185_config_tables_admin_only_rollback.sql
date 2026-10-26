-- Rollback of 185: managers may write categories, form templates and technician groups through the data API again (the state before).
BEGIN;
DROP POLICY IF EXISTS "categories_admin" ON public.service_categories;
CREATE POLICY "categories_admin" ON public.service_categories FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
DROP POLICY IF EXISTS "form_templates_admin" ON public.form_templates;
CREATE POLICY "form_templates_admin" ON public.form_templates FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
DROP POLICY IF EXISTS "teams_admin" ON public.teams;
CREATE POLICY "teams_admin" ON public.teams FOR ALL
  USING ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])))
  WITH CHECK ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])));
COMMIT;
