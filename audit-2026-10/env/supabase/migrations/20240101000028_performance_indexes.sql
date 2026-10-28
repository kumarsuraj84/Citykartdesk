-- ============================================================
-- Citykart Desk — Performance Indexes
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Requests indexes
CREATE INDEX IF NOT EXISTS idx_requests_assigned_status ON requests(assigned_to, status) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX IF NOT EXISTS idx_requests_requester_status ON requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_team_status ON requests(team_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_created_at_desc ON requests(created_at DESC);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='requests' AND column_name='sla_deadline') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_requests_sla_deadline ON requests(sla_deadline) WHERE status NOT IN (''resolved'',''cancelled'',''closed'')';
  END IF;
END $$;

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE status NOT IN ('done','cancelled');
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status) WHERE status NOT IN ('done','cancelled');

-- Collaboration / notifications / activity indexes
CREATE INDEX IF NOT EXISTS idx_request_collaborators_user ON request_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_request_activity_req ON request_activity(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, created_at DESC);

-- Full-text trigram search indexes
CREATE INDEX IF NOT EXISTS idx_requests_title_trgm ON requests USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_services_name_trgm ON services USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm ON profiles USING gin(full_name gin_trgm_ops);
