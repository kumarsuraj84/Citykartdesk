-- Supersedes 20240101000133_profile_mobile_identity.sql's single-column,
-- 1:1 design. That migration explicitly argued against a separate mapping
-- table because "profiles is the source of truth" for a 1:1 phone<->person
-- relationship. That assumption no longer holds: a DESK "store" account
-- (see 20240101000128_store_master_and_oem_routing.sql -- "each store has
-- exactly one requester account", e.g. sm.alc@citykartstores.com) is a
-- SHARED login used by several real people's phones (2 managers + several
-- cashiers). Every one of those phones must resolve to the SAME profile.
-- This is a pure identity-resolution change: ticket creation, assignment,
-- SLA, and notifications in createRequestCore() are entirely unaffected --
-- only "which profile does this phone number belong to" changes from a
-- profiles column to a child table lookup.
--
-- whatsapp_enabled stays on profiles, NOT per-number: it is an account-level
-- "is this identity WhatsApp-eligible at all" toggle (see AC-2.5 in
-- tests/integration/stage2-mobile-identity.test.ts: "disabling
-- whatsapp_enabled does not touch mobile_number"). A store account with
-- several phones has one enable/disable switch, not one per phone --
-- matching how the business already thinks about it ("turn off WhatsApp
-- for this store"), and keeping resolveUserByWhatsAppNumber()'s
-- eligibility check unchanged in shape (still profile.is_active +
-- profile.whatsapp_enabled, just looked up via an extra hop instead of a
-- column read).

CREATE TABLE profile_mobile_numbers (
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mobile_number TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, mobile_number)
);

-- org_id is denormalized from profiles.org_id (never trust the FK alone in
-- application code -- every query still filters on org_id explicitly, same
-- philosophy as resolveWhatsAppUser.ts's doc comment). Required here
-- because the uniqueness rule -- a number may not identify two different
-- profiles in the SAME org, but MAY repeat across different orgs -- can't
-- be expressed as a plain unique index over a joined column.
--
-- This index is also the resolver's primary lookup path (WHERE org_id = ?
-- AND mobile_number = ?), and it guarantees resolveUserByWhatsAppNumber()
-- still gets AT MOST ONE profile_id back per (org, number): many rows may
-- now share a profile_id, but a given (org_id, mobile_number) pair still
-- appears in at most one row.
CREATE UNIQUE INDEX idx_profile_mobile_numbers_org_mobile_unique
  ON profile_mobile_numbers (org_id, mobile_number);

-- "All numbers for this profile" (the admin edit screen) is covered by the
-- primary key's leading column (profile_id, mobile_number) -- no extra
-- index needed.

-- Migrate every existing number across before dropping the column -- this
-- is a real deployed database, not a clean-slate table (unlike the
-- service_sub_category_tags precedent, which had no data to preserve).
INSERT INTO profile_mobile_numbers (profile_id, org_id, mobile_number)
SELECT id, org_id, mobile_number FROM profiles WHERE mobile_number IS NOT NULL;

ALTER TABLE profiles DROP COLUMN mobile_number;
-- whatsapp_enabled is untouched -- see rationale above.

-- Rows are only ever added/removed (never updated in place -- "change a
-- number" is modeled as remove+add), so no set_updated_at trigger is
-- needed here, unlike e.g. trg_stores_updated_at, which exists because
-- stores rows ARE updated in place.
ALTER TABLE profile_mobile_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_mobile_numbers_select" ON profile_mobile_numbers
  FOR SELECT USING (
    org_id = current_org_id() OR profile_id = auth.uid()
  );

-- All writes in application code go through createAdminClient() (service
-- role, bypasses RLS) -- see lib/actions/admin/users.ts -- so this ALL
-- policy exists as defense-in-depth only, matching the existing
-- service_sub_category_tags_admin precedent.
CREATE POLICY "profile_mobile_numbers_admin" ON profile_mobile_numbers
  FOR ALL USING (
    org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner')
  );

GRANT SELECT ON profile_mobile_numbers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_mobile_numbers TO authenticated;
GRANT ALL ON profile_mobile_numbers TO service_role;

NOTIFY pgrst, 'reload schema';
