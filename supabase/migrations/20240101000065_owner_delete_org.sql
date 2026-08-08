-- owner_delete_org: permanently deletes a Citykart Desk organization and all its data.
-- Called server-side only (service-role client or SECURITY DEFINER chain).
-- Hard-deletes in dependency order to avoid FK violations.

CREATE OR REPLACE FUNCTION owner_delete_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organization not found');
  END IF;

  -- Delete child records first (FK order)
  DELETE FROM license_keys           WHERE org_id = p_org_id;
  DELETE FROM org_module_access      WHERE org_id = p_org_id;
  DELETE FROM billing_snapshots      WHERE org_id = p_org_id;
  DELETE FROM error_reports          WHERE org_id = p_org_id;

  -- Profiles (Supabase auth users stay; only the profile row is removed)
  DELETE FROM profiles               WHERE org_id = p_org_id;

  -- The organization itself
  DELETE FROM organizations          WHERE id     = p_org_id;

  RETURN jsonb_build_object('ok', true, 'deleted', v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION owner_delete_org(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION owner_delete_org(uuid) FROM anon, authenticated;
