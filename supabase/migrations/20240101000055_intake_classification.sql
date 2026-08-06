-- ============================================================
-- Intake Intelligence — Phase C: classification layer + reviews
-- ============================================================
-- Provider-agnostic, multi-stage classification pipeline. Phase C ships Stage 1
-- (Rule Engine) only, but the schema is built so Stage 2 (local models) and
-- Stage 3 (premium AI) drop in with NO migration redesign — they write the same
-- intake_classifications shape and are turned on via intake_pipeline_config.
--
-- Dimensions classified: work type, department, category, subcategory, priority.
-- Priority uses the existing Cognix vocabulary (low/medium/high/urgent) so no
-- mapping is needed at Phase D conversion.
--
-- Reviews store SUGGESTED (engine snapshot) and FINAL (reviewer decision) values
-- separately for auditability and the future feedback loop.
--
-- Scope: CognixDesk only. HRMS untouched. Dark launch preserved (intake module
-- still disabled by default).
-- ============================================================

-- ── 1. Enums ─────────────────────────────────────────────────
CREATE TYPE intake_work_type AS ENUM ('request', 'task', 'approval', 'ignore');

-- Matches the existing request_priority vocabulary (low/medium/high/urgent).
CREATE TYPE intake_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TYPE intake_review_state AS ENUM
  ('pending', 'in_review', 'approved', 'rejected', 'converted');

-- Future stages already named so enabling them needs no enum migration.
CREATE TYPE intake_pipeline_stage AS ENUM
  ('rule', 'local_model', 'premium_ai', 'manual');

-- ── 2. intake_classifications (one row per stage attempt) ────
-- Provider-agnostic: rules now, local/premium models later write the same shape.
CREATE TABLE intake_classifications (
  id                    UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id            UUID                  NOT NULL REFERENCES intake_messages(id) ON DELETE CASCADE,
  stage                 intake_pipeline_stage NOT NULL,
  provider              TEXT                  NOT NULL,   -- 'rule_engine' | 'qwen2.5' | 'claude' | ...
  model_version         TEXT,                             -- 'ruleset@2026-06' | 'qwen2.5:7b' | ...
  suggested_type        intake_work_type,
  suggested_department  TEXT,                             -- canonical slug, nullable
  suggested_category    TEXT,                             -- canonical slug, nullable
  suggested_subcategory TEXT,                             -- canonical slug, nullable
  suggested_priority    intake_priority,
  confidence            INTEGER               NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  is_final              BOOLEAN               NOT NULL DEFAULT false,  -- the winning row for this message
  evidence              JSONB                 NOT NULL DEFAULT '{}',   -- rule matches | model output
  entities              JSONB                 NOT NULL DEFAULT '{}',   -- extracted hints (amounts/dates)
  rationale             TEXT,
  latency_ms            INTEGER,
  cost_microcents       INTEGER               NOT NULL DEFAULT 0,      -- 0 for rule/local; future billing
  created_at            TIMESTAMPTZ           NOT NULL DEFAULT now()
);

-- ── 3. intake_reviews (human triage; suggested vs final) ─────
CREATE TABLE intake_reviews (
  id                    UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID                  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id            UUID                  NOT NULL UNIQUE REFERENCES intake_messages(id) ON DELETE CASCADE,
  thread_id             UUID                  REFERENCES intake_threads(id) ON DELETE SET NULL,
  state                 intake_review_state   NOT NULL DEFAULT 'pending',
  assigned_reviewer_id  UUID                  REFERENCES profiles(id) ON DELETE SET NULL,
  classification_id     UUID                  REFERENCES intake_classifications(id) ON DELETE SET NULL,

  -- SUGGESTED — immutable snapshot of what the engine proposed (the is_final classification)
  suggested_type        intake_work_type,
  suggested_department  TEXT,
  suggested_category    TEXT,
  suggested_subcategory TEXT,
  suggested_priority    intake_priority,
  suggested_confidence  INTEGER,

  -- FINAL — the reviewer's decision (seeded from suggested, then editable)
  final_type            intake_work_type,
  final_department      TEXT,
  final_category        TEXT,
  final_subcategory     TEXT,
  final_priority        intake_priority,
  was_overridden        BOOLEAN               NOT NULL DEFAULT false,

  decision_notes        TEXT,
  reviewed_by           UUID                  REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,

  -- Phase D linkage (nullable soft refs, unused until D)
  created_request_id    UUID,
  created_task_id       UUID,
  created_approval_id   UUID,

  created_at            TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ           NOT NULL DEFAULT now()
);

