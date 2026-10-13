-- Post-audit remediation, High database findings (audit report 2026-10-13): D-004, D-006, D-008, D-010 (database part), D-014, D-015, D-054.
-- LOCAL migration, tightening only; no table is rewritten and no existing row is changed. Prepared for review; NOT applied to production.
-- Everything the application does goes through the server's service-role client (which these rules do not apply to) or through the
-- signed-in user's own client for the actions listed in the comments below, all of which keep working.

-- ── D-004: nobody can read or write another request's attachment files straight from Storage ─────────────────────────────────────
-- A permissive policy ("Authenticated download only", bucket test only) was OR-ed with the correct per-request one, and any signed-in user
-- could also upload into the bucket. The app uploads, downloads and removes files with its service client (lib/actions/attachments.ts),
-- so neither policy is needed.
DROP POLICY IF EXISTS "Authenticated download only" ON storage.objects;
DROP POLICY IF EXISTS "storage_request_attachments_insert" ON storage.objects;

-- ── D-006: company-wide settings are not readable without signing in, nor writable by any organization's manager ─────────────────
-- (these tables have no organization column; every change the app makes goes through the service client)
REVOKE ALL ON public.business_hours, public.holidays, public.sla_escalation_rules, public.task_statuses, public.task_priorities,
              public.request_priorities, public.retention_policies, public.app_settings FROM anon;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('business_hours', 'biz_hours_all', 'biz_hours_select'),
      ('holidays', 'holidays_all', 'holidays_select'),
      ('sla_escalation_rules', 'sla_rules_all', 'sla_rules_select'),
      ('task_statuses', 'ts_admin', 'ts_select'),
      ('task_priorities', 'tp_admin', 'tp_select'),
      ('request_priorities', 'rp_admin', 'rp_select')
    ) AS t(tbl, write_policy, read_policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.write_policy, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.read_policy, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', r.read_policy, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (current_user_role() = ''platform_owner'') WITH CHECK (current_user_role() = ''platform_owner'')', r.write_policy, r.tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "retention_admin" ON public.retention_policies;
DROP POLICY IF EXISTS "retention_select" ON public.retention_policies;
CREATE POLICY "retention_select" ON public.retention_policies FOR SELECT TO authenticated USING (current_user_role() = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'platform_owner'::user_role]));
CREATE POLICY "retention_admin" ON public.retention_policies FOR ALL TO authenticated USING (current_user_role() = 'platform_owner') WITH CHECK (current_user_role() = 'platform_owner');

DROP POLICY IF EXISTS "app_settings_write" ON public.app_settings;
CREATE POLICY "app_settings_write" ON public.app_settings FOR ALL TO authenticated USING (current_user_role() = 'platform_owner') WITH CHECK (current_user_role() = 'platform_owner');

-- ── D-014: deleting a task or a collaborator is limited to the caller's own organization ─────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE TO authenticated
  USING (org_id = current_org_id() AND (created_by = auth.uid() OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])));

DROP POLICY IF EXISTS "collab_delete" ON public.request_collaborators;
CREATE POLICY "collab_delete" ON public.request_collaborators FOR DELETE TO authenticated
  USING (
    (added_by = auth.uid() OR current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role]))
    AND EXISTS (SELECT 1 FROM public.requests r WHERE r.id = request_collaborators.request_id AND r.org_id = current_org_id())
  );

-- ── D-015: a ticket's internal notes are visible to its own team, managers, and collaborators who are technicians ──────────────────
-- (it was "any technician of any team", so a technician who raised a ticket to another team could read that team's private notes)
DROP POLICY IF EXISTS "comments_select" ON public.request_comments;
CREATE POLICY "comments_select" ON public.request_comments FOR SELECT
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.requests r
        WHERE r.id = request_comments.request_id
          AND r.org_id = current_org_id()
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
      OR EXISTS (SELECT 1 FROM public.requests r2 WHERE r2.id = request_comments.request_id AND r2.team_id = ANY (current_user_team_ids()))
      OR (is_request_collaborator(request_id) AND is_agent())
    )
  );

-- ── D-010 (database part): a deactivated user sees nothing ───────────────────────────────────────────────────────────────────────
-- The helpers every row-security rule starts from answer "no organization / no role" for an inactive user, so a session that is still
-- open stops seeing data at once. (The application also blocks sign-in and bans the account; see lib/actions/admin/users.ts.)
CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active
$function$;

-- ── D-008: a signed-in user cannot forge a ticket's lifecycle, SLA clock or number through the API ────────────────────────────────
-- Tickets are created by the server (which sets all of this itself). A client-role insert may only be an ordinary new, unassigned ticket,
-- and a client-role update can never renumber a ticket or change when it was created.
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
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_request_client_write ON public.requests;
CREATE TRIGGER trg_guard_request_client_write
  BEFORE INSERT OR UPDATE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_client_write();

-- ── D-054: an attachment row cannot be pointed at another file or given another type through the API ───────────────────────────────
-- The upload action inserts the row as the signed-in user with the file in the request's own folder; deleting only sets deleted_at.
CREATE OR REPLACE FUNCTION public.guard_attachment_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.storage_path NOT LIKE NEW.request_id::text || '/%' OR NEW.storage_path LIKE '%..%' THEN
        RAISE EXCEPTION 'an attachment must be stored in its own request folder' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
         OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.file_size IS DISTINCT FROM OLD.file_size
         OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
        RAISE EXCEPTION 'only the deleted flag of an attachment can be changed' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_attachment_client_write ON public.request_attachments;
CREATE TRIGGER trg_guard_attachment_client_write
  BEFORE INSERT OR UPDATE ON public.request_attachments
  FOR EACH ROW EXECUTE FUNCTION public.guard_attachment_client_write();
