-- Business Rules: multi-select triggers + AND/OR condition combinator
--
-- Two follow-up requests after the initial Business Rules ship:
-- 1. A single rule can now fire on more than one trigger (e.g. Created AND
--    Edited) instead of requiring a near-duplicate rule per trigger type.
-- 2. Conditions can be combined with AND (all must match, the previous
--    implicit behaviour) or OR (any one match fires the rule).
--
-- The condition-field additions this session (form-field values, requester
-- department/location/designation/function) live inside the existing
-- `conditions` JSONB array and need no schema change.

ALTER TABLE business_rules DROP CONSTRAINT business_rules_trigger_check;
ALTER TABLE business_rules DROP CONSTRAINT business_rules_schedule_fields_check;

ALTER TABLE business_rules
  ALTER COLUMN trigger TYPE TEXT[] USING ARRAY[trigger]::text[];

ALTER TABLE business_rules
  ADD CONSTRAINT business_rules_trigger_check CHECK (
    trigger <@ ARRAY['created', 'updated', 'schedule']::text[]
    AND cardinality(trigger) > 0
  );

ALTER TABLE business_rules
  ADD CONSTRAINT business_rules_schedule_fields_check CHECK (
    ('schedule' = ANY(trigger)) = (schedule_check IS NOT NULL AND schedule_threshold IS NOT NULL)
  );

ALTER TABLE business_rules
  ADD COLUMN conditions_logic TEXT NOT NULL DEFAULT 'AND' CHECK (conditions_logic IN ('AND', 'OR'));

-- Old (org_id, trigger) btree no longer fits an array column — split into a
-- plain org_id index plus a GIN index for the `trigger @> ARRAY[...]`
-- containment queries lib/rules/run.ts and app/api/business-rules/run use.
DROP INDEX IF EXISTS idx_business_rules_org_trigger;
CREATE INDEX idx_business_rules_org_id ON business_rules (org_id) WHERE is_active;
CREATE INDEX idx_business_rules_trigger_gin ON business_rules USING GIN (trigger) WHERE is_active;

NOTIFY pgrst, 'reload schema';
