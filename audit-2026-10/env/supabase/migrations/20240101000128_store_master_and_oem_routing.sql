-- Store Master + OEM routing, for the "AC Issues Support" scenario: every
-- physical store gets its own address record (distinct from the coarse
-- HO/Stores/Warehouse `locations` category used for service visibility —
-- that stays untouched), a store can be assigned to one OEM (vendor), and an
-- OEM carries its own recipient email list + a customizable notification
-- email template. Since each store has exactly one requester account
-- (sm.<code>@citykartstores.com), routing is simply store -> OEM, not a
-- general rule engine — see lib/actions/requests.ts for how this fires.

CREATE TABLE oems (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  emails                 TEXT[] NOT NULL DEFAULT '{}',
  email_subject_template TEXT,
  email_body_template    TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oems_org ON oems(org_id);

CREATE TABLE stores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT,
  city       TEXT,
  state      TEXT,
  pincode    TEXT,
  oem_id     UUID REFERENCES oems(id) ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX idx_stores_org ON stores(org_id);
CREATE INDEX idx_stores_oem ON stores(oem_id) WHERE oem_id IS NOT NULL;

CREATE TRIGGER trg_oems_updated_at BEFORE UPDATE ON oems FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_stores_updated_at BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One physical store per requester account (see migration comment above) —
-- distinct from profiles.location_id (the broad HO/Stores/Warehouse
-- category used for service visibility).
ALTER TABLE profiles ADD COLUMN store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

-- Marks which service(s) get the fully-automatic OEM flow on ticket
-- creation: send the OEM email, post the system "sent to OEM" message, and
-- flip status straight to in_progress — skipping the normal manual "Start
-- Working" step. Only fires when the requester's store actually has an OEM
-- assigned; an unmapped store's ticket is raised normally with no
-- automation (see createRequest()).
ALTER TABLE services ADD COLUMN auto_oem_routing BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE oems ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oems_select" ON oems FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "oems_admin"  ON oems FOR ALL   USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager'));

CREATE POLICY "stores_select" ON stores FOR SELECT USING (org_id = current_org_id());
CREATE POLICY "stores_admin"  ON stores FOR ALL   USING (org_id = current_org_id() AND current_user_role() IN ('admin','manager'));

GRANT SELECT ON oems, stores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON oems, stores TO authenticated;
GRANT ALL ON oems, stores TO service_role;
