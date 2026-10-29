-- 190: Ticket automation - one small row per ticket that remembers how far the automatic steps of a NEW ticket got (additive only: one new table, nothing existing changes).
--  - started_at / finished_at: the server writes started_at when the ticket is made and finished_at when all its automatic steps (Business Rules, mail to the OEM / vendor,
--    CVM approval) have been tried. A ticket with started_at but no finished_at after a few minutes was interrupted (a restart, a deploy).
--  - rules_ran_at: the Business Rules of the "ticket created" trigger ran for this ticket.
--  - last_rerun_at / rerun_count / last_rerun_by: the "Run automation again" button (an administrator or platform owner); last_rerun_at also stops two clicks at once.
--  - auto_attempts / auto_last_at / gave_up_at: the automatic retry every 15 minutes (3 tries at most, then it gives up and the ticket shows in Admin > Stuck tickets).
-- Only the server's own key reads or writes it (row security on, no policy for signed-in users).
BEGIN;

CREATE TABLE IF NOT EXISTS public.request_automation_state (
  request_id     uuid PRIMARY KEY REFERENCES public.requests(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL DEFAULT now(),
  rules_ran_at   timestamptz,
  finished_at    timestamptz,
  last_rerun_at  timestamptz,
  last_rerun_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rerun_count    integer NOT NULL DEFAULT 0,
  auto_attempts  integer NOT NULL DEFAULT 0,
  auto_last_at   timestamptz,
  gave_up_at     timestamptz,
  last_result    jsonb
);
CREATE INDEX IF NOT EXISTS idx_request_automation_state_org ON public.request_automation_state (org_id, started_at DESC);

ALTER TABLE public.request_automation_state ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.request_automation_state TO service_role;   -- the server's key only (no grant, no policy for signed-in users)

COMMIT;
