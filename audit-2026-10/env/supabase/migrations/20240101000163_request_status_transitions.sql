-- D-023: the rules for which status a ticket may move to were enforced only in the application (lib/constants/request-transitions.ts), so a signed-in
-- user calling the API directly could, for example, close a ticket or reopen a cancelled one. The same rules are now also checked by the database,
-- for writes made as a signed-in user. The server's own writes (service role: auto-close, approvals, business rules, e-mail replies, cron) are unchanged.
--
-- What a signed-in user may do (everything the screens do on their behalf, nothing more):
--   open          -> assigned, in progress, cancelled
--   assigned      -> open (un-assign), in progress, cancelled
--   in progress   -> waiting on user, hold (purchase from HO), resolved, cancelled
--   waiting       -> in progress, resolved, open (requester reply), cancelled
--   hold          -> in progress
--   resolved      -> open (reopen)
--   pending approval, closed, cancelled -> nothing (only the server moves a ticket out of these)

CREATE OR REPLACE FUNCTION public.request_status_transition_allowed(p_from text, p_to text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_from = p_to OR (p_from, p_to) IN (
    ('open', 'assigned'), ('open', 'in_progress'), ('open', 'cancelled'),
    ('assigned', 'open'), ('assigned', 'in_progress'), ('assigned', 'cancelled'),
    ('in_progress', 'waiting_user'), ('in_progress', 'hold_purchase_ho'), ('in_progress', 'resolved'), ('in_progress', 'cancelled'),
    ('waiting_user', 'in_progress'), ('waiting_user', 'resolved'), ('waiting_user', 'open'), ('waiting_user', 'cancelled'),
    ('hold_purchase_ho', 'in_progress'),
    ('resolved', 'open')
  )
$function$;

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
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.request_status_transition_allowed(OLD.status::text, NEW.status::text) THEN
        RAISE EXCEPTION 'a ticket cannot move from % to % this way', OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
