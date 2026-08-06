-- ============================================================
-- Intake Intelligence — Phase E: org-authored custom rules
-- ============================================================
-- Lets an org admin define their own Stage-1 classification rules. These are
-- loaded by the worker and evaluated BEFORE the code-defined DEFAULT_RULES, and
-- they take precedence: a matching custom rule locks its dimension so a default
-- can't override it (see api/src/intake/classify/rule-classifier.ts).
--
-- Shape mirrors ClassificationRule (ruleset.ts): a keyword/regex match over a
-- chosen field, producing one or more output dimensions, with a 1–10 weight that
-- feeds confidence. Empty table → behaviour is identical to today (defaults only).

CREATE TABLE intake_rules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,                 -- human label for the UI
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Match (case-insensitive; phrases/addresses use substring, plain tokens use
  -- word boundary — same semantics as the code rules).
  match_field       TEXT        NOT NULL DEFAULT 'both'
                                CHECK (match_field IN ('subject', 'text', 'both', 'sender', 'all')),
  match_keywords    TEXT[]      NOT NULL DEFAULT '{}',
  match_regex       TEXT,

  -- Output dimensions (any subset). Type/priority constrained to the taxonomy;
  -- department/category/subcategory are free-form slugs.
  output_type       TEXT        CHECK (output_type IN ('request', 'task', 'approval', 'informational', 'ignore')),
  output_department TEXT,
  output_category   TEXT,
  output_subcategory TEXT,
  output_priority   TEXT        CHECK (output_priority IN ('low', 'medium', 'high', 'urgent')),

  weight            INT         NOT NULL DEFAULT 8 CHECK (weight BETWEEN 1 AND 10),

  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A rule is only meaningful if it can match something and output something.
  CONSTRAINT intake_rules_has_match  CHECK (array_length(match_keywords, 1) IS NOT NULL OR match_regex IS NOT NULL),
  CONSTRAINT intake_rules_has_output CHECK (
    output_type IS NOT NULL OR output_department IS NOT NULL OR output_category IS NOT NULL
    OR output_subcategory IS NOT NULL OR output_priority IS NOT NULL
  )
);

-- Worker loads enabled rules per org.
CREATE INDEX idx_intake_rules_org_enabled ON intake_rules (org_id) WHERE enabled;

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE intake_rules ENABLE ROW LEVEL SECURITY;

-- Reviewers read; admins write. Worker reads via service-role (bypasses RLS).
CREATE POLICY intake_rules_select ON intake_rules FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_rules_insert ON intake_rules FOR INSERT
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  );

CREATE POLICY intake_rules_update ON intake_rules FOR UPDATE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  )
  WITH CHECK (org_id = current_org_id());

CREATE POLICY intake_rules_delete ON intake_rules FOR DELETE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  );

-- ── Grants (RLS still applies; service-role bypasses) ────────
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_rules TO authenticated;
