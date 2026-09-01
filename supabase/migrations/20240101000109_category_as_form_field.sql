-- Category/Sub-category stop being structural placement for a service and
-- become a submission-time form field instead. A broad Service (e.g. "IT")
-- is now tagged to a SET of allowed sub-categories (many-to-many); the
-- requester picks one at submission time, captured directly on the request.
-- SLA moves from the service to the sub-category (set per-priority when
-- creating it), since that's now the more specific, meaningful unit.
--
-- Clean cutover, not a data migration — the local DB was just fully cleared
-- (all requests/services/categories/sub-categories) for exactly this
-- rebuild, so there is no existing services.category_id/sub_category_id
-- data to preserve.

ALTER TABLE services DROP COLUMN category_id;
ALTER TABLE services DROP COLUMN sub_category_id;

CREATE TABLE service_sub_category_tags (
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sub_category_id UUID NOT NULL REFERENCES service_sub_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, sub_category_id)
);
CREATE INDEX idx_service_sub_category_tags_sub_category ON service_sub_category_tags(sub_category_id);

ALTER TABLE service_sub_categories ADD COLUMN sla_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE requests ADD COLUMN category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN sub_category_id UUID REFERENCES service_sub_categories(id) ON DELETE SET NULL;
CREATE INDEX idx_requests_category ON requests(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_requests_sub_category ON requests(sub_category_id) WHERE sub_category_id IS NOT NULL;

ALTER TABLE service_sub_category_tags ENABLE ROW LEVEL SECURITY;

-- Mirrors sub_categories_select/sub_categories_admin_write's current (post-
-- 20240101000080) org-scoped shape, scoped via the tagged service's org_id
-- since this junction table has no org_id column of its own.
CREATE POLICY "service_sub_category_tags_select" ON service_sub_category_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.org_id = current_org_id())
);
CREATE POLICY "service_sub_category_tags_admin" ON service_sub_category_tags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM services s
    WHERE s.id = service_id
      AND s.org_id = current_org_id()
      AND current_user_role() IN ('admin','manager','platform_owner')
  )
);

GRANT SELECT ON service_sub_category_tags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_sub_category_tags TO authenticated;
GRANT ALL ON service_sub_category_tags TO service_role;

NOTIFY pgrst, 'reload schema';
