-- 194: Ticket automation retry hardening + locking down the automation / program-PMS tables (additive only: new columns, one new partial index, grants tightened).
--  - expected_steps: which automatic steps (rules, mail to the OEM / vendor, CVM approval) the ticket was EXPECTED to have when it was made, written once at creation. The automatic
--    retry only ever retries steps that were expected then, so switching a program on later never mails vendors for tickets that came before. NULL = no record = never retried by itself.
--  - settled_at: the retry found nothing more it may do for this ticket (all fine, or nothing it is allowed to run); a settled ticket is not looked at again, so a growing pile of
--    healthy tickets can no longer keep newer broken ones from being examined.
--  - auto_checked_at: when the retry last LOOKED at the ticket (the tickets looked at least recently go first).
--  - running_since: ONE claim shared by the "Run automation again" button and the 15-minute job (a claim older than 10 minutes belongs to a run that died).
--  - mail_started_at: written just before the mail to the OEM / vendor is sent; still set with no mail recorded means "may or may not have gone out" (only a person runs it again).
-- Also: request_automation_state, program_pms_dates and program_pms_log are for the server's key only (they are not meant to be reachable by signed-in users, even to TRUNCATE).
-- A partial index finds the PMS ticket of a store and date quickly (so a PMS date whose ticket already exists is recognised instead of made twice).
BEGIN;

ALTER TABLE public.request_automation_state ADD COLUMN IF NOT EXISTS expected_steps  jsonb;
ALTER TABLE public.request_automation_state ADD COLUMN IF NOT EXISTS settled_at      timestamptz;
ALTER TABLE public.request_automation_state ADD COLUMN IF NOT EXISTS auto_checked_at timestamptz;
ALTER TABLE public.request_automation_state ADD COLUMN IF NOT EXISTS running_since   timestamptz;
ALTER TABLE public.request_automation_state ADD COLUMN IF NOT EXISTS mail_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_request_automation_state_retry
  ON public.request_automation_state (auto_checked_at NULLS FIRST, started_at DESC)
  WHERE settled_at IS NULL AND gave_up_at IS NULL;

-- the three tables are the server's only (row security on, no policy): no default grants to anyone else
REVOKE ALL ON public.request_automation_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.program_pms_dates        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.program_pms_log          FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.request_automation_state TO service_role;
GRANT ALL ON public.program_pms_dates        TO service_role;
GRANT ALL ON public.program_pms_log          TO service_role;

-- the PMS tickets (old AC PMS and program PMS) carry store_code / pms_date in source_metadata
CREATE INDEX IF NOT EXISTS idx_requests_pms_store_date
  ON public.requests ((source_metadata->>'store_code'), (source_metadata->>'pms_date'))
  WHERE source_metadata->>'pms_source' IS NOT NULL;

COMMIT;
