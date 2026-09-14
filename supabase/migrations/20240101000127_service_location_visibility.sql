-- Service Catalog visibility scoped by requester Location (HO / Stores /
-- Warehouse, etc. — the existing `locations` org-structure table). A service
-- with no location tags is visible to everyone (today's behavior, unchanged
-- for all existing services); a service tagged to one or more locations is
-- only shown to Requesters whose own profile.location_id matches one of the
-- tags. Mirrors service_sub_category_tags exactly, except — unlike category
-- tags — a location has no exclusivity constraint: many services can be
-- tagged to the same location, and one service can be tagged to several.

CREATE TABLE service_location_tags (
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, location_id)
);
CREATE INDEX idx_service_location_tags_location ON service_location_tags(location_id);

ALTER TABLE service_location_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_location_tags_select" ON service_location_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.org_id = current_org_id())
);
CREATE POLICY "service_location_tags_admin" ON service_location_tags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM services s
    WHERE s.id = service_id
      AND s.org_id = current_org_id()
      AND current_user_role() IN ('admin','manager','platform_owner')
  )
);

GRANT SELECT ON service_location_tags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_location_tags TO authenticated;
GRANT ALL ON service_location_tags TO service_role;

-- Same atomic replace-all pattern as retag_service_categories — a failed
-- insert rolls back the delete too, instead of leaving a service with zero
-- location tags (which would make it invisible to every Requester at once).
CREATE OR REPLACE FUNCTION retag_service_locations(p_service_id uuid, p_location_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM service_location_tags WHERE service_id = p_service_id;

  IF p_location_ids IS NOT NULL AND array_length(p_location_ids, 1) > 0 THEN
    INSERT INTO service_location_tags (service_id, location_id)
    SELECT p_service_id, location_id FROM unnest(p_location_ids) AS location_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION retag_service_locations(uuid, uuid[]) TO authenticated;
