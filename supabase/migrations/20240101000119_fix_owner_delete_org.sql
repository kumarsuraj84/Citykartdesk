-- Fixes owner_delete_org(), which was completely non-functional:
--   1. It deleted from `billing_snapshots`, a table that was never created —
--      every call failed immediately with "relation does not exist".
--   2. Even past that, it only ever cleaned 4 tables. Every other org-scoped
--      table (requests, tasks, services, teams, departments, ...) has an
--      org_id FK to organizations with NO ACTION (not CASCADE), and profiles
--      is referenced by NO ACTION/RESTRICT FKs from requests.requester_id,
--      tasks.created_by, request_comments.author_id, etc. — so the original
--      `DELETE FROM profiles` step would itself fail with an FK violation on
--      any org that has ever created a single ticket, task, or comment.
--
-- Rather than hand-listing every org-scoped table (and having to remember to
-- extend this function every time a new one is added), this walks
-- information_schema for every public table with an org_id column and
-- deletes that org's rows from each, with session_replication_role=replica
-- so FK ordering/circular-reference checks don't need to be solved by hand.
-- auth.users rows are deliberately left alone (documented original intent —
-- only the profile row is removed, the auth account itself persists).
CREATE OR REPLACE FUNCTION owner_delete_org(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  r RECORD;
BEGIN
  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organization not found');
  END IF;

  SET LOCAL session_replication_role = replica;

  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'org_id' AND table_name <> 'organizations'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', r.table_name) USING p_org_id;
  END LOOP;

  DELETE FROM organizations WHERE id = p_org_id;

  SET LOCAL session_replication_role = DEFAULT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION owner_delete_org(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION owner_delete_org(uuid) FROM anon, authenticated;
