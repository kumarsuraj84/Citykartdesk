-- Fix: owner_create_cognix_user left six auth.users token columns NULL, which
-- causes GoTrue to fail with "Database error querying schema" on login.
--
-- The original only set confirmation_token and recovery_token to ''. GoTrue
-- (Go) also cannot scan NULL in email_change, email_change_token_new,
-- email_change_token_current, phone_change, phone_change_token and
-- reauthentication_token. This version sets all eight to ''.
--
-- Apply (CREATE OR REPLACE) against the Citykart Desk Supabase project
-- (jhdzjzrimjjtqwnkrwha). For users already created before this fix, also run
-- fix_auth_null_tokens.sql to repair their rows.

CREATE OR REPLACE FUNCTION public.owner_create_cognix_user(p_org_id uuid, p_full_name text, p_email text, p_password text, p_role text DEFAULT 'agent'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'extensions', 'public'
AS $function$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_now     timestamptz := now();
BEGIN
  IF p_role NOT IN ('user','manager','admin','agent') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Email already in use: %', p_email;
  END IF;
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id, 'authenticated', 'authenticated',
    lower(trim(p_email)),
    crypt(p_password, gen_salt('bf')),
    v_now, v_now, v_now,
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name),
    false,
    '', '',
    '', '', '',
    '', '', ''
  );
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', lower(trim(p_email))),
    'email', v_user_id::text, v_now, v_now, v_now
  );
  INSERT INTO public.profiles (id, org_id, full_name, role, is_active, created_at, updated_at)
  VALUES (v_user_id, p_org_id, p_full_name, p_role::user_role, true, v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET
    org_id = p_org_id, full_name = p_full_name,
    role = p_role::user_role, is_active = true, updated_at = v_now;
  RETURN v_user_id;
END;
$function$;
