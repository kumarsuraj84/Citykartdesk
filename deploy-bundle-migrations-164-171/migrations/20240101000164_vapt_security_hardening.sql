-- VAPT 2026-10 — database hardening (LOCAL; apply to production only after review).
-- Each block says which finding it closes. Everything is idempotent. Rollback: supabase/rollback/164_vapt_security_hardening_rollback.sql
--
--  VA-DB-01 / VA-TKT-01  the database now also refuses a hand-made change of priority, and of SLA due dates unless the ticket's status changes in
--                        the same update (resume / reopen paths); due-date changes are written to the System Log
--  VA-DB-02              tickets are created by the server only (no direct INSERT from a signed-in user)
--  VA-INT-01 / VA-DB-06  a file attached to an internal note is internal; the file store honours that and the organisation
--  VA-INT-10 / VA-DB-05  no direct upload into the task-attachments bucket by a signed-in user
--  VA-INT-13 / VA-DB-07  mobile numbers: own row, or staff; written by admin / platform owner only
--  VA-API-02 / VA-DB-04  a user can no longer clear their own "must change password" flag
--  VA-DB-03              services, SLA policies, SLA configuration: written by admin / platform owner only (as the screens already require)
--  VA-DB-12              excess table privileges removed (TRUNCATE / TRIGGER / REFERENCES)

BEGIN;

-- ── 1. requests ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_request_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status NOT IN ('open', 'pending_approval')
         OR NEW.resolved_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.responded_at IS NOT NULL
         OR NEW.waiting_since IS NOT NULL OR NEW.assigned_to IS NOT NULL
         OR NEW.response_due_at IS NOT NULL OR NEW.resolution_due_at IS NOT NULL
         OR coalesce(NEW.paused_ms_total, 0) <> 0 OR coalesce(NEW.reopen_count, 0) <> 0 THEN
        RAISE EXCEPTION 'a new ticket can only be created as an open, unassigned ticket' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.request_no IS DISTINCT FROM OLD.request_no OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'a ticket number and creation time cannot be changed' USING ERRCODE = '42501';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.request_status_transition_allowed(OLD.status::text, NEW.status::text) THEN
        RAISE EXCEPTION 'a ticket cannot move from % to % this way', OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
      -- The priority comes from the sub-category and its SLA (or a Business Rule), run by the server. Nobody sets it by hand, whatever the role.
      IF NEW.priority IS DISTINCT FROM OLD.priority THEN
        RAISE EXCEPTION 'the priority of a ticket is set automatically and cannot be changed by hand' USING ERRCODE = '42501';
      END IF;
      -- SLA deadlines and the paused-time ledger move only together with a status change (pause / resume / reopen), never on their own.
      IF (NEW.response_due_at IS DISTINCT FROM OLD.response_due_at
          OR NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at
          OR NEW.paused_ms_total IS DISTINCT FROM OLD.paused_ms_total)
         AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'SLA deadlines cannot be changed by hand' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Tickets are created by the server (which checks the service, the form, the priority and the routing). A signed-in user has no direct INSERT.
DROP POLICY IF EXISTS requests_insert ON public.requests;

-- SLA deadlines and pause fields are now watched by the System Log too (a dates-only change used to leave no trace).
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.system_log_audit_trigger()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_system_log_audit ON public.requests;
    EXECUTE $t$CREATE TRIGGER trg_system_log_audit AFTER INSERT OR DELETE OR UPDATE ON public.requests FOR EACH ROW
      EXECUTE FUNCTION public.system_log_audit_trigger('status,assigned_to,priority,team_id,requester_id,service_id,resolved_at,closed_at,reopen_count,response_due_at,resolution_due_at,paused_ms_total', 'audit', 'id,org_id,request_no,status,priority,team_id,service_id,requester_id,assigned_to')$t$;
  END IF;
END $$;

-- ── 2. attachments of internal notes ──────────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE public.request_attachments ra SET is_internal = true
 WHERE ra.is_internal = false AND ra.comment_id IN (SELECT c.id FROM public.request_comments c WHERE c.is_internal = true);

DROP POLICY IF EXISTS storage_request_attachments_select ON storage.objects;
CREATE POLICY storage_request_attachments_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'request-attachments'
    AND EXISTS (
      SELECT 1 FROM public.request_attachments ra
       WHERE ra.storage_path = objects.name AND ra.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM public.requests r
            WHERE r.id = ra.request_id AND r.org_id = public.current_org_id()
              AND (
                (r.requester_id = auth.uid() AND ra.is_internal = false)
                OR public.is_team_member(r.team_id)
                OR public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])
              )
         )
    )
  );

-- ── 3. task-attachments bucket: the server uploads with its own key; a signed-in user has no direct upload ───────────────────────────────
DROP POLICY IF EXISTS task_attach_storage_insert ON storage.objects;

-- ── 4. mobile numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profile_mobile_numbers_select ON public.profile_mobile_numbers;
CREATE POLICY profile_mobile_numbers_select ON public.profile_mobile_numbers FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
  );
DROP POLICY IF EXISTS profile_mobile_numbers_admin ON public.profile_mobile_numbers;
CREATE POLICY profile_mobile_numbers_admin ON public.profile_mobile_numbers FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));

-- ── 5. "must change password" can only be cleared by the server, after the password really changed ───────────────────────────────────────
REVOKE UPDATE (must_reset_password) ON public.profiles FROM authenticated;
CREATE OR REPLACE FUNCTION public.guard_profile_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
       OR NEW.must_reset_password IS DISTINCT FROM OLD.must_reset_password THEN
      RAISE EXCEPTION 'these profile fields can only be changed by an administrator' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 6. configuration the screens reserve for administrators ───────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS services_admin ON public.services;
CREATE POLICY services_admin ON public.services FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS sla_policies_admin ON public.sla_policies;
CREATE POLICY sla_policies_admin ON public.sla_policies FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS sla_config_admin ON public.global_sla_config;
CREATE POLICY sla_config_admin ON public.global_sla_config FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));
DROP POLICY IF EXISTS field_sla_overrides_write ON public.field_sla_overrides;
CREATE POLICY field_sla_overrides_write ON public.field_sla_overrides FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = ANY (ARRAY['admin'::user_role, 'platform_owner'::user_role]));

-- ── 7. excess table privileges (none of them is used by the application) ──────────────────────────────────────────────────────────────────
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

COMMIT;
