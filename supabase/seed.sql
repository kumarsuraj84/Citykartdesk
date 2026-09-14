-- ============================================================
-- Citykart Desk — Seed Data (local development)
-- Single admin account only. No demo/onboarded users.
--
-- Trimmed 2026-09 to match a fresh production-bound reset: the sample
-- departments/teams/service catalog/approval workflows/KB articles that
-- had accumulated here were test/demo scaffolding, not real org
-- structure — running `supabase db reset` used to silently resurrect
-- that stale demo data on top of a deliberately-emptied database. Real
-- org structure (departments, teams, services, categories, etc.) is now
-- created fresh through the app itself (Admin → ...), not seeded here.
-- ============================================================

-- ============================================================
-- ADMIN ACCOUNT
-- Trigger handle_new_user creates the profile automatically.
-- We then elevate the role to platform_owner (full access).
-- ============================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '30000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'suraj@citykart.org',
  crypt('Welcome@citykart@123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Suraj"}',
  now(), now(),
  '', '', '', ''
);

UPDATE profiles SET role = 'platform_owner' WHERE id = '30000000-0000-0000-0000-000000000004';

-- ── Backfill org_id for the seeded admin profile ────────────────────────────
-- Migration 20240101000121 made org_id NOT NULL with no insert-time default;
-- the handle_new_user trigger may not set it, so it's backfilled here.
UPDATE profiles SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- ── Enable all modules for the default org ──────────────────────────────────────
INSERT INTO org_module_access (org_id, module, enabled)
SELECT '00000000-0000-0000-0000-000000000001', m.module::module_slug, true
FROM (VALUES ('tasks'), ('requests'), ('approvals'), ('services'), ('analytics'), ('time_tracking'), ('projects')) m(module)
ON CONFLICT (org_id, module) DO UPDATE SET enabled = true;

-- ── Default AI application patterns for DeskTime hour-splitting ────────────────
INSERT INTO ai_applications (org_id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Remote'),
  ('00000000-0000-0000-0000-000000000001', 'Claude'),
  ('00000000-0000-0000-0000-000000000001', 'Localhost'),
  ('00000000-0000-0000-0000-000000000001', 'Snooker'),
  ('00000000-0000-0000-0000-000000000001', 'WMS'),
  ('00000000-0000-0000-0000-000000000001', 'Sql')
ON CONFLICT (org_id, name) DO NOTHING;
