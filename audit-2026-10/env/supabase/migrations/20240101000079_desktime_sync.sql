-- ============================================================
-- DeskTime sync tables — ported from the org's own internal DeskTime
-- integration (same table shapes/columns), adapted to this app's org-scoped
-- RLS convention (current_org_id()/current_user_role() instead of a
-- separate user_roles table + is_admin()/is_manager() helpers).
--
-- All writes go through the admin (service-role) client from
-- lib/desktime/sync.ts and lib/actions/admin/desktime.ts — mirrors the
-- project_activity/retention_policies posture: authenticated gets SELECT
-- only, RLS never grants authenticated INSERT/UPDATE/DELETE here.
-- ============================================================

CREATE TABLE desktime_time_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_date             DATE        NOT NULL,
  project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
  desktime_project_id   TEXT        NOT NULL DEFAULT '',
  desktime_project_name TEXT        NOT NULL DEFAULT '',
  desktime_user_id      TEXT        NOT NULL DEFAULT '',
  member_name           TEXT        NOT NULL DEFAULT '',
  member_email          TEXT,
  minutes               INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_date, desktime_user_id, desktime_project_id)
);
CREATE INDEX idx_desktime_time_logs_project_date ON desktime_time_logs(project_id, work_date DESC);
CREATE INDEX idx_desktime_time_logs_org_date     ON desktime_time_logs(org_id, work_date DESC);

CREATE TABLE desktime_app_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_date        DATE        NOT NULL,
  desktime_user_id TEXT        NOT NULL DEFAULT '',
  member_name      TEXT        NOT NULL DEFAULT '',
  member_email     TEXT,
  app_name         TEXT        NOT NULL DEFAULT '',
  app_type         TEXT        NOT NULL DEFAULT '',
  productivity     TEXT        NOT NULL DEFAULT '',
  minutes          INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_date, desktime_user_id, app_name)
);
CREATE INDEX idx_desktime_app_logs_org_date ON desktime_app_logs(org_id, work_date DESC);

CREATE TABLE desktime_sync_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ran_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT        NOT NULL DEFAULT 'success',
  days_synced      INTEGER     NOT NULL DEFAULT 0,
  rows_upserted    INTEGER     NOT NULL DEFAULT 0,
  matched_projects INTEGER     NOT NULL DEFAULT 0,
  message          TEXT,
  triggered_by     TEXT        NOT NULL DEFAULT 'cron'
);
CREATE INDEX idx_desktime_sync_runs_org_ran ON desktime_sync_runs(org_id, ran_at DESC);

CREATE TABLE ai_applications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE desktime_project_map (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  desktime_key           TEXT        NOT NULL,
  desktime_project_name  TEXT        NOT NULL DEFAULT '',
  project_id             UUID        REFERENCES projects(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, desktime_key)
);

CREATE TRIGGER desktime_time_logs_set_updated_at    BEFORE UPDATE ON desktime_time_logs    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER desktime_app_logs_set_updated_at     BEFORE UPDATE ON desktime_app_logs     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ai_applications_set_updated_at       BEFORE UPDATE ON ai_applications       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER desktime_project_map_set_updated_at  BEFORE UPDATE ON desktime_project_map  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE desktime_time_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktime_app_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktime_sync_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_applications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktime_project_map  ENABLE ROW LEVEL SECURITY;

-- Individual tracked-time data is manager+ only (matches the sidebar's
-- DeskTime nav gating) — narrower than the org-wide SELECT posture used for
-- Requests/Tasks/Projects.
CREATE POLICY "desktime_time_logs_select"   ON desktime_time_logs   FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));
CREATE POLICY "desktime_app_logs_select"    ON desktime_app_logs    FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));
CREATE POLICY "desktime_sync_runs_select"   ON desktime_sync_runs   FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));
CREATE POLICY "ai_applications_select"      ON ai_applications      FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));
CREATE POLICY "desktime_project_map_select" ON desktime_project_map FOR SELECT USING (org_id = current_org_id() AND current_user_role() IN ('manager', 'admin', 'platform_owner'));

GRANT SELECT ON desktime_time_logs, desktime_app_logs, desktime_sync_runs, ai_applications, desktime_project_map TO authenticated;
GRANT ALL    ON desktime_time_logs, desktime_app_logs, desktime_sync_runs, ai_applications, desktime_project_map TO service_role;
