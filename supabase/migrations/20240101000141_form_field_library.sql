-- Field Library: org-wide, reusable form field definitions (e.g. "Contact
-- Number"). A template field links to one via form_templates.form_sections[].
-- fields[].library_field_id; the definition (label/type/placeholder/help/options)
-- lives here and is copied into every linked template on write by
-- lib/actions/admin/field-library.ts, so nothing that reads a template's
-- form_sections (request forms, validation, snapshots) has to change.
-- Requests keep storing answers under each template field's own id; reports
-- group by library_field_id to show one column per library field.

CREATE TABLE form_field_library (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  type         TEXT NOT NULL,
  placeholder  TEXT,
  help_text    TEXT,
  options      JSONB,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_form_field_library_org_label ON form_field_library (org_id, lower(label));
CREATE INDEX idx_form_field_library_org ON form_field_library (org_id) WHERE is_active;

CREATE TRIGGER set_form_field_library_updated_at
  BEFORE UPDATE ON form_field_library
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE form_field_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_field_library_select" ON form_field_library FOR SELECT USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager','platform_owner')
);
CREATE POLICY "form_field_library_admin" ON form_field_library FOR ALL USING (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager','platform_owner')
) WITH CHECK (
  org_id = current_org_id()
  AND current_user_role() IN ('admin','manager','platform_owner')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON form_field_library TO authenticated;
GRANT ALL ON form_field_library TO service_role;

NOTIFY pgrst, 'reload schema';
