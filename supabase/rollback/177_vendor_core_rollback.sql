-- Rollback of 177 (vendor core). Only safe when no vendor login exists yet (delete or convert them first).
BEGIN;

DROP POLICY IF EXISTS requests_select ON public.requests;
CREATE POLICY requests_select ON public.requests FOR SELECT USING (
  org_id = (SELECT current_org_id())
  AND (
    requester_id = (SELECT auth.uid())
    OR team_id = ANY ((SELECT current_user_team_ids())::uuid[])
    OR (SELECT current_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    OR id = ANY ((SELECT current_user_collab_request_ids())::uuid[])
    OR id = ANY ((SELECT current_user_approver_request_ids())::uuid[])
    OR requester_id = ANY ((SELECT current_user_subordinate_ids())::uuid[])
    OR assigned_to = ANY ((SELECT current_user_subordinate_ids())::uuid[])
  )
);

DROP POLICY IF EXISTS comments_select ON public.request_comments;
CREATE POLICY comments_select ON public.request_comments FOR SELECT USING (
  (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_comments.request_id AND r.org_id = current_org_id()
        AND (
          r.requester_id = auth.uid()
          OR r.team_id = ANY (current_user_team_ids())
          OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
          OR r.requester_id = ANY (current_user_subordinate_ids())
          OR r.assigned_to = ANY (current_user_subordinate_ids())
        )
    )
    OR is_request_approver(request_id)
  )
  AND (
    NOT is_internal
    OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
    OR EXISTS (SELECT 1 FROM requests r2 WHERE r2.id = request_comments.request_id AND r2.team_id = ANY (current_user_team_ids()))
    OR (is_request_collaborator(request_id) AND is_agent())
  )
);

DROP POLICY IF EXISTS request_attachments_select ON public.request_attachments;
CREATE POLICY request_attachments_select ON public.request_attachments FOR SELECT USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_attachments.request_id AND r.org_id = current_org_id()
      AND (
        r.requester_id = auth.uid()
        OR r.team_id = ANY (current_user_team_ids())
        OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
      )
  )
  AND (
    is_internal = false
    OR (SELECT r2.team_id FROM requests r2 WHERE r2.id = request_attachments.request_id) = ANY (current_user_team_ids())
    OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
  )
);

CREATE OR REPLACE FUNCTION public.current_user_visible_people()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH my_reqs AS (
    SELECT r.id, r.requester_id, r.assigned_to FROM requests r
    WHERE r.org_id = current_org_id()
      AND (r.requester_id = auth.uid() OR r.id = ANY (current_user_collab_request_ids()) OR r.id = ANY (current_user_approver_request_ids()))
  )
  SELECT coalesce(array_agg(DISTINCT p), '{}'::uuid[]) FROM (
    SELECT auth.uid() AS p
    UNION SELECT manager_id FROM profiles WHERE id = auth.uid()
    UNION SELECT unnest(current_user_subordinate_ids())
    UNION SELECT requester_id FROM my_reqs
    UNION SELECT assigned_to FROM my_reqs
    UNION SELECT c.author_id FROM request_comments c JOIN my_reqs m ON m.id = c.request_id WHERE NOT c.is_internal
    UNION SELECT a.actor_id FROM request_activity a JOIN my_reqs m ON m.id = a.request_id
    UNION SELECT cl.user_id FROM request_collaborators cl JOIN my_reqs m ON m.id = cl.request_id
    UNION SELECT s.approver_user_id FROM approvals ap JOIN my_reqs m ON m.id = ap.request_id JOIN approval_workflow_steps s ON s.workflow_id = ap.workflow_id
    UNION SELECT d.decided_by FROM approval_decisions d JOIN approvals ap ON ap.id = d.approval_id JOIN my_reqs m ON m.id = ap.request_id
    UNION SELECT n.actor_id FROM notifications n WHERE n.user_id = auth.uid()
  ) x WHERE p IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.guard_profile_client_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
       OR NEW.function_id IS DISTINCT FROM OLD.function_id OR NEW.designation_id IS DISTINCT FROM OLD.designation_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.job_title IS DISTINCT FROM OLD.job_title
       OR NEW.whatsapp_enabled IS DISTINCT FROM OLD.whatsapp_enabled OR NEW.must_reset_password IS DISTINCT FROM OLD.must_reset_password THEN
      RAISE EXCEPTION 'these profile fields can only be changed by an administrator' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_system_log_audit ON public.profiles;
CREATE TRIGGER trg_system_log_audit AFTER INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION system_log_audit_trigger(
  'role,is_active,org_id,manager_id,store_id,department_id,location_id,function_id,designation_id,cost_center_id,employee_id,job_title,must_reset_password,whatsapp_enabled,full_name',
  'security',
  'id,org_id,full_name,email,role,is_active,manager_id,store_id,department_id'
);

DROP FUNCTION IF EXISTS public.is_vendor_user();
DROP FUNCTION IF EXISTS public.current_user_vendor_assignees();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_vendor_pair_chk;
DROP INDEX IF EXISTS public.idx_profiles_vendor_company;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS vendor_role;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS vendor_company_id;
DROP TABLE IF EXISTS public.vendor_companies;

COMMIT;
