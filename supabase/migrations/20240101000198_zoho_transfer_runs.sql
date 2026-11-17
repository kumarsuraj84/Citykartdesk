-- 198: Zoho -> CK Desk transfer, STAGE 3: one row per "move everything that matches these filters" run, so there is always a record of who moved how many tickets, when,
-- with which filters, and which tickets failed and why. Additive: one new table, nothing existing changes. Server key only (same pattern as 191 / 196).
BEGIN;

CREATE TABLE IF NOT EXISTS public.zoho_transfer_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  state        text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'finished', 'stopped')),
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  asked        integer NOT NULL DEFAULT 0,
  moved        integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  failures     jsonb NOT NULL DEFAULT '[]'::jsonb   -- the first 200 failures: [{ "no": 48213, "reason": "..." }]
);
CREATE INDEX IF NOT EXISTS idx_zoho_transfer_runs_org ON public.zoho_transfer_runs (org_id, started_at DESC);

ALTER TABLE public.zoho_transfer_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.zoho_transfer_runs TO service_role;

COMMIT;
