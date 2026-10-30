-- 193: Home dashboard numbers (audit findings F-04/D-03, D-02/F-02, F-05, D-16, F-34). Re-defines get_home_dashboard_core only (CREATE OR REPLACE: same signature, SECURITY DEFINER,
-- search_path and grants; the get_home_dashboard wrapper is untouched). Additive for the app: every key it returned before is still returned, with these differences:
--  - "today", "this week" and "overdue" are the INDIA day (Asia/Kolkata), whatever time zone the database session runs in (it used DATE_TRUNC('day', NOW()) in the session's own zone,
--    so on a server not set to India time "today" lagged by up to 12.5 hours). tasks.due_date is a plain date and is now compared as a date.
--  - sla_breached and team_sla no longer count tickets whose clock is stopped (waiting_user, hold_purchase_ho, pending_approval): they wait for somebody else and are not breached.
--  - new counts: my_queue_count (the technician's whole open queue; my_queue is only a preview of the newest 10) and tasks_overdue_total / tasks_today_total / tasks_upcoming_total /
--    tasks_no_due_total (the real size of each task list, which shows at most 6 rows).
--  - the "tasks due today" list is ordered highest priority first (it sorted low first).
--  - "tasks done this week" counts by the day the task was completed (completed_at), not by its last edit (updated_at).
-- Also adds the small table alert_claims (G-20, see below).
BEGIN;

CREATE OR REPLACE FUNCTION public.get_home_dashboard_core(p_is_manager boolean DEFAULT false, p_is_agent boolean DEFAULT false, p_team_id uuid DEFAULT NULL::uuid, p_has_tasks boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID        := auth.uid();
  v_org_id    UUID;
  v_team_ids  UUID[];
  v_now       TIMESTAMPTZ := NOW();
  -- "today" is the INDIA day whatever time zone this database session runs in; tasks.due_date is a plain date and is compared as a date
  v_today     DATE        := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
  v_week_end  DATE        := v_today + 7;
  -- the start of the India day seven days ago, as a moment (for "done this week")
  v_week_ago  TIMESTAMPTZ := (v_today - 7)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  -- User context — one lookup, used everywhere below
  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid;

  -- Team membership — every team the caller belongs to, not just one
  SELECT ARRAY_AGG(tm.team_id) INTO v_team_ids
  FROM   team_members tm
  JOIN   teams t ON t.id = tm.team_id
  WHERE  tm.user_id = v_uid AND t.org_id = v_org_id;

  RETURN json_build_object(

    -- ── Scalar counts ────────────────────────────────────────────────────────
    'counts', json_build_object(
      'my_open', (
        SELECT COUNT(*) FROM requests
        WHERE  requester_id = v_uid AND org_id = v_org_id
          AND  status IN ('open','assigned','in_progress','pending_approval','waiting_user','hold_purchase_ho')
      ),
      'resolved', (
        SELECT COUNT(*) FROM requests
        WHERE  requester_id = v_uid AND org_id = v_org_id AND status = 'resolved'
      ),
      'needs_attention', (
        SELECT COUNT(*) FROM requests
        WHERE  requester_id = v_uid AND org_id = v_org_id AND status = 'waiting_user'
      ),
      'pending_approvals', (
        SELECT COUNT(*)
        FROM   approvals a
        JOIN   approval_workflow_steps aws
               ON  aws.workflow_id = a.workflow_id
               AND aws.step_order  = a.current_step
        WHERE  a.status = 'pending'
          AND  (
            aws.approver_user_id = v_uid
            OR (aws.approver_type = 'any_manager' AND p_is_manager)
          )
      ),
      'sla_breached', CASE WHEN p_is_agent THEN (
        SELECT COUNT(*) FROM requests
        WHERE  assigned_to = v_uid AND org_id = v_org_id
          AND  resolution_due_at < v_now
          AND  status NOT IN ('resolved','closed','cancelled','waiting_user','hold_purchase_ho','pending_approval')
      ) ELSE 0 END,
      'my_queue_count', CASE WHEN p_is_agent THEN (
        SELECT COUNT(*) FROM requests
        WHERE  assigned_to = v_uid AND org_id = v_org_id
          AND  status IN ('open','assigned','in_progress','pending_approval','waiting_user','hold_purchase_ho')
      ) ELSE 0 END,
      'team_open', CASE WHEN p_is_manager AND v_team_ids IS NOT NULL THEN (
        SELECT COUNT(*) FROM requests
        WHERE  team_id = ANY(v_team_ids) AND org_id = v_org_id
          AND  status IN ('open','assigned','in_progress','pending_approval','waiting_user','hold_purchase_ho')
      ) ELSE 0 END,
      'team_sla', CASE WHEN p_is_manager AND v_team_ids IS NOT NULL THEN (
        SELECT COUNT(*) FROM requests
        WHERE  team_id = ANY(v_team_ids) AND org_id = v_org_id
          AND  resolution_due_at < v_now
          AND  status NOT IN ('resolved','closed','cancelled','waiting_user','hold_purchase_ho','pending_approval')
      ) ELSE 0 END,
      'tasks_open', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  status IN ('open','in_progress') AND parent_task_id IS NULL
      ) ELSE 0 END,
      'tasks_today', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  due_date = v_today
          AND  status NOT IN ('done','cancelled')
      ) ELSE 0 END,
      'tasks_overdue', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  due_date < v_today
          AND  status NOT IN ('done','cancelled')
      ) ELSE 0 END,
      'tasks_done_week', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  status = 'done' AND COALESCE(completed_at, updated_at) >= v_week_ago
      ) ELSE 0 END,
      'tasks_overdue_total', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date < v_today
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
      ) ELSE 0 END,
      'tasks_today_total', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date = v_today
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
      ) ELSE 0 END,
      'tasks_upcoming_total', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date > v_today AND t.due_date <= v_week_end
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
      ) ELSE 0 END,
      'tasks_no_due_total', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date IS NULL
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
      ) ELSE 0 END,
      'team_tasks_open', CASE WHEN p_has_tasks AND p_is_manager AND v_team_ids IS NOT NULL THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  team_id = ANY(v_team_ids) AND org_id = v_org_id
          AND  status IN ('open','in_progress')
      ) ELSE 0 END,
      'team_tasks_overdue', CASE WHEN p_has_tasks AND p_is_manager AND v_team_ids IS NOT NULL THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  team_id = ANY(v_team_ids) AND org_id = v_org_id
          AND  due_date < v_today
          AND  status NOT IN ('done','cancelled')
      ) ELSE 0 END
    ),

    -- ── Row arrays ───────────────────────────────────────────────────────────
    'my_requests', (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT r.id, r.request_no, r.title, r.status, r.priority,
               r.created_at, r.updated_at, r.resolution_due_at, r.response_due_at,
               CASE WHEN r.service_id IS NOT NULL THEN
                 (SELECT json_build_object('name', s.name, 'icon', s.icon)
                  FROM services s WHERE s.id = r.service_id)
               END AS service
        FROM   requests r
        WHERE  r.requester_id = v_uid AND r.org_id = v_org_id
          AND  r.status IN ('open','assigned','in_progress','pending_approval','waiting_user','hold_purchase_ho')
        ORDER  BY r.created_at DESC
        LIMIT  10
      ) r
    ),

    'needs_attention', (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT id, request_no, title, status, updated_at,
               resolution_due_at, response_due_at
        FROM   requests
        WHERE  requester_id = v_uid AND org_id = v_org_id AND status = 'waiting_user'
        ORDER  BY updated_at DESC
        LIMIT  10
      ) r
    ),

    'my_queue', CASE WHEN p_is_agent THEN (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT r.id, r.request_no, r.title, r.status, r.priority,
               r.created_at, r.resolution_due_at, r.response_due_at,
               (SELECT json_build_object('full_name', p.full_name)
                FROM profiles p WHERE p.id = r.requester_id) AS requester
        FROM   requests r
        WHERE  r.assigned_to = v_uid AND r.org_id = v_org_id
          AND  r.status IN ('open','assigned','in_progress','pending_approval','waiting_user','hold_purchase_ho')
        ORDER  BY r.created_at DESC
        LIMIT  10
      ) r
    ) ELSE '[]'::json END,

    -- ── Task item rows (agent + tasks enabled only) ───────────────────────────
    'tasks_overdue', CASE WHEN p_is_agent AND p_has_tasks THEN (
      SELECT COALESCE(json_agg(t), '[]'::json)
      FROM (
        SELECT t.id, t.title, t.status, t.priority, t.due_date,
               t.task_type, t.request_id,
               CASE WHEN t.request_id IS NOT NULL THEN
                 (SELECT json_build_object('request_no', r.request_no)
                  FROM requests r WHERE r.id = t.request_id)
               END AS request
        FROM   tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date < v_today
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
        ORDER  BY t.due_date ASC
        LIMIT  6
      ) t
    ) ELSE '[]'::json END,

    'tasks_today', CASE WHEN p_is_agent AND p_has_tasks THEN (
      SELECT COALESCE(json_agg(t), '[]'::json)
      FROM (
        SELECT t.id, t.title, t.status, t.priority, t.due_date,
               t.task_type, t.request_id,
               CASE WHEN t.request_id IS NOT NULL THEN
                 (SELECT json_build_object('request_no', r.request_no)
                  FROM requests r WHERE r.id = t.request_id)
               END AS request
        FROM   tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date = v_today
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
        ORDER  BY t.priority DESC, t.created_at
        LIMIT  6
      ) t
    ) ELSE '[]'::json END,

    'tasks_upcoming', CASE WHEN p_is_agent AND p_has_tasks THEN (
      SELECT COALESCE(json_agg(t), '[]'::json)
      FROM (
        SELECT t.id, t.title, t.status, t.priority, t.due_date,
               t.task_type, t.request_id,
               CASE WHEN t.request_id IS NOT NULL THEN
                 (SELECT json_build_object('request_no', r.request_no)
                  FROM requests r WHERE r.id = t.request_id)
               END AS request
        FROM   tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date > v_today AND t.due_date <= v_week_end
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
        ORDER  BY t.due_date ASC
        LIMIT  6
      ) t
    ) ELSE '[]'::json END,

    'tasks_open', CASE WHEN p_is_agent AND p_has_tasks THEN (
      SELECT COALESCE(json_agg(t), '[]'::json)
      FROM (
        SELECT t.id, t.title, t.status, t.priority, t.due_date,
               t.task_type, t.request_id,
               CASE WHEN t.request_id IS NOT NULL THEN
                 (SELECT json_build_object('request_no', r.request_no)
                  FROM requests r WHERE r.id = t.request_id)
               END AS request
        FROM   tasks t
        WHERE  t.assignee_id = v_uid AND t.org_id = v_org_id
          AND  t.due_date IS NULL
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
        ORDER  BY t.created_at DESC
        LIMIT  6
      ) t
    ) ELSE '[]'::json END

  );
END;
$function$;

-- One row per alert that a run of /api/alerts/run is sending (key = type + item + India day). The run that inserts the row owns the alert; a second run at the same time finds the row
-- already there (INSERT ... ON CONFLICT DO NOTHING) and skips it, so two overlapping runs can no longer both send. claimed_at is the DATABASE clock. Old rows are deleted by the job.
CREATE TABLE IF NOT EXISTS public.alert_claims (
  key        text PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.alert_claims TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
