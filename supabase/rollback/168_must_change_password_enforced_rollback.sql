BEGIN;
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active $function$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active $function$;
DELETE FROM auth.schema_migrations WHERE version = '20240101000168';
COMMIT;
