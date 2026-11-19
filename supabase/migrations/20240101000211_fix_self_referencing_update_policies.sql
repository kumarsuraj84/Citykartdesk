-- 211: fix "infinite recursion detected in policy for relation request_time_entries" (error 42P17).
--
-- Migration 167 made the UPDATE rules of request_time_entries and csat_surveys refuse to re-point a row at another ticket by comparing request_id with
-- "(SELECT request_id FROM <the same table> WHERE id = ...)". A rule that reads its OWN table is refused by Postgres as infinite recursion, so EVERY update of a time
-- entry made as a signed-in user failed (445 times between 30 Oct and 19 Nov: the technician's previous timer was not stopped when the status changed, so work time was overcounted).
--
-- The same protection is now done where it belongs: the rule only checks WHO owns the row, and a small trigger refuses to change request_id for a signed-in user (the same
-- way guard_attachment_client_write protects attachments). The server's own key (service_role) is not limited, as before.
-- Purely a rule/trigger change: no row of any table is touched. Safe to run while the app is live; restart the data service (CkDeskPostgrest) afterwards.

-- ── time entries ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS time_entries_update ON public.request_time_entries;
CREATE POLICY time_entries_update ON public.request_time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_time_entry_request_unchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'a time entry cannot be moved to another ticket' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_time_entry_request_unchanged ON public.request_time_entries;
CREATE TRIGGER trg_time_entry_request_unchanged
  BEFORE UPDATE ON public.request_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_time_entry_request_unchanged();

-- ── survey answers: the same pattern (a requester answers his own open survey, and cannot re-point it at another ticket) ────────────────────
DROP POLICY IF EXISTS csat_update_requester ON public.csat_surveys;
CREATE POLICY csat_update_requester ON public.csat_surveys FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() AND submitted_at IS NULL)
  WITH CHECK (requester_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_csat_request_unchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'a survey answer cannot be moved to another ticket' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_csat_request_unchanged ON public.csat_surveys;
CREATE TRIGGER trg_csat_request_unchanged
  BEFORE UPDATE ON public.csat_surveys
  FOR EACH ROW EXECUTE FUNCTION public.guard_csat_request_unchanged();

NOTIFY pgrst, 'reload schema';
