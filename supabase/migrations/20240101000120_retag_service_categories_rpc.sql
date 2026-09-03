-- updateService()'s "replace all tags" pattern was delete-then-insert as two
-- separate client round trips with no transaction — if the insert failed
-- (including the exact unique-violation the service_sub_category_tags
-- exclusivity constraint exists to catch), the service was left with ZERO
-- tags: worse than either its old or its intended new state. Wrapping both
-- statements in one PL/pgSQL function makes them atomic (a single implicit
-- transaction) — a failed insert now rolls back the delete too, leaving the
-- service's tags exactly as they were before the call.
--
-- SECURITY INVOKER (the default) is deliberate: this must still go through
-- the caller's own RLS-scoped session, respecting the existing
-- service_sub_category_tags admin/org policy, not bypass it.
CREATE OR REPLACE FUNCTION retag_service_categories(p_service_id uuid, p_sub_category_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM service_sub_category_tags WHERE service_id = p_service_id;

  IF p_sub_category_ids IS NOT NULL AND array_length(p_sub_category_ids, 1) > 0 THEN
    INSERT INTO service_sub_category_tags (service_id, sub_category_id)
    SELECT p_service_id, sub_category_id FROM unnest(p_sub_category_ids) AS sub_category_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION retag_service_categories(uuid, uuid[]) TO authenticated;
