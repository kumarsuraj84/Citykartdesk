-- 210: Report Builder / pivot speed. One function that returns, for every ticket of an organization, the five per-ticket numbers the report needs
-- (collaborators, live attachments, comments, tracked minutes, CSAT rating). Before this the app asked for them with about 100 tickets per request, once for each of
-- five tables: roughly 600 separate calls to the data service for 9,000 tickets. Now it is ONE call and the database does the counting.
-- Purely additive: a new read-only function, no table or row is changed. Only the server key can call it (same as the health functions). The app falls back to the
-- old way by itself if the function is missing, so the code can be deployed before or after this migration.
-- Same numbers as the old code: attachments exclude deleted ones; tracked minutes = the sum, over finished time entries, of each entry's minutes rounded to the nearest
-- whole minute (never below 0); the CSAT rating is the survey's rating when one was given.
-- The answer is ONE json value (a list of [ticket id, collaborators, attachments, comments, minutes, rating]) so the data service's 1000-rows-per-answer limit does not apply.
BEGIN;

DROP FUNCTION IF EXISTS public.report_request_aggregates(uuid);
CREATE OR REPLACE FUNCTION public.report_request_aggregates(p_org uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x.id, x.collaborators, x.attachments, x.comments, x.minutes, x.rating)), '[]'::jsonb)
    FROM (
      SELECT r.id,
             (SELECT count(*)::integer FROM public.request_collaborators c WHERE c.request_id = r.id) AS collaborators,
             (SELECT count(*)::integer FROM public.request_attachments a WHERE a.request_id = r.id AND a.deleted_at IS NULL) AS attachments,
             (SELECT count(*)::integer FROM public.request_comments m WHERE m.request_id = r.id) AS comments,
             (SELECT COALESCE(sum(GREATEST(0, round(EXTRACT(EPOCH FROM (t.stopped_at - t.started_at)) / 60.0))), 0)::integer
                FROM public.request_time_entries t WHERE t.request_id = r.id AND t.stopped_at IS NOT NULL) AS minutes,
             (SELECT s.rating::integer FROM public.csat_surveys s WHERE s.request_id = r.id AND s.rating IS NOT NULL ORDER BY s.id DESC LIMIT 1) AS rating
        FROM public.requests r
       WHERE r.org_id = p_org
    ) x;
$$;

REVOKE ALL ON FUNCTION public.report_request_aggregates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_request_aggregates(uuid) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
