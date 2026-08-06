-- Fix missing grants: service_role needs explicit SELECT/INSERT/UPDATE/DELETE
-- on tables that use RLS, since Supabase's default grants don't always cover
-- tables created after the initial schema.

GRANT ALL ON organizations        TO service_role;
GRANT ALL ON org_module_access    TO service_role;
GRANT ALL ON license_keys         TO service_role;
GRANT ALL ON owner_audit_log      TO service_role;
GRANT ALL ON profiles             TO service_role;
GRANT ALL ON requests             TO service_role;
GRANT ALL ON tasks                TO service_role;
GRANT ALL ON services             TO service_role;
GRANT ALL ON service_categories   TO service_role;
GRANT ALL ON teams                TO service_role;
GRANT ALL ON team_members         TO service_role;
GRANT ALL ON request_activity     TO service_role;
GRANT ALL ON task_activity        TO service_role;
GRANT ALL ON notifications        TO service_role;
GRANT ALL ON request_collaborators TO service_role;
GRANT ALL ON approval_workflows   TO service_role;
GRANT ALL ON departments          TO service_role;
GRANT ALL ON locations            TO service_role;
GRANT ALL ON cost_centers         TO service_role;
GRANT ALL ON assignment_rules     TO service_role;
GRANT ALL ON alert_rules          TO service_role;
GRANT ALL ON tags                 TO service_role;
GRANT ALL ON scheduled_reports    TO service_role;
GRANT ALL ON global_sla_config    TO service_role;
GRANT ALL ON task_templates       TO service_role;
