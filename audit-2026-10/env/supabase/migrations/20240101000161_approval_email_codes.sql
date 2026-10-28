-- D-060: the 6-digit code e-mailed to an approver is now RANDOM and SINGLE-USE, kept as a keyed hash with an expiry and an attempt
-- counter (before: derived from the clock, so the same code worked repeatedly for 10-15 minutes and could be recomputed by anyone
-- holding the signing secret). Only the server (service role) can read or write this table.

CREATE TABLE IF NOT EXISTS public.approval_email_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.approvals(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_email_codes_lookup_idx ON public.approval_email_codes (approval_id, approver_id, created_at DESC);

ALTER TABLE public.approval_email_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_email_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.approval_email_codes TO service_role;

NOTIFY pgrst, 'reload schema';
