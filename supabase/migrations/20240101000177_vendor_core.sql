-- 177: vendor technicians (OEM engineers who log in to Citykart Desk) and vendor managers (read only). LOCAL ONLY until released ("push vendor core one").
-- Rollback: supabase/rollback/177_vendor_core_rollback.sql
--
-- A vendor login is an ORDINARY requester-level account (role 'user', the most restricted role there is) that also carries a vendor company and a vendor kind.
-- It is deliberately NOT a new value of the user_role list: every existing "role is not user" test in the database then keeps treating a vendor as the least
-- trusted kind of person, instead of letting an unknown new role slip through.
--   * a vendor technician reads only the tickets assigned to him (and their public comments / public attachments);
--   * a vendor manager reads (never changes) the tickets assigned to the technicians of his OWN company;
--   * nothing else changes for anybody else.
-- All writes by vendors are made by the application with the server's key after its own checks (migration 165 left signed-in users no direct write right on tickets).
BEGIN;

-- The vendor companies (Voltas, Blue Star ...). Server only: the administrator screens check the role first.
CREATE TABLE IF NOT EXISTS public.vendor_companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_companies_name ON public.vendor_companies (org_id, lower(btrim(name)));
ALTER TABLE public.vendor_companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_companies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.vendor_companies TO service_role;

-- Who is a vendor. Both columns are set together or not at all.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_company_id uuid REFERENCES public.vendor_companies(id) ON DELETE RESTRICT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_role text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_vendor_pair_chk') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_vendor_pair_chk CHECK (
      (vendor_company_id IS NULL AND vendor_role IS NULL)
      OR (vendor_company_id IS NOT NULL AND vendor_role IN ('technician', 'manager') AND role = 'user')
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_profiles_vendor_company ON public.profiles (vendor_company_id) WHERE vendor_company_id IS NOT NULL;

-- A person cannot make themselves (or anybody) a vendor, or move to another company: only the server's key may change these two columns.
CREATE OR REPLACE FUNCTION public.guard_profile_client_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
       OR NEW.store_id IS DISTINCT FROM OLD.store_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
       OR NEW.function_id IS DISTINCT FROM OLD.function_id
       OR NEW.designation_id IS DISTINCT FROM OLD.designation_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.job_title IS DISTINCT FROM OLD.job_title
       OR NEW.whatsapp_enabled IS DISTINCT FROM OLD.whatsapp_enabled
       OR NEW.must_reset_password IS DISTINCT FROM OLD.must_reset_password
       OR NEW.vendor_company_id IS DISTINCT FROM OLD.vendor_company_id
       OR NEW.vendor_role IS DISTINCT FROM OLD.vendor_role THEN
      RAISE EXCEPTION 'these profile fields can only be changed by an administrator' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Whose tickets the signed-in person may read as a vendor: a technician reads his own; a manager reads those of the technicians of his company; anybody else: nobody.
CREATE OR REPLACE FUNCTION public.current_user_vendor_assignees()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT COALESCE((
    SELECT CASE me.vendor_role
      WHEN 'technician' THEN ARRAY[me.id]
      WHEN 'manager' THEN COALESCE((SELECT array_agg(t.id) FROM profiles t
                                    WHERE t.vendor_company_id = me.vendor_company_id AND t.vendor_role = 'technician' AND t.org_id = me.org_id), '{}'::uuid[])
    END
    FROM profiles me
    WHERE me.id = auth.uid() AND me.is_active AND me.vendor_company_id IS NOT NULL
  ), '{}'::uuid[])
$function$;
REVOKE ALL ON FUNCTION public.current_user_vendor_assignees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_vendor_assignees() TO authenticated, service_role;

-- True when the signed-in person is a vendor (technician or manager).
CREATE OR REPLACE FUNCTION public.is_vendor_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND vendor_company_id IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.is_vendor_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vendor_user() TO authenticated, service_role;

-- Tickets: one more way to read a ticket (the vendor way). Everything else in the policy is unchanged.
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
    OR assigned_to = ANY ((SELECT current_user_vendor_assignees())::uuid[])
  )
);

-- Comments: the same, and a vendor never reads an internal comment (the second block is unchanged: internal needs manager+, the ticket's team, or a collaborator who is an agent).
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
          OR r.assigned_to = ANY ((SELECT current_user_vendor_assignees())::uuid[])
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

-- Attachments (the public ones only reach a vendor: the internal rule below is unchanged).
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
        OR r.assigned_to = ANY ((SELECT current_user_vendor_assignees())::uuid[])
      )
  )
  AND (
    is_internal = false
    OR (SELECT r2.team_id FROM requests r2 WHERE r2.id = request_attachments.request_id) = ANY (current_user_team_ids())
    OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
  )
);

-- Names the signed-in person may see: also the people on the tickets a vendor may read (the store's login that raised it, those who commented in public).
CREATE OR REPLACE FUNCTION public.current_user_visible_people()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH my_reqs AS (
    SELECT r.id, r.requester_id, r.assigned_to FROM requests r
    WHERE r.org_id = current_org_id()
      AND (r.requester_id = auth.uid() OR r.id = ANY (current_user_collab_request_ids()) OR r.id = ANY (current_user_approver_request_ids())
           OR r.assigned_to = ANY ((SELECT current_user_vendor_assignees())::uuid[]))
  )
  SELECT coalesce(array_agg(DISTINCT p), '{}'::uuid[]) FROM (
    SELECT auth.uid() AS p
    UNION SELECT manager_id FROM profiles WHERE id = auth.uid()
    UNION SELECT unnest(current_user_subordinate_ids())
    UNION SELECT unnest(current_user_vendor_assignees())
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

-- A vendor never raises a ticket as a requester (the application also refuses it; this is the second lock).
-- (Tickets are inserted with the server's key; the only signed-in insert path would be an RLS insert policy, and there is none.)

-- The audit trail also records vendor changes on a profile.
DROP TRIGGER IF EXISTS trg_system_log_audit ON public.profiles;
CREATE TRIGGER trg_system_log_audit AFTER INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION system_log_audit_trigger(
  'role,is_active,org_id,manager_id,store_id,department_id,location_id,function_id,designation_id,cost_center_id,employee_id,job_title,must_reset_password,whatsapp_enabled,full_name,vendor_company_id,vendor_role',
  'security',
  'id,org_id,full_name,email,role,is_active,manager_id,store_id,department_id,vendor_company_id,vendor_role'
);

COMMIT;
