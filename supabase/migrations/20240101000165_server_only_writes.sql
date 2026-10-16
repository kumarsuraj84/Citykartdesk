-- Remediation phase 2 (LOCAL; apply to production only after review, together with the application release that makes the server write these tables).
-- Rollback: supabase/rollback/165_server_only_writes_rollback.sql
--
-- PRINCIPLE: the browser holds the same login as the server, so anything a signed-in user may write "through the application" they may also write by calling the
-- data API directly and skipping the application's rules. Tables whose rules live in server code are therefore written ONLY by the server (its own key).
--
--  VAPT-001 / VA-TKT-01 / VA-DB-01  tickets: no direct INSERT / UPDATE / DELETE for a signed-in user (priority, SLA, assignee, description, form answers, timestamps,
--                                     reopen counters, category are all server-written, after the application's own checks)
--  VAPT-006/007/008/009/019/020 (part)  configuration, approval, organisation and audit tables written only by the server: a manager can no longer change them through the data API
--  VAPT-064                         `anon` (not signed in) has no table privileges at all

BEGIN;

-- ── 1. tickets ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.requests FROM authenticated, anon;

-- ── 2. tables the application writes only with the server's key ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- approvals and workflows
    'approvals', 'approval_decisions', 'approval_workflows', 'approval_workflow_steps', 'approval_email_codes',
    -- people, groups, organisation structure
    'team_members', 'teams', 'profile_mobile_numbers', 'locations', 'departments', 'cost_centers', 'designations', 'job_functions', 'stores', 'oems',
    -- company-wide settings and rules
    'business_hours', 'holidays', 'request_priorities', 'app_settings', 'retention_policies', 'global_sla_config', 'field_sla_overrides',
    'business_rules', 'business_rule_events', 'assignment_rules', 'alert_rules', 'notification_rules', 'intake_rules', 'scheduled_reports',
    'task_statuses', 'task_priorities', 'task_templates', 'task_template_items',
    -- history, conversations, integrations, logs
    'request_activity', 'task_activity', 'project_activity', 'request_conversations', 'conversation_attachments', 'conversation_events',
    'processed_inbound_emails', 'email_smtp_settings', 'admin_audit_log', 'owner_audit_log', 'intake_audit_log', 'app_event_log', 'ai_applications',
    'desktime_app_logs', 'desktime_project_map', 'desktime_sync_runs', 'desktime_time_logs'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
    END IF;
  END LOOP;
END $$;

-- ── 3. a visitor who is not signed in has no table rights at all ────────────────────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
-- and a signed-in user needs no right to change the counters of the log tables
REVOKE UPDATE ON SEQUENCE public.system_log_id_seq, public.app_event_log_id_seq FROM authenticated;

COMMIT;
