-- Remediation phase 2 (LOCAL). Rollback: supabase/rollback/168_must_change_password_enforced_rollback.sql
-- VAPT-003 / VAPT-005 (earlier D-011): a person who still has to choose their own password (a new account, or one an administrator reset) has no organisation and no
-- role in the eyes of row security until they have done so. The forced change used to be only a redirect in one page layout; a person who skipped the screens
-- (server actions, the data API) was never forced. Now nothing but the password-change flow works until the flag is cleared (by the server, after the change).

BEGIN;

CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active AND NOT coalesce(must_reset_password, false)
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active AND NOT coalesce(must_reset_password, false)
$function$;

COMMIT;
