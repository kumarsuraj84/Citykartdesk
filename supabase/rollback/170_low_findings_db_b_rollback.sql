-- Rollback of 20240101000170_low_findings_db_b.sql. Run BEFORE the rollback of 169 (reverse order).
-- Data note: the two counter tables hold only short-lived counters; dropping them loses nothing that matters.
BEGIN;
DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, integer);
DROP FUNCTION IF EXISTS public.webhook_seen_once(text, integer);
DROP FUNCTION IF EXISTS public.webhook_seen_forget(text);
DROP TABLE IF EXISTS public.rate_limit_counters;
DROP TABLE IF EXISTS public.webhook_seen;

-- the attachment rules as they were
DROP POLICY IF EXISTS request_attachments_insert ON public.request_attachments;
CREATE POLICY request_attachments_insert ON public.request_attachments FOR INSERT WITH CHECK (
  (uploaded_by = auth.uid())
  AND (EXISTS (
    SELECT 1 FROM requests r
    WHERE ((r.id = request_attachments.request_id) AND (r.org_id = current_org_id())
      AND ((r.requester_id = auth.uid()) OR is_team_member(r.team_id) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])) OR is_request_collaborator(r.id))))
  )
);
DROP POLICY IF EXISTS storage_request_attachments_select ON storage.objects;
CREATE POLICY storage_request_attachments_select ON storage.objects FOR SELECT USING (
  (bucket_id = 'request-attachments'::text) AND (EXISTS (
    SELECT 1 FROM request_attachments ra
    WHERE ((ra.storage_path = objects.name) AND (ra.deleted_at IS NULL) AND (EXISTS (
      SELECT 1 FROM requests r
      WHERE ((r.id = ra.request_id) AND (r.org_id = current_org_id()) AND (((r.requester_id = auth.uid()) AND (ra.is_internal = false)) OR is_team_member(r.team_id) OR (current_user_role() = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'platform_owner'::user_role])))))))))
);

-- the staff list as it was: everybody in the organisation can be read by every signed-in person
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING ((org_id = current_org_id()) OR (id = auth.uid()));
DROP FUNCTION IF EXISTS public.current_user_visible_people();

-- the field SLA function as it was before (without the organisation check)
CREATE OR REPLACE FUNCTION public.upsert_field_sla_override(p_org_id uuid, p_service_id uuid, p_field_id text, p_field_label text, p_option_value text, p_option_label text, p_priority text, p_response_hours numeric, p_resolution_hours numeric, p_updated_by uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF p_response_hours IS NOT NULL AND p_resolution_hours IS NOT NULL AND p_resolution_hours <= p_response_hours THEN
    RAISE EXCEPTION 'Resolution SLA (%h) must be greater than Response SLA (%h).', p_resolution_hours, p_response_hours
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO field_sla_overrides (
    org_id, service_id, field_id, field_label, option_value, option_label, sla_config, updated_by, updated_at
  )
  VALUES (
    p_org_id, p_service_id, p_field_id, p_field_label, p_option_value, p_option_label,
    jsonb_build_object(p_priority, jsonb_build_object('response_hours', p_response_hours, 'resolution_hours', p_resolution_hours)),
    p_updated_by, now()
  )
  ON CONFLICT (service_id, field_id, option_value) DO UPDATE
  SET sla_config = jsonb_set(
        coalesce(field_sla_overrides.sla_config, '{}'::jsonb),
        ARRAY[p_priority],
        jsonb_build_object('response_hours', p_response_hours, 'resolution_hours', p_resolution_hours),
        true
      ),
      field_label = p_field_label,
      option_label = p_option_label,
      updated_by = p_updated_by,
      updated_at = now();
END;
$function$;

-- Put back the privileges recorded by the migration (only for the objects that existed then).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public._grant_snapshots') IS NULL THEN
    RAISE EXCEPTION 'The grant record of migration 170 (public._grant_snapshots) is missing: this rollback cannot restore the previous privileges exactly.';
  END IF;
  FOR r IN SELECT DISTINCT kind, object_name FROM public._grant_snapshots WHERE stage = '170' AND kind IN ('table', 'sequence') LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %s public.%I FROM anon, authenticated', CASE r.kind WHEN 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, r.object_name);
    END IF;
  END LOOP;
  FOR r IN SELECT kind, grantee, object_name, privilege FROM public._grant_snapshots WHERE stage = '170' AND kind IN ('table', 'sequence') AND privilege <> '-' LOOP
    IF to_regclass('public.' || quote_ident(r.object_name)) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON %s public.%I TO %I', r.privilege, CASE r.kind WHEN 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, r.object_name, r.grantee);
    END IF;
  END LOOP;
  FOR r IN SELECT grantee, object_name, privilege FROM public._grant_snapshots WHERE stage = '170' AND kind = 'column' LOOP
    IF to_regclass('public.' || quote_ident(split_part(r.object_name, '.', 1))) IS NOT NULL THEN
      EXECUTE format('GRANT %s (%I) ON TABLE public.%I TO %I', r.privilege, split_part(r.object_name, '.', 2), split_part(r.object_name, '.', 1), r.grantee);
    END IF;
  END LOOP;
  DELETE FROM public._grant_snapshots WHERE stage = '170';
  IF NOT EXISTS (SELECT 1 FROM public._grant_snapshots) THEN DROP TABLE public._grant_snapshots; END IF;
END $$;
DELETE FROM auth.schema_migrations WHERE version = '20240101000170';
COMMIT;
