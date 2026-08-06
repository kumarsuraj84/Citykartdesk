-- Fix: "Database error querying schema" on login.
--
-- Cause: owner_create_cognix_user inserts the admin directly into auth.users
-- via SQL. GoTrue (Supabase Auth, Go) cannot scan NULL values in the token
-- columns of auth.users — it expects empty strings. A raw INSERT that leaves
-- those columns NULL produces "Database error querying schema" the moment the
-- user tries to log in.
--
-- Run against the CognixDesk Supabase project (jhdzjzrimjjtqwnkrwha).

-- 1. Repair every existing user whose token columns are NULL.
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change               = COALESCE(email_change, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;

-- NOTE on recurrence prevention:
-- auth.users is owned by the internal supabase_auth_admin role, so you CANNOT
-- run `ALTER TABLE auth.users ... SET DEFAULT ''` from the SQL editor — it
-- fails with "42501: must be owner of table users". The only thing that runs
-- here is the UPDATE above (DML, not DDL).
--
-- The real recurrence fix is to patch owner_create_cognix_user so its raw
-- INSERT into auth.users sets the token columns to '' explicitly, e.g.:
--   confirmation_token, recovery_token, email_change, email_change_token_new,
--   email_change_token_current, phone_change, phone_change_token,
--   reauthentication_token  -> all '' (empty string), never NULL.
-- Until that function is patched, re-run the UPDATE above after creating a
-- new org admin through the owner portal.
