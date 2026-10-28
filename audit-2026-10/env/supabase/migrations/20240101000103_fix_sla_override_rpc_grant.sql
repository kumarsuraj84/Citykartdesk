-- upsert_field_sla_override() (migration 099) is SECURITY DEFINER — it bypasses
-- RLS on field_sla_overrides entirely — but was granted EXECUTE to `authenticated`
-- with no internal role/org check of its own, despite a comment claiming "the
-- function re-checks role membership" (it never did). Any logged-in user (any
-- role, any org) could call it directly via the Supabase client with an
-- arbitrary p_org_id and overwrite another org's SLA config.
--
-- The only legitimate caller is lib/actions/admin/sla-matrix.ts's
-- upsertFieldSlaOverride(), which already checks role in JS and invokes this
-- RPC exclusively via the service-role admin client — matching the existing
-- convention for every other privileged SECURITY DEFINER RPC in this schema
-- (org_store_desktime_key, org_read_desktime_key, intake_store_credential,
-- intake_read_credential — all service_role-only, never granted to
-- `authenticated`). Revoking the `authenticated` grant closes the hole without
-- touching the real (service-role) call path.
REVOKE EXECUTE ON FUNCTION upsert_field_sla_override FROM authenticated;

NOTIFY pgrst, 'reload schema';
