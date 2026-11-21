-- Rollback of migration 213: puts every access rule back exactly as it was before (the per-row form).
-- Run in the ckdesk database; then restart the data service (CkDeskPostgrest) on 10.0.1.98 so it reloads the schema.

BEGIN;

DROP POLICY IF EXISTS "approval_decisions_select" ON public.approval_decisions;
CREATE POLICY "approval_decisions_select" ON public.approval_decisions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM (approvals a
     JOIN requests r ON ((r.id = a.request_id)))
  WHERE ((a.id = approval_decisions.approval_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))))));

DROP POLICY IF EXISTS "approvals_select" ON public.approvals;
CREATE POLICY "approvals_select" ON public.approvals AS PERMISSIVE FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = approvals.request_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))))) OR is_request_approver(request_id)));

DROP POLICY IF EXISTS "csat_select" ON public.csat_surveys;
CREATE POLICY "csat_select" ON public.csat_surveys AS PERMISSIVE FOR SELECT TO public
  USING (((requester_id = auth.uid()) OR ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))));

DROP POLICY IF EXISTS "loc_admin" ON public.locations;
CREATE POLICY "loc_admin" ON public.locations AS PERMISSIVE FOR ALL TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "loc_select" ON public.locations;
CREATE POLICY "loc_select" ON public.locations AS PERMISSIVE FOR SELECT TO public
  USING ((org_id = current_org_id()));

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "oems_admin" ON public.oems;
CREATE POLICY "oems_admin" ON public.oems AS PERMISSIVE FOR ALL TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "oems_select" ON public.oems;
CREATE POLICY "oems_select" ON public.oems AS PERMISSIVE FOR SELECT TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "org_module_access_select" ON public.org_module_access;
CREATE POLICY "org_module_access_select" ON public.org_module_access AS PERMISSIVE FOR SELECT TO public
  USING (((org_id = current_org_id()) OR is_owner_org()));

DROP POLICY IF EXISTS "org_module_select" ON public.organizations;
CREATE POLICY "org_module_select" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING ((id = ( SELECT profiles.org_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

DROP POLICY IF EXISTS "org_select" ON public.organizations;
CREATE POLICY "org_select" ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING (((id = ( SELECT profiles.org_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) OR is_owner_org()));

DROP POLICY IF EXISTS "profile_mobile_numbers_admin" ON public.profile_mobile_numbers;
CREATE POLICY "profile_mobile_numbers_admin" ON public.profile_mobile_numbers AS PERMISSIVE FOR ALL TO "authenticated"
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))
  WITH CHECK (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "profile_mobile_numbers_select" ON public.profile_mobile_numbers;
CREATE POLICY "profile_mobile_numbers_select" ON public.profile_mobile_numbers AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((profile_id = auth.uid()) OR ((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))));

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (((id = auth.uid()) OR ((org_id = current_org_id()) AND ((current_user_role() <> 'user'::user_role) OR (id IN ( SELECT unnest(current_user_visible_people()) AS unnest))))));

DROP POLICY IF EXISTS "request_activity_select" ON public.request_activity;
CREATE POLICY "request_activity_select" ON public.request_activity AS PERMISSIVE FOR SELECT TO public
  USING (((current_user_role() IS NOT NULL) AND (current_user_role() <> 'user'::user_role) AND (EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = request_activity.request_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))))))));

DROP POLICY IF EXISTS "request_attachments_select" ON public.request_attachments;
CREATE POLICY "request_attachments_select" ON public.request_attachments AS PERMISSIVE FOR SELECT TO public
  USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = request_attachments.request_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])) OR (r.assigned_to = ANY (( SELECT current_user_vendor_assignees() AS current_user_vendor_assignees)::uuid[])))))) AND ((is_internal = false) OR (( SELECT r2.team_id
   FROM requests r2
  WHERE (r2.id = request_attachments.request_id)) = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))));

DROP POLICY IF EXISTS "collab_select" ON public.request_collaborators;
CREATE POLICY "collab_select" ON public.request_collaborators AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR (added_by = auth.uid()) OR can_manage_collaborators(request_id)));

DROP POLICY IF EXISTS "comments_select" ON public.request_comments;
CREATE POLICY "comments_select" ON public.request_comments AS PERMISSIVE FOR SELECT TO public
  USING ((((EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = request_comments.request_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])) OR (r.requester_id = ANY (current_user_subordinate_ids())) OR (r.assigned_to = ANY (current_user_subordinate_ids())) OR (r.assigned_to = ANY (( SELECT current_user_vendor_assignees() AS current_user_vendor_assignees)::uuid[])))))) OR is_request_approver(request_id)) AND ((NOT is_internal) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])) OR (EXISTS ( SELECT 1
   FROM requests r2
  WHERE ((r2.id = request_comments.request_id) AND (r2.team_id = ANY (current_user_team_ids()))))) OR (is_request_collaborator(request_id) AND is_agent()))));

