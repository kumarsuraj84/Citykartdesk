-- 195: the Intake inbox list as ONE flat view (additive only: a new view, nothing existing changes).
-- The inbox page used to load up to 2000 messages with their FULL body text and joined reviews, and filter, sort and page them in the browser, so mail beyond
-- the newest 2000 silently disappeared and the folder counts were wrong. The page now asks the database for one page at a time. Every folder, the mailbox and
-- classifier filters, the search and the sort orders are plain conditions on this view's columns, and the one-line preview is cut in SQL (the full body never
-- leaves the database for the list).
-- security_invoker: the view runs with the rights of the person asking, so the row security of intake_messages / intake_reviews / intake_channels /
-- intake_classifications (own organisation, staff roles only) applies exactly as it did when the page read those tables directly.
BEGIN;

CREATE OR REPLACE VIEW public.intake_inbox_v WITH (security_invoker = true) AS
SELECT
  m.id,
  m.org_id,
  m.subject,
  m.from_address,
  m.to_addresses,
  m.received_at,
  m.status::text AS status,
  m.is_read,
  m.is_archived,
  m.thread_id,
  m.recipient_type,
  m.channel_id,
  left(btrim(regexp_replace(coalesce(m.body_text, ''), '\s+', ' ', 'g')), 160) AS snippet,
  c.name AS channel_name,
  c.type::text AS channel_type,
  r.id AS review_id,
  r.state::text AS review_state,
  r.suggested_type::text AS suggested_type,
  r.suggested_department,
  r.suggested_priority::text AS suggested_priority,
  r.suggested_confidence,
  r.is_starred,
  r.is_escalated,
  r.escalation_note,
  r.created_request_id,
  r.created_task_id,
  cl.stage::text AS stage,
  cl.provider AS provider,
  -- the "Priority (smart)" order: priority first, an escalated or starred message a little above its peers
  (CASE r.suggested_priority::text WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'low' THEN 1 ELSE 2 END) * 10
    + (CASE WHEN coalesce(r.is_escalated, false) THEN 5 ELSE 0 END)
    + (CASE WHEN coalesce(r.is_starred, false) THEN 2 ELSE 0 END) AS priority_score
FROM public.intake_messages m
LEFT JOIN public.intake_channels c ON c.id = m.channel_id
LEFT JOIN public.intake_reviews r ON r.message_id = m.id
LEFT JOIN public.intake_classifications cl ON cl.id = r.classification_id;

-- signed-in staff read it (row security of the tables underneath decides which rows); the public and anonymous visitors have no right to it
REVOKE ALL ON public.intake_inbox_v FROM PUBLIC, anon;
GRANT SELECT ON public.intake_inbox_v TO authenticated, service_role;

-- "Delete an organization" (owner_delete_org) deletes the organization's rows from every table that has an org_id column. This view has one too, and a view cannot be
-- deleted from, so the function stopped working. It now looks at real tables only (a view never holds data of its own). Everything else in it is unchanged.
CREATE OR REPLACE FUNCTION public.owner_delete_org(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  r RECORD;
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND NOT is_owner_org() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Organization not found');
  END IF;

  SET LOCAL session_replication_role = replica;

  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND c.table_name NOT IN ('organizations', 'system_log', 'system_log_archive')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', r.table_name) USING p_org_id;
  END LOOP;

  DELETE FROM organizations WHERE id = p_org_id;

  SET LOCAL session_replication_role = DEFAULT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_name);
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
