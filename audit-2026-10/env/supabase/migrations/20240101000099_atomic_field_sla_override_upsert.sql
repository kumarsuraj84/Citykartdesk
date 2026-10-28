-- field_sla_overrides.sla_config was being merged client-side (SELECT current
-- row -> merge one priority tier in JS -> UPSERT the whole JSONB back). Since
-- Response and Resolution hours for the same row save independently (two
-- separate blur-triggered calls), two overlapping saves race: whichever
-- SELECT->UPSERT round trip lands second clobbers the other with a stale
-- snapshot, silently reverting hours the user just typed. This function makes
-- the merge atomic — a single UPDATE using jsonb_set, so Postgres's own
-- row-level locking serializes concurrent calls instead of one racing the
-- other's read. Also enforces resolution_hours > response_hours server-side
-- (both values arrive together on every call, whichever field triggered it),
-- since that's the one place guaranteed to see both current values at once.

CREATE OR REPLACE FUNCTION upsert_field_sla_override(
  p_org_id          UUID,
  p_service_id      UUID,
  p_field_id        TEXT,
  p_field_label     TEXT,
  p_option_value    TEXT,
  p_option_label    TEXT,
  p_priority        TEXT,
  p_response_hours  NUMERIC,
  p_resolution_hours NUMERIC,
  p_updated_by      UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- Runs as the defining role (service_role, via SECURITY DEFINER) but callers
-- still need EXECUTE — the RLS write policy on field_sla_overrides itself is
-- bypassed by SECURITY DEFINER, so the function re-checks role membership.
REVOKE ALL ON FUNCTION upsert_field_sla_override FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_field_sla_override TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_field_sla_override TO service_role;

NOTIFY pgrst, 'reload schema';
