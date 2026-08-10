-- ── Business Rules engine (Requests) ────────────────────────────────────────
-- Consolidates three narrow, single-purpose rule systems (Routing Rules /
-- assignment_rules, SLA Escalation Rules / sla_escalation_rules, and the
-- request-scoped slice of Alert Rules / alert_rules) into one generic
-- trigger -> conditions -> actions engine, modeled on ManageEngine
-- ServiceDesk Plus's "Business Rules" screen. See lib/rules/*.ts for the
-- evaluation engine and app/(app)/admin/business-rules for the admin UI.
--
-- assignment_rules/sla_escalation_rules/alert_rules are NOT dropped by this
-- migration — they stay in place, unused once the app code is rewired, as a
-- rollback path (same precedent as global_sla_config this session).

CREATE TABLE business_rules (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  description       TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  trigger           TEXT        NOT NULL CHECK (trigger IN ('created', 'updated', 'schedule')),
  -- schedule-trigger params — null for created/updated rules
  schedule_check     TEXT       CHECK (schedule_check IN ('sla_pct_elapsed', 'unassigned_minutes')),
  schedule_threshold NUMERIC,
  -- [{field, operator, value}], ANDed — see lib/rules/evaluate.ts
  conditions        JSONB       NOT NULL DEFAULT '[]',
  -- [{type, params}], executed in array order — see lib/rules/actions.ts
  actions           JSONB       NOT NULL DEFAULT '[]',
  execution_order   INT         NOT NULL DEFAULT 0,
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_rules_schedule_fields_check CHECK (
    (trigger = 'schedule') = (schedule_check IS NOT NULL AND schedule_threshold IS NOT NULL)
  )
);

CREATE INDEX idx_business_rules_org_trigger ON business_rules (org_id, trigger) WHERE is_active;

-- Dedupe table for schedule-triggered rules — mirrors sla_escalation_events
-- exactly (one firing per rule+request, checked before each action executes).
CREATE TABLE business_rule_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     UUID        NOT NULL REFERENCES business_rules(id) ON DELETE CASCADE,
  request_id  UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  fired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, request_id)
);

CREATE INDEX idx_business_rule_events_request ON business_rule_events (request_id);

ALTER TABLE business_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_rule_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_rules_select ON business_rules FOR SELECT
  USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));

CREATE POLICY business_rules_write ON business_rules FOR ALL
  USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'))
  WITH CHECK (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));

-- business_rule_events is an internal firing log written only by the schedule
-- cron (service-role) — admins can read it (e.g. future "last fired" display)
-- but never write it directly, mirroring admin_audit_log's insert-denied
-- pattern for authenticated.
CREATE POLICY business_rule_events_select ON business_rule_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_rules r
      WHERE r.id = business_rule_events.rule_id
        AND r.org_id = current_org_id()
        AND current_user_role() IN ('manager', 'admin', 'platform_owner')
    )
  );

CREATE POLICY business_rule_events_no_insert ON business_rule_events AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

-- Table-level grants for BOTH roles — a table created after migration 0 gets
-- no implicit service_role access (that's the exact bug fixed in migration
-- 093), so this migration grants both explicitly instead of repeating it.
GRANT SELECT, INSERT, UPDATE, DELETE ON business_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_rules TO service_role;
GRANT SELECT ON business_rule_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_rule_events TO service_role;

-- Generic notification type for business-rule `notify` actions that don't map
-- to an existing specific type (assign/priority/status actions reuse the
-- existing request_assigned/priority_changed/status_changed types instead).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'business_rule_notification';

NOTIFY pgrst, 'reload schema';