-- ── 4. intake_pipeline_config (per-org; thresholds in data) ──
CREATE TABLE intake_pipeline_config (
  org_id      UUID        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  config      JSONB       NOT NULL,
  updated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Indexes ───────────────────────────────────────────────
CREATE INDEX idx_intake_class_message      ON intake_classifications (message_id, created_at DESC);
CREATE INDEX idx_intake_class_final        ON intake_classifications (message_id) WHERE is_final;
CREATE INDEX idx_intake_class_org_stage    ON intake_classifications (org_id, stage);
CREATE INDEX idx_intake_reviews_queue      ON intake_reviews (org_id, state, created_at DESC);
CREATE INDEX idx_intake_reviews_assignee   ON intake_reviews (org_id, assigned_reviewer_id, state);

-- ── 6. Row Level Security ────────────────────────────────────
ALTER TABLE intake_classifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_pipeline_config  ENABLE ROW LEVEL SECURITY;

-- Classifications: worker-written via service-role (bypasses RLS). Authenticated
-- reviewers get org-scoped SELECT only.
CREATE POLICY intake_class_select ON intake_classifications FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

-- Reviews: org-scoped SELECT for reviewers; UPDATE for reviewer/manager/admin.
-- INSERT is worker/service-role only (created when a message is classified).
CREATE POLICY intake_reviews_select ON intake_reviews FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_reviews_update ON intake_reviews FOR UPDATE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  )
  WITH CHECK (org_id = current_org_id());

-- Pipeline config: reviewers read; admins write.
CREATE POLICY intake_config_select ON intake_pipeline_config FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('agent', 'manager', 'admin', 'platform_owner')
  );

CREATE POLICY intake_config_upsert ON intake_pipeline_config FOR INSERT
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  );

CREATE POLICY intake_config_update ON intake_pipeline_config FOR UPDATE
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('admin', 'platform_owner')
  )
  WITH CHECK (org_id = current_org_id());

-- ── 7. Grants (RLS still applies; service-role bypasses) ─────
GRANT SELECT                  ON intake_classifications TO authenticated;
GRANT SELECT, UPDATE          ON intake_reviews         TO authenticated;
GRANT SELECT, INSERT, UPDATE  ON intake_pipeline_config TO authenticated;

-- ── 8. updated_at triggers ───────────────────────────────────
CREATE TRIGGER set_intake_reviews_updated_at
  BEFORE UPDATE ON intake_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_intake_pipeline_config_updated_at
  BEFORE UPDATE ON intake_pipeline_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 9. Seed a Stage-1-only pipeline config for every org ─────
-- Turning on Stage 2/3 later = flipping enabled:true here (a data write).
INSERT INTO intake_pipeline_config (org_id, config)
SELECT id, jsonb_build_object(
  'stages', jsonb_build_array(
    jsonb_build_object('stage','rule',        'provider','rule_engine','enabled', true,  'min_confidence', 0),
    jsonb_build_object('stage','local_model', 'provider','qwen2.5',    'enabled', false, 'min_confidence', 70),
    jsonb_build_object('stage','premium_ai',  'provider','claude',     'enabled', false, 'min_confidence', 70)
  ),
  'escalate_below_confidence', 70,
  'auto_accept_at_confidence', 90
)
FROM organizations
ON CONFLICT (org_id) DO NOTHING;
