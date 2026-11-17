-- 196: Zoho -> CK Desk transfer, STAGE 1 (mapping + preview only). Additive: new tables only, nothing existing changes, and NO ticket is created by this migration.
-- The owner's basic mapping (Zoho -> CK Desk):
--     Template            -> Form Template zoho_map_templates   (also decides which fields can be mapped)
--     Template + Category -> Service       zoho_map_services    (key: template + category; category '' = the template's default)
--     Sub Category        -> Category      zoho_map_categories  (key: template + category + sub category)
--     Item                -> Sub Category  zoho_map_items       (key: template + category + sub category + item)
--     Requester, Technician -> person      zoho_map_people      (only the people who are not found automatically by e-mail / name)
--     Status              -> Status        zoho_map_values
--   plus zoho_map_fields: which Zoho field fills which field of the CK Desk service's form (extra, per Zoho template).
-- zoho_transfers is the list of Zoho tickets already moved (empty until stage 2). The Zoho database stays read-only, so the "moved" mark lives here.
-- Server key only: no grant and no policy for signed-in users (same pattern as 191). The screens check the administrator role themselves.
BEGIN;

CREATE TABLE IF NOT EXISTS public.zoho_map_templates (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  form_template_id  uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  updated_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_services (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template  text NOT NULL,
  zoho_category  text NOT NULL DEFAULT '',
  service_id     uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_categories (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  zoho_category     text NOT NULL DEFAULT '',
  zoho_subcategory  text NOT NULL DEFAULT '',
  category_id       uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category, zoho_subcategory)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_items (
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template     text NOT NULL,
  zoho_category     text NOT NULL DEFAULT '',
  zoho_subcategory  text NOT NULL DEFAULT '',
  zoho_item         text NOT NULL DEFAULT '',
  sub_category_id   uuid NOT NULL REFERENCES public.service_sub_categories(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_category, zoho_subcategory, zoho_item)
);

-- A person who could not be matched automatically, matched by hand. zoho_key is the Zoho e-mail in lower case, or the Zoho name in lower case when Zoho has no e-mail.
CREATE TABLE IF NOT EXISTS public.zoho_map_people (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('requester', 'technician')),
  zoho_key    text NOT NULL,
  zoho_name   text,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, zoho_key)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_fields (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_template  text NOT NULL,
  zoho_field     text NOT NULL,
  ck_field_id    text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, zoho_template, zoho_field)
);

CREATE TABLE IF NOT EXISTS public.zoho_map_values (
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('status')),
  zoho_value  text NOT NULL,
  ck_value    text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, zoho_value)
);

-- One row per Zoho ticket that has been moved. The Zoho ticket number is exactly the number Zoho shows (a whole number), so a ticket can never be moved twice.
CREATE TABLE IF NOT EXISTS public.zoho_transfers (
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zoho_ticket_no   bigint NOT NULL,
  request_id       uuid REFERENCES public.requests(id) ON DELETE SET NULL,
  request_no       text NOT NULL,
  state            text NOT NULL DEFAULT 'moved' CHECK (state IN ('moved', 'withdrawn')),
  moved_at         timestamptz NOT NULL DEFAULT now(),
  moved_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, zoho_ticket_no)
);
CREATE INDEX IF NOT EXISTS idx_zoho_transfers_request ON public.zoho_transfers (request_id);

ALTER TABLE public.zoho_map_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_people     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_fields     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_map_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_transfers      ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.zoho_map_templates  TO service_role;
GRANT ALL ON public.zoho_map_services   TO service_role;
GRANT ALL ON public.zoho_map_categories TO service_role;
GRANT ALL ON public.zoho_map_items      TO service_role;
GRANT ALL ON public.zoho_map_people     TO service_role;
GRANT ALL ON public.zoho_map_fields     TO service_role;
GRANT ALL ON public.zoho_map_values     TO service_role;
GRANT ALL ON public.zoho_transfers      TO service_role;

COMMIT;
