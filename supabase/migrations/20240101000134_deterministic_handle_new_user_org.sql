-- Stage 3.2 — handle_new_user() picked a new profile's org via an UNORDERED
--   SELECT id FROM organizations LIMIT 1
-- (see migration 088). Postgres makes no guarantee about which row an
-- unordered LIMIT 1 returns once more than one row exists. Every cross-org
-- test fixture creates a second "Org B" for isolation testing; once enough
-- of those accumulate (e.g. via a fixture that fails to delete its own org
-- afterward — see the Stage 3.2 test-cleanup fixes in the same change as
-- this migration), a completely unrelated stray org can be returned instead
-- of the real seed org, silently reassigning subsequently-created test
-- users to the wrong tenant.
--
-- Confirmed this is safe to fix with a plain deterministic ORDER BY, not a
-- workaround masking a deeper issue, because:
--
--   1. No real application code path relies on handle_new_user()'s own pick.
--      inviteUser() and bulkCreateUsers() (lib/actions/admin/users.ts) both
--      create the auth user first (firing this trigger) and IMMEDIATELY
--      overwrite profiles.org_id with the correct, authoritative value (the
--      inviting admin's own org_id) via a follow-up UPDATE. This trigger's
--      pick is a transient placeholder in every real flow — never the value
--      that ends up persisted.
--   2. No better org source exists for the trigger to read instead: neither
--      inviteUserByEmail()'s nor createUser()'s call sites pass an org_id in
--      `data`/`user_metadata`, and there is no invitation-row mechanism
--      wired up anywhere in the app (org_signup_requests exists as a table
--      but has zero application code referencing it — unused/aspirational).
--   3. The app is asserted single-tenant in production (see migration 088's
--      own comment) — organizations are created once and never deleted in
--      any real workflow, so "oldest org" is a stable, permanent identifier
--      for the one real org, immune to however many newer test-only orgs
--      get created and destroyed around it.
--
-- ORDER BY created_at ASC, id ASC picks the oldest organization
-- (the original seed org is always the oldest row that will ever exist in a
-- real deployment) with a stable tie-breaker. This only changes behavior
-- for callers that never correct the value afterward — i.e. test fixtures
-- that create a user via the raw admin API and assume it lands in the seed
-- org — matching exactly the class of flakiness this stage fixes.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, org_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    (SELECT id FROM organizations ORDER BY created_at ASC, id ASC LIMIT 1)
  );
  RETURN NEW;
END;
$$;
