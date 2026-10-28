-- handle_new_user() has never set org_id on the profile it creates — migration
-- 032 (multitenancy) added the column and did a one-time backfill for profiles
-- that existed AT THAT TIME, but every signup since then (including via the
-- Supabase Auth dashboard, the app's own /login flow if self-signup is ever
-- enabled, etc.) gets a profile with org_id = NULL. Every RLS policy in this
-- app is `org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())`, so a
-- NULL org_id silently returns zero rows everywhere — the user can log in but
-- every org-scoped page appears empty.
--
-- This app is genuinely single-tenant (see docs/ARCHITECTURE.md §0) — there is
-- always exactly one row in `organizations` — so the correct fix is to always
-- assign every new profile to that one org, not to require a manual backfill
-- per signup.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, org_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    (SELECT id FROM organizations LIMIT 1)
  );
  RETURN NEW;
END;
$$;

-- Catch anyone created between migration 032's one-time backfill and this fix
-- (e.g. an admin account created via the Supabase dashboard before this
-- shipped) — safe to run in any environment, a no-op once nothing is NULL.
UPDATE profiles SET org_id = (SELECT id FROM organizations LIMIT 1) WHERE org_id IS NULL;
