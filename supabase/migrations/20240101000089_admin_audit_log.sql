-- ── admin_audit_log ─────────────────────────────────────────────
-- Generic, append-only audit trail for admin-configuration events (service
-- catalog create/update/archive/delete, category create/update/delete, etc).
-- Written only via service-role (server actions using the admin client).
-- INSERT is denied to `authenticated` via a RESTRICTIVE policy, mirroring
-- intake_audit_log / request_activity.

CREATE TABLE admin_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    UUID        REFERENCES profiles(id) ON DELETE SET NULL,  -- null = system
  entity_type TEXT        NOT NULL,   -- e.g. 'service', 'service_category', 'service_sub_category'
  entity_id   UUID,
  action      TEXT        NOT NULL,   -- e.g. 'service_created', 'service_deleted'
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_org_created ON admin_audit_log (org_id, created_at DESC);
CREATE INDEX idx_admin_audit_entity      ON admin_audit_log (entity_type, entity_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Managers/admins/platform_owner read org-scoped; INSERT denied to authenticated
-- (service-role only), mirroring intake_audit_log.
CREATE POLICY admin_audit_select ON admin_audit_log FOR SELECT
  USING (
    org_id = current_org_id()
    AND current_user_role() IN ('manager', 'admin', 'platform_owner')
  );

CREATE POLICY admin_audit_no_insert ON admin_audit_log AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

-- RLS still applies; service-role bypasses RLS.
GRANT SELECT ON admin_audit_log TO authenticated;
