-- updateRequestFormData() (lib/actions/requests.ts) was merging form_data
-- client-side in JS: SELECT the current row -> spread the changed field(s)
-- onto a JS copy -> UPDATE the whole JSONB back. The sidebar's new
-- SubmittedFieldRow makes single-field saves a one-click action, so two
-- agents independently correcting two different fields on the same request
-- at close to the same time is now a real scenario — same class of bug as
-- field_sla_overrides (migration 099): whichever SELECT->UPDATE round trip
-- lands second clobbers the other with a stale snapshot, silently discarding
-- the first agent's edit. This makes the merge atomic — a single UPDATE using
-- the jsonb `||` concatenation operator, so Postgres's own row-level locking
-- serializes concurrent calls instead of one racing the other's read.

CREATE OR REPLACE FUNCTION merge_request_form_data(
  p_request_id UUID,
  p_patch      JSONB
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE requests
  SET form_data = coalesce(form_data, '{}'::jsonb) || p_patch
  WHERE id = p_request_id;
$$;

-- service_role-only, same convention as every other privileged RPC in this
-- schema (org_store_desktime_key, intake_store_credential, etc.) — never
-- granted to `authenticated`. Migration 103 found and closed exactly this gap
-- for upsert_field_sla_override(): a SECURITY DEFINER RPC granted to
-- `authenticated` with no internal auth check let any logged-in user call it
-- directly with an arbitrary target id. This function takes no org/team
-- scoping of its own — updateRequestFormData() in lib/actions/requests.ts
-- does the role/team-membership check in JS *before* calling it, and only
-- ever calls it via the service-role admin client, so it must stay
-- unreachable from the authenticated role entirely.
REVOKE ALL ON FUNCTION merge_request_form_data FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_request_form_data TO service_role;

NOTIFY pgrst, 'reload schema';
