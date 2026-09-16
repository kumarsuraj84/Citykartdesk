# Clean-Slate Seed Manifest

Defines, per table, whether a "clean slate" reset should **preserve/restore**
it (technical/system seed the application needs to function) or **delete**
its contents (business/operational/test data). Verify with
`node scripts/clean-slate-validator.mjs` (read-only — reports, never
deletes).

This is a contract for the *next* cleanup pass — it does not itself perform
any cleanup.

## How each table was classified

For every table: is it required for the app to start, does core workflow
depend on it, is it migration-seeded, and should a reset preserve or
recreate it. Migration-seeded defaults were confirmed by grepping every
`supabase/migrations/*.sql` file for a static `INSERT`, not assumed.

## PRESERVE / RESTORE after cleanup

| Table | Why | Verified state (Local) |
|---|---|---|
| `organizations` | The one bootstrap org (`00000000-0000-0000-0000-000000000001`, "CityKart") every other row is scoped to. Seeded by migration `20240101000032_multitenancy.sql`. | Present |
| `profiles` (bootstrap admin only) | `suraj@citykart.org`, role `platform_owner` — created via `handle_new_user()`, not a static seed, but required for any login. | Present |
| `business_hours` | System config seeded by `20240101000017_business_hours.sql` (Mon-Fri 09:00-17:00 active, Sat/Sun inactive). `resolveSlaDeadlines()`/`computeSLADeadline()` (`lib/sla/business-hours.ts`) return `null` for every SLA deadline with 0 active rows — this is NOT business/test data, and was incorrectly swept up by an earlier cleanup pass this session. **Fixed during this session** (was 0 active rows, restored to the canonical calendar below). |
| `sla_escalation_rules` | 4 rows (Critical/High/Medium/Low warning), seeded by the same migration. Read by `lib/actions/admin/business-rules.ts`/`config.ts`. **Also found empty and restored this session** — same root cause as `business_hours`. Note: the schema's `tier` check constraint was tightened after this migration (now `low/medium/high/urgent` only); the restored rows use `urgent` in place of the migration's original literal `critical`, which the current schema rejects. |
| `alert_rules` (bootstrap org) | 4 default rows seeded by `20240101000024_alerts.sql`, read by `lib/actions/admin/config.ts`/`business-rules.ts`. **Also found empty and restored this session** for the bootstrap org. Note: `org_id` became `NOT NULL` after this migration; the original migration text (backfilled for existing orgs) no longer matches a bare re-run — the restore used the bootstrap org's id explicitly. |
| `task_statuses` | 5 rows, seeded by `20240101000023_task_config.sql`. Confirmed present. |
| `task_priorities` | 4 rows, same migration. Confirmed present. |
| `request_priorities` | 4 rows, seeded by `20240101000026_master_data.sql`. Confirmed present. |
| `retention_policies` | 5 rows, seeded by `20240101000027_data_retention.sql` — default archive/purge windows the retention job needs. Confirmed present. |
| `app_settings` | 1 row (`auto_close_days = 7`), seeded by the initial schema migration. Confirmed present. |
| `org_module_access` (bootstrap org) | 9 module-enabled rows, seeded by `20240101000032_multitenancy.sql` / `20240101000053_intake_core_tables.sql`. Confirmed present for the bootstrap org. |
| `intake_pipeline_config` (bootstrap org) | 1 row, seeded per-org by `20240101000055_intake_classification.sql`. **Also found empty and restored this session.** |
| `request_sequences` | Not a static seed — created lazily by `generate_request_no()` on first use. A clean slate must **reset `last_no` to 0** (not delete the row), so the next real ticket is `CKSD-000001`. |
| Storage buckets (`storage.buckets`, not `public` schema) | Seeded by 4 separate migrations (attachments, task attachments, intake ingestion, icons). Required for any file upload. Out of scope for this manifest's row counts (different schema), but never delete. |

### Canonical `business_hours` calendar (authoritative, do not invent different hours)

| day_of_week | hours | is_active |
|---|---|---|
| 0 (Sunday) | 09:00-17:00 | false |
| 1 (Monday) | 09:00-17:00 | true |
| 2 (Tuesday) | 09:00-17:00 | true |
| 3 (Wednesday) | 09:00-17:00 | true |
| 4 (Thursday) | 09:00-17:00 | true |
| 5 (Friday) | 09:00-17:00 | true |
| 6 (Saturday) | 09:00-17:00 | false |

## Legacy — present but not read by current app logic

| Table | Note |
|---|---|
| `global_sla_config` | Seeded historically (`20240101000014_admin_config.sql`, `20240101000048_per_org_sla_config.sql`), but `lib/sla/resolve.ts`'s own doc comment says "the old global_sla_config-backed 'SLA Targets' screen was removed" — current SLA resolution reads only `services.sla_policy_id -> sla_policies.config` and `field_sla_overrides`. Safe to clear; not required for startup or core workflow. |

## DELETE (business/operational/test data)

Everything transactional or admin-configurable, with no dependency the app
needs at startup:

`requests`, `request_activity`, `request_attachments`, `request_comments`,
`request_collaborators`, `related_requests`, `request_time_entries`,
`request_conversations`, `conversation_attachments`, `conversation_events`,
`tasks`, `task_activity`, `task_assignees`, `task_attachments`,
`task_comments`, `task_custom_field_values`, `task_custom_fields`,
`task_dependencies`, `task_template_items`, `task_templates`, `projects`,
`project_activity`, `project_members`, `project_updates`, `milestones`,
`approvals`, `approval_decisions`, `approval_workflows`,
`approval_workflow_steps`, `notifications`, `notification_preferences`,
`notification_rules`, `push_subscriptions`, `intake_messages`,
`intake_attachments`, `intake_audit_log`, `intake_channels`,
`intake_classifications`, `intake_notes`, `intake_outbound`,
`intake_reviews`, `intake_rules`, `intake_threads`, `services`,
`service_categories`, `service_sub_categories`, `service_sub_category_tags`,
`service_location_tags`, `sla_policies`, `field_sla_overrides`,
`sla_escalation_events`, `business_rules`, `business_rule_events`,
`assignment_rules`, `escalation_policies`, `custom_roles`,
`permission_overrides`, `designations`, `job_functions`, `locations`,
`cost_centers`, `stores`, `oems`, `form_templates`, `kb_articles`,
`kb_article_services`, `csat_surveys`, `scheduled_reports`, `error_reports`,
`license_keys`, `org_signup_requests`, `desktime_app_logs`,
`desktime_project_map`, `desktime_sync_runs`, `desktime_time_logs`,
`admin_audit_log`, `owner_audit_log`, `global_sla_config` (legacy, see
above), `teams`, `departments`, `team_members`, `profile_mobile_numbers`
(other than the bootstrap admin's, if any), `organizations` (all rows
except the bootstrap org), `profiles` (all rows except the bootstrap admin).

## Not yet confirmed on Main

`alert_rules` and `intake_pipeline_config` for the bootstrap org were
checked on Main via the app's own restricted `citykart_desk_app` role and
came back empty — but so did `organizations`/`profiles` under that same
role, which is known-wrong (Main's admin login/dashboard were verified
working earlier this session). That's RLS filtering an unauthenticated
`psql` session, not real emptiness — `business_hours` and
`sla_escalation_rules` (which have permissive `USING (true)` SELECT
policies) checked out fine the same way. Re-verify `alert_rules`/
`intake_pipeline_config` on Main with a properly-privileged connection
(the Postgres superuser, or `service_role` now that it has `BYPASSRLS`)
before assuming they need the same restore Local got.
