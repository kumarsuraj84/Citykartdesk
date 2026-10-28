-- ============================================================
-- Citykart Desk — Initial Schema
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('user', 'manager', 'admin');

CREATE TYPE request_status AS ENUM (
  'pending_approval',
  'open',
  'assigned',
  'in_progress',
  'waiting_user',
  'resolved',
  'closed',
  'cancelled'
);

CREATE TYPE request_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TYPE task_type AS ENUM ('personal', 'team');

CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');

CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TYPE approval_decision_type AS ENUM ('approved', 'rejected');

CREATE TYPE approver_type AS ENUM ('specific_user', 'any_manager');

CREATE TYPE activity_action AS ENUM (
  'created',
  'assigned',
  'unassigned',
  'status_changed',
  'priority_changed',
  'resolved',
  'closed',
  'reopened',
  'cancelled',
  'approval_requested',
  'approved',
  'rejected',
  'comment_added'
);

CREATE TYPE notification_type AS ENUM (
  'request_assigned',
  'comment_added',
  'approval_requested',
  'approval_decided',
  'request_resolved',
  'request_closed',
  'task_assigned',
  'request_reopened'
);

-- ============================================================
-- SHARED TRIGGER: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE departments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE teams (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT    NOT NULL,
  slug               TEXT    NOT NULL UNIQUE,
  prefix             TEXT    NOT NULL UNIQUE
                             CHECK (prefix = upper(prefix) AND length(prefix) BETWEEN 2 AND 6),
  department_id      UUID    NOT NULL REFERENCES departments(id),
  notification_email TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROFILES (extends auth.users 1:1)
-- ============================================================
CREATE TABLE profiles (
  id         UUID      PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT      NOT NULL,
  avatar_url TEXT,
  role       user_role NOT NULL DEFAULT 'user',
  is_active  BOOLEAN   NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- TEAM MEMBERS
-- ============================================================
CREATE TABLE team_members (
  team_id   UUID    NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  user_id   UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_lead   BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX idx_team_members_user ON team_members(user_id);

-- ============================================================
-- SERVICE CATEGORIES
-- ============================================================
CREATE TABLE service_categories (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT    NOT NULL,
  slug       TEXT    NOT NULL UNIQUE,
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- APPROVAL WORKFLOWS
-- ============================================================
CREATE TABLE approval_workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- APPROVAL WORKFLOW STEPS
-- ============================================================
CREATE TABLE approval_workflow_steps (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      UUID          NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  step_order       INTEGER       NOT NULL,
  approver_type    approver_type NOT NULL,
  approver_user_id UUID          REFERENCES profiles(id) ON DELETE RESTRICT,
  UNIQUE (workflow_id, step_order),
  CONSTRAINT approver_ref_check CHECK (
    (approver_type = 'specific_user' AND approver_user_id IS NOT NULL) OR
    (approver_type = 'any_manager'   AND approver_user_id IS NULL)
  )
);

-- ============================================================
-- SERVICES
-- sla_config shape:
-- {
--   "low":    { "response_hours": 48, "resolution_hours": 120 },
--   "medium": { "response_hours": 24, "resolution_hours": 72  },
--   "high":   { "response_hours": 8,  "resolution_hours": 24  },
--   "urgent": { "response_hours": 2,  "resolution_hours": 8   }
-- }
-- form_fields shape: array of FieldDefinition objects
-- ============================================================
CREATE TABLE services (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT             NOT NULL,
  slug                 TEXT             NOT NULL UNIQUE,
  description          TEXT,
  icon                 TEXT,
  keywords             TEXT[]           NOT NULL DEFAULT '{}',
  category_id          UUID             NOT NULL REFERENCES service_categories(id),
  team_id              UUID             NOT NULL REFERENCES teams(id),
  form_fields          JSONB            NOT NULL DEFAULT '[]',
  default_priority     request_priority NOT NULL DEFAULT 'medium',
  sla_config           JSONB            NOT NULL DEFAULT '{}',
  approval_workflow_id UUID             REFERENCES approval_workflows(id) ON DELETE SET NULL,
  is_active            BOOLEAN          NOT NULL DEFAULT true,
  sort_order           INTEGER          NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_category  ON services(category_id) WHERE is_active = true;
CREATE INDEX idx_services_team      ON services(team_id)     WHERE is_active = true;
CREATE INDEX idx_services_keywords  ON services USING GIN(keywords);
CREATE INDEX idx_services_search    ON services USING GIN(
  to_tsvector('english', name || ' ' || coalesce(description, ''))
);

-- ============================================================
-- REQUEST SEQUENCES (atomic request_no generation)
-- ============================================================
CREATE TABLE request_sequences (
  prefix  TEXT    PRIMARY KEY,
  last_no INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION generate_request_no(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_no INTEGER;
BEGIN
  INSERT INTO request_sequences (prefix, last_no)
    VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE
    SET last_no = request_sequences.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN p_prefix || '-' || LPAD(v_no::TEXT, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION trg_assign_request_no()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  SELECT prefix INTO v_prefix FROM teams WHERE id = NEW.team_id;
  NEW.request_no := generate_request_no(v_prefix);
  RETURN NEW;
END;
$$;

-- ============================================================
-- REQUESTS
-- ============================================================
CREATE TABLE requests (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no           TEXT             NOT NULL UNIQUE,
  title                TEXT             NOT NULL,
  description          TEXT,
  requester_id         UUID             NOT NULL REFERENCES profiles(id),
  assigned_to          UUID             REFERENCES profiles(id),
  service_id           UUID             NOT NULL REFERENCES services(id),
  team_id              UUID             NOT NULL REFERENCES teams(id),
  priority             request_priority NOT NULL DEFAULT 'medium',
  status               request_status   NOT NULL DEFAULT 'open',
  form_data            JSONB            NOT NULL DEFAULT '{}',
  form_schema_snapshot JSONB            NOT NULL DEFAULT '[]',
  -- SLA tracking
  response_due_at      TIMESTAMPTZ,
  resolution_due_at    TIMESTAMPTZ,
  responded_at         TIMESTAMPTZ,
  -- Lifecycle timestamps
  resolved_at          TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_requests_assign_no
  BEFORE INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION trg_assign_request_no();

CREATE INDEX idx_requests_requester      ON requests(requester_id);
CREATE INDEX idx_requests_assigned       ON requests(assigned_to);
CREATE INDEX idx_requests_team           ON requests(team_id);
CREATE INDEX idx_requests_status         ON requests(status);
CREATE INDEX idx_requests_priority       ON requests(priority);
CREATE INDEX idx_requests_created        ON requests(created_at DESC);
CREATE INDEX idx_requests_team_status    ON requests(team_id, status);
CREATE INDEX idx_requests_response_due   ON requests(response_due_at)
  WHERE status NOT IN ('resolved', 'closed', 'cancelled');
CREATE INDEX idx_requests_resolution_due ON requests(resolution_due_at)
  WHERE status NOT IN ('resolved', 'closed', 'cancelled');

-- ============================================================
-- REQUEST COMMENTS
-- ============================================================
CREATE TABLE request_comments (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID    NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id   UUID    NOT NULL REFERENCES profiles(id),
  body        TEXT    NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_comments_request ON request_comments(request_id, created_at);

-- ============================================================
-- REQUEST ACTIVITY (append-only audit log)
-- ============================================================
CREATE TABLE request_activity (
  id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID            NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id   UUID            REFERENCES profiles(id),
  action     activity_action NOT NULL,
  metadata   JSONB           NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_activity_request ON request_activity(request_id, created_at);

-- ============================================================
-- APPROVALS
-- ============================================================
CREATE TABLE approvals (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID            NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  workflow_id  UUID            NOT NULL REFERENCES approval_workflows(id),
  current_step INTEGER         NOT NULL DEFAULT 1,
  status       approval_status NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_request ON approvals(request_id);

-- ============================================================
-- APPROVAL DECISIONS
-- ============================================================
CREATE TABLE approval_decisions (
  id          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID                  NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  step_order  INTEGER               NOT NULL,
  decided_by  UUID                  NOT NULL REFERENCES profiles(id),
  decision    approval_decision_type NOT NULL,
  comment     TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (approval_id, step_order)
);

CREATE INDEX idx_approval_decisions_approval ON approval_decisions(approval_id);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE tasks (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT          NOT NULL,
  description  TEXT,
  task_type    task_type     NOT NULL DEFAULT 'personal',
  team_id      UUID          REFERENCES teams(id),
  assignee_id  UUID          REFERENCES profiles(id),
  created_by   UUID          NOT NULL REFERENCES profiles(id),
  request_id   UUID          REFERENCES requests(id) ON DELETE SET NULL,
  priority     task_priority NOT NULL DEFAULT 'medium',
  status       task_status   NOT NULL DEFAULT 'open',
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_task_needs_team CHECK (task_type = 'personal' OR team_id IS NOT NULL)
);

CREATE INDEX idx_tasks_assignee   ON tasks(assignee_id);
CREATE INDEX idx_tasks_team       ON tasks(team_id);
CREATE INDEX idx_tasks_created_by ON tasks(created_by);
CREATE INDEX idx_tasks_status     ON tasks(status);
CREATE INDEX idx_tasks_request    ON tasks(request_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID              NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT              NOT NULL,
  body       TEXT,
  request_id UUID              REFERENCES requests(id)  ON DELETE SET NULL,
  task_id    UUID              REFERENCES tasks(id)     ON DELETE SET NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- ============================================================
-- APP SETTINGS
-- ============================================================
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES ('auto_close_days', '7');

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teams', 'profiles', 'service_categories', 'approval_workflows',
    'services', 'requests', 'approvals', 'tasks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================
-- RLS HELPER FUNCTIONS (SECURITY DEFINER — avoids RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_agent()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members WHERE user_id = auth.uid()
  )
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- departments
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_read" ON departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "departments_write" ON departments
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teams_read" ON teams
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_write" ON teams
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id AND
    -- Prevent self role escalation: new role must equal current role unless admin
    (role = current_user_role() OR current_user_role() = 'admin')
  );

-- team_members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_members_read" ON team_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_members_write" ON team_members
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- service_categories
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_categories_read" ON service_categories
  FOR SELECT TO authenticated
  USING (is_active = true OR current_user_role() = 'admin');
CREATE POLICY "service_categories_write" ON service_categories
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- approval_workflows
ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_workflows_read" ON approval_workflows
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "approval_workflows_write" ON approval_workflows
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- approval_workflow_steps
ALTER TABLE approval_workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_workflow_steps_read" ON approval_workflow_steps
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "approval_workflow_steps_write" ON approval_workflow_steps
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- services
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services_read" ON services
  FOR SELECT TO authenticated
  USING (is_active = true OR current_user_role() = 'admin');
CREATE POLICY "services_write" ON services
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- request_sequences (managed by security definer function only)
ALTER TABLE request_sequences ENABLE ROW LEVEL SECURITY;

-- requests
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "requests_select" ON requests
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR is_team_member(team_id)
    OR current_user_role() IN ('manager', 'admin')
  );
CREATE POLICY "requests_insert" ON requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());
CREATE POLICY "requests_update" ON requests
  FOR UPDATE TO authenticated
  USING (
    is_team_member(team_id)
    OR current_user_role() IN ('manager', 'admin')
  );

-- request_comments
ALTER TABLE request_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "request_comments_select" ON request_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
      AND (
        r.requester_id = auth.uid()
        OR is_team_member(r.team_id)
        OR current_user_role() IN ('manager', 'admin')
      )
    )
    AND (
      is_internal = false
      OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
      OR current_user_role() IN ('manager', 'admin')
    )
  );
CREATE POLICY "request_comments_insert" ON request_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
      AND (
        r.requester_id = auth.uid()
        OR is_team_member(r.team_id)
        OR current_user_role() IN ('manager', 'admin')
      )
    )
    AND (
      is_internal = false
      OR is_team_member((SELECT team_id FROM requests WHERE id = request_id))
      OR current_user_role() IN ('manager', 'admin')
    )
  );

-- request_activity (read by request participants; writes via admin client only)
ALTER TABLE request_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "request_activity_select" ON request_activity
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
      AND (
        r.requester_id = auth.uid()
        OR is_team_member(r.team_id)
        OR current_user_role() IN ('manager', 'admin')
      )
    )
  );

-- approvals
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvals_select" ON approvals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_id
      AND (
        r.requester_id = auth.uid()
        OR is_team_member(r.team_id)
        OR current_user_role() IN ('manager', 'admin')
      )
    )
  );

-- approval_decisions (read by participants; writes via admin client)
ALTER TABLE approval_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_decisions_select" ON approval_decisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM approvals a
      JOIN requests r ON r.id = a.request_id
      WHERE a.id = approval_id
      AND (
        r.requester_id = auth.uid()
        OR is_team_member(r.team_id)
        OR current_user_role() IN ('manager', 'admin')
      )
    )
  );

-- tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_select" ON tasks
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND is_team_member(team_id))
    OR current_user_role() IN ('manager', 'admin')
  );
CREATE POLICY "tasks_insert" ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "tasks_update" ON tasks
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (task_type = 'team' AND is_team_member(team_id))
    OR current_user_role() IN ('manager', 'admin')
  );

-- notifications (own only)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_update" ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_write" ON app_settings
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- ============================================================
-- POSTGREST GRANTS
-- Required for Supabase REST API (PostgREST) to access tables.
-- RLS policies control row-level access; these grants control
-- table-level access for the PostgREST roles.
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

GRANT SELECT ON departments, teams, service_categories, services TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  profiles, team_members, requests, request_comments,
  request_activity, approvals, approval_decisions, tasks,
  notifications, approval_workflows, approval_workflow_steps,
  request_sequences, app_settings TO authenticated;

GRANT SELECT ON departments, teams, service_categories, services TO authenticated;
