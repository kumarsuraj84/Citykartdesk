-- 187: Vendor Programs - the vendor portal and PO approval for a program (additive only; nothing existing changes).
--  - vendor_programs.resolution_options: the fixed list of resolutions the vendor chooses from when resolving a ticket of the program ("Other" is always offered in addition).
--  - vendor_programs.default_approver_ids: the program's own default PO approvers (used when the sheet row names nobody).
--  - vendor_programs.oem_number_required: the vendor must enter the OEM ticket number to start work (AC always needs it; a program decides for itself, now optional, later it can be made compulsory).
-- Who gets a ticket is decided in CK Desk only (Business Rules / Admin > Vendors): nothing from the Google Sheet is used to route a ticket to a vendor technician.
BEGIN;

ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS resolution_options text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS oem_number_required boolean NOT NULL DEFAULT false;
-- default_approver_ids: the Citykart people who decide a vendor's quote / PO of this program when its sheet row names no active approver (any one of them can decide). Each program has its own.
ALTER TABLE public.vendor_programs ADD COLUMN IF NOT EXISTS default_approver_ids uuid[] NOT NULL DEFAULT '{}';

COMMIT;
