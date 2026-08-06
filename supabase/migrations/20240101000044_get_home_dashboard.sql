-- Source-control the get_home_dashboard RPC that was previously deployed out-of-band.
--
-- Changes vs. original:
--   1. Computes team_id internally — removes the pre-query in home/page.tsx
--   2. Adds tasks_overdue / tasks_today / tasks_upcoming / tasks_open arrays
--      so the 4 separate task-row queries in home/page.tsx become redundant
--   3. All subqueries include explicit org_id = v_org_id (SECURITY DEFINER bypasses RLS)
--
-- Round-trips:
--   Before:  team_members (1) → rpc (1) → Promise.all tasks×4 (4) = 6 hops
--   After:   rpc (1) = 1 hop  (plus layout's own 2-hop chain, shared)

CREATE OR REPLACE FUNCTION get_home_dashboard(
  p_is_manager BOOLEAN DEFAULT FALSE,
  p_is_agent   BOOLEAN DEFAULT FALSE,
  p_team_id    UUID    DEFAULT NULL,   -- kept for backward-compat; computed internally
  p_has_tasks  BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID        := auth.uid();
  v_org_id    UUID;
  v_team_id   UUID;
  v_now       TIMESTAMPTZ := NOW();
  v_today     TIMESTAMPTZ := DATE_TRUNC('day', NOW());
  v_today_end TIMESTAMPTZ := v_today + INTERVAL '1 day' - INTERVAL '1 ms';
  v_week_end  TIMESTAMPTZ := v_today_end + INTERVAL '7 days';
  v_week_ago  TIMESTAMPTZ := v_today - INTERVAL '7 days';
BEGIN
  -- User context — one lookup, used everywhere below
  SELECT org_id INTO v_org_id FROM profiles WHERE id = v_uid;

  -- Team membership — computed once regardless of p_team_id parameter
  SELECT tm.team_id INTO v_team_id
  FROM   team_members tm
  JOIN   teams t ON t.id = tm.team_id
  WHERE  tm.user_id = v_uid AND t.org_id = v_org_id
  LIMIT  1;

  RETURN json_build_object(

    -- ── Scalar counts ────────────────────────────────────────────────────────
    'counts', json_build_object(
      'my_open', (
        SELECT COUNT(*) FROM requests
        WHERE  requester_id = v_uid AND org_id = v_org_id
          AND  status IN ('open','in_progress','pending_approval','waiting_user')
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
          AND  status NOT IN ('resolved','closed','cancelled')
      ) ELSE 0 END,
      'team_open', CASE WHEN p_is_manager AND v_team_id IS NOT NULL THEN (
        SELECT COUNT(*) FROM requests
        WHERE  team_id = v_team_id AND org_id = v_org_id
          AND  status IN ('open','in_progress','pending_approval','waiting_user')
      ) ELSE 0 END,
      'team_sla', CASE WHEN p_is_manager AND v_team_id IS NOT NULL THEN (
        SELECT COUNT(*) FROM requests
        WHERE  team_id = v_team_id AND org_id = v_org_id
          AND  resolution_due_at < v_now
          AND  status NOT IN ('resolved','closed','cancelled')
      ) ELSE 0 END,
      'tasks_open', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  status IN ('open','in_progress') AND parent_task_id IS NULL
      ) ELSE 0 END,
      'tasks_today', CASE WHEN p_has_tasks AND p_is_agent THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  assignee_id = v_uid AND org_id = v_org_id
          AND  due_date >= v_today AND due_date <= v_today_end
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
          AND  status = 'done' AND updated_at >= v_week_ago
      ) ELSE 0 END,
      'team_tasks_open', CASE WHEN p_has_tasks AND p_is_manager AND v_team_id IS NOT NULL THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  team_id = v_team_id AND org_id = v_org_id
          AND  status IN ('open','in_progress')
      ) ELSE 0 END,
      'team_tasks_overdue', CASE WHEN p_has_tasks AND p_is_manager AND v_team_id IS NOT NULL THEN (
        SELECT COUNT(*) FROM tasks
        WHERE  team_id = v_team_id AND org_id = v_org_id
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
          AND  r.status IN ('open','in_progress','pending_approval','waiting_user')
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
          AND  r.status IN ('open','in_progress','pending_approval','waiting_user')
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
          AND  t.due_date >= v_today AND t.due_date <= v_today_end
          AND  t.status NOT IN ('done','cancelled') AND t.parent_task_id IS NULL
        ORDER  BY t.priority
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
          AND  t.due_date > v_today_end AND t.due_date <= v_week_end
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
$$;

-- Allow authenticated users to call the function
GRANT EXECUTE ON FUNCTION get_home_dashboard(BOOLEAN, BOOLEAN, UUID, BOOLEAN) TO authenticated;
