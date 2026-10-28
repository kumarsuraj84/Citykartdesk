-- P2: push intake validation stats aggregation into Postgres.
--
-- getIntakeValidationStats() previously SELECTed every intake_reviews row (plus
-- nested message + classification joins) and aggregated in JS on every admin
-- Settings load — O(n) transfer + parse that becomes a problem as the table
-- grows. This function returns the finished aggregate as a single JSONB payload,
-- so the DB does the counting and only the summary crosses the wire.
--
-- SECURITY INVOKER + an explicit org filter: RLS still applies (defense in
-- depth), and the explicit org_id = current_org_id() predicate keeps it
-- index-friendly and tenant-scoped exactly like the RLS policies.

CREATE OR REPLACE FUNCTION intake_validation_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
WITH r AS (
  SELECT
    rv.id,
    rv.message_id,
    rv.suggested_type::text       AS suggested_type,
    rv.suggested_department       AS suggested_department,
    rv.suggested_confidence,
    rv.was_overridden,
    c.stage::text                 AS cls_stage,
    c.provider                    AS cls_provider,
    c.cost_microcents             AS cls_cost,
    (rv.state <> 'pending' AND rv.state <> 'in_review') AS is_reviewed,
    COALESCE(rv.suggested_confidence, 0)                AS conf
  FROM intake_reviews rv
  LEFT JOIN intake_classifications c ON c.id = rv.classification_id
  WHERE rv.org_id = current_org_id()
)
SELECT jsonb_build_object(
  'total',         (SELECT count(*)::int FROM r),
  'totalMessages', (SELECT count(*)::int FROM intake_messages WHERE org_id = current_org_id()),
  'reviewed',      (SELECT count(*)::int FROM r WHERE is_reviewed),
  'overrides',     (SELECT count(*)::int FROM r WHERE is_reviewed AND was_overridden),
  'overrideRate',  (
    SELECT CASE WHEN count(*) FILTER (WHERE is_reviewed) > 0
                THEN round(count(*) FILTER (WHERE is_reviewed AND was_overridden)::numeric
                           / count(*) FILTER (WHERE is_reviewed) * 100)::int
                ELSE 0 END
    FROM r
  ),
  'byType', (
    SELECT COALESCE(jsonb_object_agg(st, n), '{}'::jsonb)
    FROM (SELECT suggested_type AS st, count(*)::int AS n
          FROM r WHERE suggested_type IS NOT NULL GROUP BY suggested_type) t
  ),
  'byDepartment', (
    SELECT COALESCE(jsonb_object_agg(dept, n), '{}'::jsonb)
    FROM (SELECT suggested_department AS dept, count(*)::int AS n
          FROM r WHERE suggested_department IS NOT NULL GROUP BY suggested_department) t
  ),
  'byConfidence', jsonb_build_object(
    'low',    (SELECT count(*)::int FROM r WHERE conf < 40),
    'medium', (SELECT count(*)::int FROM r WHERE conf >= 40 AND conf < 70),
    'good',   (SELECT count(*)::int FROM r WHERE conf >= 70 AND conf < 90),
    'high',   (SELECT count(*)::int FROM r WHERE conf >= 90)
  ),
  'byStage', (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.total DESC), '[]'::jsonb)
    FROM (
      SELECT
        COALESCE(cls_stage, 'unknown')                      AS stage,
        (array_agg(cls_provider))[1]                        AS provider,
        count(*)::int                                       AS total,
        count(*) FILTER (WHERE is_reviewed)::int            AS reviewed,
        count(*) FILTER (WHERE is_reviewed AND was_overridden)::int AS overrides,
        CASE WHEN count(*) FILTER (WHERE is_reviewed) > 0
             THEN round(count(*) FILTER (WHERE is_reviewed AND was_overridden)::numeric
                        / count(*) FILTER (WHERE is_reviewed) * 100)::int
             ELSE 0 END                                     AS "overrideRate",
        round(avg(conf))::int                               AS "avgConfidence",
        round(COALESCE(sum(cls_cost), 0))::int              AS "totalCostMicrocents"
      FROM r
      GROUP BY COALESCE(cls_stage, 'unknown')
    ) s
  ),
  'sampleLow', (
    SELECT COALESCE(jsonb_agg(to_jsonb(sl)), '[]'::jsonb)
    FROM (
      SELECT r.id, r.message_id, m.subject, m.from_address,
             r.suggested_type, r.suggested_department, r.suggested_confidence
      FROM r JOIN intake_messages m ON m.id = r.message_id
      WHERE r.conf < 40
      ORDER BY r.suggested_confidence ASC NULLS FIRST
      LIMIT 5
    ) sl
  )
);
$$;

GRANT EXECUTE ON FUNCTION intake_validation_stats() TO authenticated;
