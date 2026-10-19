-- Rollback of 20240101000176_ac_visits.sql: removes the visit tables (the tickets, their comments and attachments are not touched) and the third mail template.
BEGIN;
DROP TABLE IF EXISTS public.ac_visit_items;
DROP TABLE IF EXISTS public.ac_visit_reports;
DROP TABLE IF EXISTS public.ac_visit_settings;
DELETE FROM public.master_mail_templates WHERE kind = 'revisit';
ALTER TABLE public.master_mail_templates DROP CONSTRAINT IF EXISTS master_mail_templates_kind_check;
ALTER TABLE public.master_mail_templates ADD CONSTRAINT master_mail_templates_kind_check CHECK (kind IN ('ac', 'genset'));
COMMIT;
