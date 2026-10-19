-- 176: OEM engineer visit reports and the store's confirmation (AC visits / FSR / parts and PO). LOCAL ONLY until released. Safe to run twice.
-- Rollback: supabase/rollback/176_ac_visits_rollback.sql
--
-- An OEM engineer (no login) reports a visit on a public page with the store code and the store's daily visit code; the store then confirms per AC. All tables are
-- written and read by the server only (the screens check the person's role / store first), so no right is given to signed-in users or to the public.
-- Nothing here changes an existing table except the allowed kinds of the mail template table (a third template: the "send an engineer again" e-mail).
BEGIN;

ALTER TABLE public.master_mail_templates DROP CONSTRAINT IF EXISTS master_mail_templates_kind_check;
ALTER TABLE public.master_mail_templates ADD CONSTRAINT master_mail_templates_kind_check CHECK (kind IN ('ac', 'genset', 'revisit'));

-- How long the store has to answer before an engineer's "resolved" counts, and when the store is reminded (administrators change them).
CREATE TABLE IF NOT EXISTS public.ac_visit_settings (
  org_id            uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  auto_resolve_hours integer NOT NULL DEFAULT 48 CHECK (auto_resolve_hours BETWEEN 1 AND 720),
  reminder_hours     integer NOT NULL DEFAULT 24 CHECK (reminder_hours BETWEEN 1 AND 720),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One report = one visit filled in by an engineer on the public page.
CREATE TABLE IF NOT EXISTS public.ac_visit_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_code       text NOT NULL,
  engineer_name    text NOT NULL,
  engineer_mobile  text NOT NULL,
  visit_date       date NOT NULL,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  source_ip_hash   text,
  is_void          boolean NOT NULL DEFAULT false,
  void_reason      text,
  voided_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  voided_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ac_visit_reports_store ON public.ac_visit_reports (org_id, store_code, submitted_at DESC);

-- One item = the engineer's finding for one AC, and the store's answer to it.
CREATE TABLE IF NOT EXISTS public.ac_visit_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_id        uuid NOT NULL REFERENCES public.ac_visit_reports(id) ON DELETE CASCADE,
  store_code       text NOT NULL,
  ac_unit_id       uuid,
  ckdesk_no        text NOT NULL,
  ac_details       text,
  request_ids      uuid[] NOT NULL DEFAULT '{}',
  engineer_status  text NOT NULL CHECK (engineer_status IN ('resolved', 'not_resolved')),
  reason           text CHECK (reason IN ('come_again', 'parts_po', 'parts_oem', 'other')),
  parts            jsonb NOT NULL DEFAULT '[]',
  engineer_remarks text,
  fsr              jsonb NOT NULL DEFAULT '[]',
  store_status     text CHECK (store_status IN ('resolved', 'not_resolved')),
  store_remarks    text,
  store_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  store_decided_at timestamptz,
  outcome          text NOT NULL DEFAULT 'pending_store' CHECK (outcome IN ('pending_store', 'resolved_both', 'resolved_by_store', 'resolved_auto', 'disputed', 'open', 'void')),
  auto_resolve_at  timestamptz,
  reminder_sent_at timestamptz,
  oem_notified_at  timestamptz,
  oem_parts_note   text,
  po_number        text,
  po_date          date,
  po_vendor        text,
  po_status        text CHECK (po_status IN ('to_raise', 'raised', 'revisit_planned', 'done')),
  po_updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  po_updated_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ac_visit_items_store ON public.ac_visit_items (org_id, store_code, outcome);
CREATE INDEX IF NOT EXISTS idx_ac_visit_items_due ON public.ac_visit_items (auto_resolve_at) WHERE outcome = 'pending_store';
CREATE INDEX IF NOT EXISTS idx_ac_visit_items_po ON public.ac_visit_items (org_id, po_status) WHERE po_status IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ac_visit_settings', 'ac_visit_reports', 'ac_visit_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
