-- ── field_sla_overrides ─────────────────────────────────────────────
-- Field-value-level SLA overrides, one layer more specific than a service's own
-- sla_config. Lets two different values of the same intake-form dropdown field
-- (e.g. "Screen Repair" vs "Battery Replacement" under Hardware > Laptop Repair)
-- carry different SLA targets, edited from a single spreadsheet-style admin
-- screen (Request Configuration → Field SLA Matrix) that lists every
-- Service Group / Sub Group / Field / Option combination across the catalog.
--
-- Precedence at request-creation time (see lib/sla/resolve.ts):
--   field_sla_overrides (this table) > services.sla_config > global_sla_config.

CREATE TABLE field_sla_overrides (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id   UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  -- field_id / option_value identify the FormField.id and FormFieldOption.value inside
  -- services.form_sections (JSONB, not its own table) — no FK possible, snapshot the
  -- human-readable labels too so the matrix UI/reports don't need to re-parse form_sections
  -- for rows whose field/option was since renamed or archived.
  field_id     TEXT        NOT NULL,
  field_label  TEXT        NOT NULL,
  option_value TEXT        NOT NULL,
  option_label TEXT        NOT NULL,
  -- Same shape as services.sla_config: { low?, medium?, high?, urgent?: { response_hours, resolution_hours } }
  sla_config   JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (service_id, field_id, option_value)
);

CREATE INDEX idx_field_sla_overrides_service ON field_sla_overrides (service_id);
CREATE INDEX idx_field_sla_overrides_org     ON field_sla_overrides (org_id);

ALTER TABLE field_sla_overrides ENABLE ROW LEVEL SECURITY;

-- Any authenticated org member can read (request-creation SLA resolution runs as the
-- requester, not just admins — mirrors services.sla_config's own readability).
CREATE POLICY field_sla_overrides_select ON field_sla_overrides FOR SELECT
  USING (org_id = current_org_id());

-- Only admin/manager/platform_owner can configure the matrix.
CREATE POLICY field_sla_overrides_write ON field_sla_overrides FOR ALL
  USING (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('admin', 'manager', 'platform_owner'));

GRANT SELECT, INSERT, UPDATE, DELETE ON field_sla_overrides TO authenticated;

NOTIFY pgrst, 'reload schema';