DROP POLICY IF EXISTS "time_entries_select" ON public.request_time_entries;
CREATE POLICY "time_entries_select" ON public.request_time_entries AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = request_time_entries.request_id) AND (r.org_id = current_org_id()) AND ((r.requester_id = auth.uid()) OR (r.team_id = ANY (current_user_team_ids())) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))))))));

DROP POLICY IF EXISTS "categories_admin" ON public.service_categories;
CREATE POLICY "categories_admin" ON public.service_categories AS PERMISSIVE FOR ALL TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "categories_select" ON public.service_categories;
CREATE POLICY "categories_select" ON public.service_categories AS PERMISSIVE FOR SELECT TO public
  USING ((org_id = current_org_id()));

DROP POLICY IF EXISTS "service_location_tags_admin" ON public.service_location_tags;
CREATE POLICY "service_location_tags_admin" ON public.service_location_tags AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = service_location_tags.service_id) AND (s.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))));

DROP POLICY IF EXISTS "service_location_tags_select" ON public.service_location_tags;
CREATE POLICY "service_location_tags_select" ON public.service_location_tags AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = service_location_tags.service_id) AND (s.org_id = current_org_id())))));

DROP POLICY IF EXISTS "sub_categories_admin_write" ON public.service_sub_categories;
CREATE POLICY "sub_categories_admin_write" ON public.service_sub_categories AS PERMISSIVE FOR ALL TO public
  USING (((EXISTS ( SELECT 1
   FROM service_categories c
  WHERE ((c.id = service_sub_categories.category_id) AND (c.org_id = current_org_id())))) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM service_categories c
  WHERE ((c.id = service_sub_categories.category_id) AND (c.org_id = current_org_id())))) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "sub_categories_select" ON public.service_sub_categories;
CREATE POLICY "sub_categories_select" ON public.service_sub_categories AS PERMISSIVE FOR SELECT TO public
  USING (((is_active = true) AND (EXISTS ( SELECT 1
   FROM service_categories c
  WHERE ((c.id = service_sub_categories.category_id) AND (c.org_id = current_org_id()))))));

DROP POLICY IF EXISTS "service_sub_category_tags_admin" ON public.service_sub_category_tags;
CREATE POLICY "service_sub_category_tags_admin" ON public.service_sub_category_tags AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = service_sub_category_tags.service_id) AND (s.org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))));

DROP POLICY IF EXISTS "service_sub_category_tags_select" ON public.service_sub_category_tags;
CREATE POLICY "service_sub_category_tags_select" ON public.service_sub_category_tags AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM services s
  WHERE ((s.id = service_sub_category_tags.service_id) AND (s.org_id = current_org_id())))));

DROP POLICY IF EXISTS "services_admin" ON public.services;
CREATE POLICY "services_admin" ON public.services AS PERMISSIVE FOR ALL TO "authenticated"
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))
  WITH CHECK (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services AS PERMISSIVE FOR SELECT TO public
  USING (((org_id = current_org_id()) AND ((is_active = true) OR (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])))));

DROP POLICY IF EXISTS "sla_policies_admin" ON public.sla_policies;
CREATE POLICY "sla_policies_admin" ON public.sla_policies AS PERMISSIVE FOR ALL TO "authenticated"
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))))
  WITH CHECK (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "sla_policies_select" ON public.sla_policies;
CREATE POLICY "sla_policies_select" ON public.sla_policies AS PERMISSIVE FOR SELECT TO public
  USING (((org_id = current_org_id()) AND ((is_active = true) OR (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role])))));

DROP POLICY IF EXISTS "stores_admin" ON public.stores;
CREATE POLICY "stores_admin" ON public.stores AS PERMISSIVE FOR ALL TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "stores_select" ON public.stores;
CREATE POLICY "stores_select" ON public.stores AS PERMISSIVE FOR SELECT TO public
  USING ((org_id = current_org_id()));

DROP POLICY IF EXISTS "team_members_select" ON public.team_members;
CREATE POLICY "team_members_select" ON public.team_members AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (((org_id = current_org_id()) AND ((user_id = auth.uid()) OR (current_user_role() <> 'user'::user_role))));

DROP POLICY IF EXISTS "teams_admin" ON public.teams;
CREATE POLICY "teams_admin" ON public.teams AS PERMISSIVE FOR ALL TO public
  USING (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))))
  WITH CHECK (((org_id = current_org_id()) AND (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]))));

DROP POLICY IF EXISTS "teams_select" ON public.teams;
CREATE POLICY "teams_select" ON public.teams AS PERMISSIVE FOR SELECT TO public
  USING ((org_id = current_org_id()));

COMMIT;
