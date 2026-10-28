-- Form Templates: a reusable, named intake form that a Service can be tagged
-- to instead of building its own form from scratch. Live-reference model —
-- a tagged service's form is always resolved from the template's
-- form_sections at read time (see lib/forms/sections.ts's
-- resolveServiceFormSections()); editing the template updates every service
-- tagged to it immediately. Untagged services keep using their own
-- form_sections/form_fields exactly as before (template_id is nullable —
-- nothing existing is forced to migrate).

CREATE TABLE form_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  form_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_templates_org ON form_templates(org_id);
CREATE INDEX idx_form_templates_active ON form_templates(org_id) WHERE is_active = true;

CREATE TRIGGER set_form_templates_updated_at
  BEFORE UPDATE ON form_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE services ADD COLUMN template_id UUID REFERENCES form_templates(id) ON DELETE SET NULL;
CREATE INDEX idx_services_template ON services(template_id) WHERE template_id IS NOT NULL;

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

-- Mirrors services_select/services_admin's CURRENT live definitions (not the
-- original 20240101000033_org_isolation.sql text, which was later patched by
-- a since-run RBAC fix to add platform_owner — confirmed via
-- `pg_get_expr` against the live policy rather than the migration file) —
-- same org-scoped select-if-active-or-staff / admin-or-manager-write shape,
-- reusing the same SECURITY DEFINER helpers so this table's authorization
-- can never drift from services'.
CREATE POLICY "form_templates_select" ON form_templates FOR SELECT USING (
  org_id = current_org_id()
  AND (is_active = true OR current_user_role() IN ('admin','manager','platform_owner'))
);
CREATE POLICY "form_templates_admin" ON form_templates FOR ALL USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager','platform_owner')
);

-- Matches the exact grant set already on `services` (anon/authenticated/service_role
-- all hold table-level DML; RLS is the real gate) so this table isn't a silent
-- exception to that pattern.
GRANT SELECT ON form_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_templates TO authenticated;
GRANT ALL ON form_templates TO service_role;

NOTIFY pgrst, 'reload schema';
