-- 188: Vendor Programs - how one row (one machine) of the store's rows is written in the mail's {{details}} (additive only).
--  - vendor_programs.details_template: for example "{{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}, {{extra_cpcbgroup}}" gives "MAHINDRA 125 KVA, serial NDJZB11872, CPCB-II"
--    for every genset of the store, one line each, exactly as the built-in Genset mail writes them. Empty = the usual short wording.
BEGIN;

ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS details_template text;

COMMIT;
