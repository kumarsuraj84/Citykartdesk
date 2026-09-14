-- Stage 2 (WhatsApp readiness) — identity-level mobile number on the User
-- Master. This is deliberately the ONLY place a WhatsApp sender number is
-- ever recorded — no separate whatsapp_users/whatsapp_mapping table. See
-- lib/users/mobile.ts for the shared normalizer every write path (Add User,
-- Edit User, bulk import) and the resolver both go through.
--
-- India-only for this stage (explicit product decision — Citykart currently
-- operates exclusively with Indian employee numbers; no country selector, no
-- E.164/international support). Canonical, single-source-of-truth format is
-- a bare 10-digit Indian mobile number, e.g. '9876543210' — no country code,
-- no leading zero, no '+', no separators. profiles.mobile_number stores
-- ONLY this canonical form; there is no separate raw/display column, since
-- one would always just duplicate the same 10 digits under this India-only
-- design (an earlier draft of this migration had a second
-- mobile_normalized column for that reason — dropped once the format was
-- narrowed to India-only, since it added a column with no distinct value).
--
-- whatsapp_enabled — capability toggle, independent of both is_active (the
-- normal DESK account) and mobile presence.
--
-- Nullable: every existing profile has no mobile number today, and Stage 2
-- must not force one onto every Citykart user — an employee with none simply
-- isn't WhatsApp-eligible yet (see the resolver's own eligibility rules).
-- whatsapp_enabled defaults to true (not false): it mirrors the same
-- "capability defaults on, but is inert until its real precondition is met"
-- pattern already used for form_field.requester_can_view/requester_can_set
-- (see lib/forms/sections.ts) — a profile with whatsapp_enabled=true and
-- mobile_number=NULL is not WhatsApp-eligible either way, so defaulting true
-- costs nothing and avoids a silent extra step ("also remember to flip this
-- on") for every future user who does get a mobile number.
ALTER TABLE profiles ADD COLUMN mobile_number TEXT;
ALTER TABLE profiles ADD COLUMN whatsapp_enabled BOOLEAN NOT NULL DEFAULT true;

-- A canonical mobile number must not identify more than one profile within
-- the same org (ambiguous WhatsApp identity otherwise) — but the same
-- number MAY recur across different orgs (each org's WhatsApp channel is
-- resolved to its own org_id before this table is ever consulted — see
-- resolveWhatsAppUser.ts's own doc comment). Partial (WHERE mobile_number IS
-- NOT NULL) so any number of profiles can continue to have no mobile number
-- at all without colliding on NULL. profiles.org_id is NOT NULL already
-- (migration 121), so no additional NULL-org_id handling is needed here.
CREATE UNIQUE INDEX idx_profiles_org_mobile_number_unique
  ON profiles (org_id, mobile_number)
  WHERE mobile_number IS NOT NULL;
