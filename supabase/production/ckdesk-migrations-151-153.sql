-- Citykart Desk production database update: migrations 151, 152 and 153 in ONE file. Run as postgres on database ckdesk.
-- 151: csat_surveys.reminder_sent_at + index.  152: notification type csat_low_rating.  153: Home counts include Assigned tickets.
-- All three are additive and safe to run while the app is live. Re-running is harmless (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT).

-- ===== 20240101000151_csat_reminder_column =====
-- CSAT: remember when the one reminder e-mail was sent, so a requester is never reminded twice.
-- (Run by the database admin: csat_surveys is owned by postgres.)
ALTER TABLE csat_surveys ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- The reminder job looks for unrated surveys that are old enough and not yet reminded.
CREATE INDEX IF NOT EXISTS idx_csat_pending_reminder ON csat_surveys (sent_at) WHERE submitted_at IS NULL AND reminder_sent_at IS NULL;

-- ===== 20240101000152_add_csat_low_rating_notification =====
-- A requester rated a resolved ticket 1 or 2 stars: the technician group's lead and the technician are told.
-- Non-transactional: ADD VALUE must commit before the value can be used, so this stays its own file/statement
-- (same pattern as 20240101000148_add_hold_purchase_ho_status.sql).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'csat_low_rating';

-- ===== 20240101000153_get_home_dashboard_include_assigned =====
-- Fix get_home_dashboard (last redefined in 20240101000150): the "still open" status list left out 'assigned', so a ticket
-- that had been assigned to a technician but not yet started was missing from Home everywhere an open ticket is counted or
-- listed: the requester's "My open" and "My requests", the technician's "My queue", and the manager's "Team open".
-- (A ticket in Assigned is open work: the dashboards count it as open backlog.) Body is otherwise unchanged from 000150.
-- Run by the database admin (the function is owned by postgres).

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
  v_team_ids  UUID[];
  v_now       TIMESTAMPTZ := NOW();
  v_today     TIMESTAMPTZ := DATE_TRUNC('day', NOW());
  v_today_end TIMESTAMPTZ := v_today + INTERVAL '1 day' - INTERVAL '1 ms';
  v_week_end  TIMESTAMPTZ := v_today_end + INTERVAL '7 days';
  v_week_ago  TIMESTAMPTZ := v_today - INTERVAL '7 days';
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
          AND  status NOT IN ('resolved','closed','cancelled')
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

-- Function signature is unchanged, so the existing GRANT from 20240101000044
-- still applies — no need to re-grant.

-- ===== record the migrations =====
DO $$ BEGIN
  INSERT INTO auth.schema_migrations (version) VALUES ('20240101000151'), ('20240101000152'), ('20240101000153') ON CONFLICT DO NOTHING;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not record the versions in auth.schema_migrations (no permission); the changes themselves were applied.';
END $$;

-- ===== check =====
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='csat_surveys' AND column_name='reminder_sent_at') AS reminder_column,
       (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='notification_type' AND e.enumlabel='csat_low_rating') AS low_rating_type,
       (SELECT count(*) FROM auth.schema_migrations WHERE version IN ('20240101000151','20240101000152','20240101000153')) AS recorded;
