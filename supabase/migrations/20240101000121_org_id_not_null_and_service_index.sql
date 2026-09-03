-- org_id was left nullable on these 15 tables from the original multi-tenancy
-- migration (added as a plain ALTER COLUMN with no NOT NULL, backfilled once,
-- but the SET NOT NULL step was never applied). Every RLS policy on these
-- tables gates on `org_id = current_org_id()` — a row with org_id IS NULL
-- silently fails that comparison and becomes invisible to everyone, with no
-- constraint violation to reveal the problem. All 15 verified to have zero
-- NULL org_id rows before this migration (checked directly against the
-- live data) — this only closes the door on it happening in the future,
-- e.g. via a service-role write or bulk import that bypasses the app's
-- normal insert path (and its BEFORE INSERT set_request_org_id trigger,
-- which only covers `requests`, not the other 14 tables).
ALTER TABLE profiles             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE requests             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tasks                ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE services             ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE service_categories   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE teams                ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE approval_workflows   ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE departments          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE locations            ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE cost_centers         ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE assignment_rules     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE alert_rules          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE tags                 ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE scheduled_reports    ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE task_templates       ALTER COLUMN org_id SET NOT NULL;

-- requests is the highest-volume, most-queried table in the app; service_id
-- is a NOT NULL FK with no covering index — any query/join filtering or
-- grouping by service (per-service reporting, SLA policy lookups, admin
-- service dashboards) forces a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_requests_service ON requests(service_id);
