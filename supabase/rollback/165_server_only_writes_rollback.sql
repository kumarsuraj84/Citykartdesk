-- Rollback of 20240101000165_server_only_writes.sql: gives back the previous table privileges (row security policies still apply as before).
BEGIN;
GRANT INSERT, UPDATE, DELETE ON public.requests TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.requests TO anon;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'approvals', 'approval_decisions', 'approval_workflows', 'approval_workflow_steps', 'approval_email_codes',
    'team_members', 'teams', 'profile_mobile_numbers', 'locations', 'departments', 'cost_centers', 'designations', 'job_functions', 'stores', 'oems',
    'business_hours', 'holidays', 'request_priorities', 'app_settings', 'retention_policies', 'global_sla_config', 'field_sla_overrides',
    'business_rules', 'business_rule_events', 'assignment_rules', 'alert_rules', 'notification_rules', 'intake_rules', 'scheduled_reports',
    'task_statuses', 'task_priorities', 'task_templates', 'task_template_items',
    'request_activity', 'task_activity', 'project_activity', 'request_conversations', 'conversation_attachments', 'conversation_events',
    'processed_inbound_emails', 'email_smtp_settings', 'admin_audit_log', 'owner_audit_log', 'intake_audit_log', 'app_event_log', 'ai_applications',
    'desktime_app_logs', 'desktime_project_map', 'desktime_sync_runs', 'desktime_time_logs'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
GRANT UPDATE ON SEQUENCE public.system_log_id_seq, public.app_event_log_id_seq TO authenticated;
COMMIT;
