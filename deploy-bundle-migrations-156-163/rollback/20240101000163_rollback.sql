-- ROLLBACK for migration 163: puts back the migration-157 version of the request guard (number and creation time only) and removes the transition
-- function. LOCAL; NOT run on production.
CREATE OR REPLACE FUNCTION public.guard_request_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status NOT IN ('open', 'pending_approval')
         OR NEW.resolved_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.responded_at IS NOT NULL
         OR NEW.waiting_since IS NOT NULL OR NEW.assigned_to IS NOT NULL
         OR NEW.response_due_at IS NOT NULL OR NEW.resolution_due_at IS NOT NULL
         OR coalesce(NEW.paused_ms_total, 0) <> 0 OR coalesce(NEW.reopen_count, 0) <> 0 THEN
        RAISE EXCEPTION 'a new ticket can only be created as an open, unassigned ticket' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.request_no IS DISTINCT FROM OLD.request_no OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'a ticket number and creation time cannot be changed' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.request_status_transition_allowed(text, text);
NOTIFY pgrst, 'reload schema';
