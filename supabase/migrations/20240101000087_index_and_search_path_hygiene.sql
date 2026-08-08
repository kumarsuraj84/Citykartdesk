-- Two hygiene fixes identified by a static-analysis audit (docs/AUDIT-2026-08-08.md §4,
-- §10 item 6). No behavior is user-visible; this closes two latent correctness/security
-- gaps that were never triggered in this environment's data volume.

-- ── 1. Two indexes were silently never "upgraded" ──────────────────────────────────────
-- `CREATE INDEX IF NOT EXISTS` only checks the index NAME, not its definition. Migrations
-- 028 and 043 tried to reuse an existing index's name to add a predicate/composite column,
-- which Postgres silently skipped since a same-named index already existed from migrations
-- 006 and 012 respectively. Drop and recreate both with their originally-intended
-- definitions.

DROP INDEX IF EXISTS idx_tasks_parent;
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;

DROP INDEX IF EXISTS idx_task_activity_task;
CREATE INDEX idx_task_activity_task ON task_activity(task_id, created_at DESC);

-- ── 2. Pin search_path on SECURITY DEFINER functions missing it ───────────────────────
-- Unpinned search_path on SECURITY DEFINER functions is a known Postgres privilege-
-- escalation vector (a caller-controlled search_path can shadow an unqualified identifier
-- with an object from a schema the caller controls). These three never had the pin, unlike
-- e.g. has_module_access() (migration 051), which is the correct pattern being applied here.

CREATE OR REPLACE FUNCTION is_team_member(p_team_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.team_id = p_team_id
      AND tm.user_id = auth.uid()
      AND t.org_id   = current_org_id()
  )
$$;

CREATE OR REPLACE FUNCTION is_request_collaborator(p_request_id UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM request_collaborators
    WHERE request_id = p_request_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION get_enabled_modules()
RETURNS module_slug[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_agg(module)
  FROM   org_module_access
  WHERE  org_id  = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND  enabled = true
    AND  (valid_until IS NULL OR valid_until > now());
$$;
