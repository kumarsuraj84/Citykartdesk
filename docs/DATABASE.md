# Citykart Desk — Database Reference (Supabase / PostgreSQL)

> Reconstructed from `supabase/migrations/**` (87 migrations as of `20240101000087`) +
> `supabase/seed.sql`. Runs on a local Supabase instance (Postgres + Auth + REST via the
> Supabase CLI). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the app uses this
> schema.
>
> **Not yet reflected below** (migrations 067–087, ~24 migrations added after this doc's
> last full reconstruction): the Projects/Milestones module (`projects`, `milestones`,
> `project_members`, `project_updates` and their RLS — migrations 072–077, 082–084), the
> DeskTime integration (`desktime_credentials`, sync tables — migrations 078–079), Job
> Functions/Designations master data (migration 081), request sub-requests and task
> dependencies (068–069), plus assorted RLS-hardening and notification-enum migrations.
> Read those migration files directly for now rather than trusting this doc's table list
> to be exhaustive for anything added after 2026-08-06.

---

## 1. Enums

| Enum | Values |
|---|---|
| `user_role` | `user`, `agent`, `manager`, `admin`, `platform_owner` |
| `org_status` | `trial`, `active`, `suspended`, `cancelled` |
| `module_slug` | `requests`, `tasks`, `approvals`, `services`, `time_tracking`, `analytics`, `integrations` |
| `request_status` | `pending_approval`, `open`, `assigned`, `in_progress`, `waiting_user`, `resolved`, `closed`, `cancelled` |
| `request_priority` | `low`, `medium`, `high`, `urgent` |
| `task_type` | `personal`, `team` |
| `task_status` | `open`, `in_progress`, `done`, `cancelled` (display values also configurable via `task_statuses`) |
| `task_priority` | `low`, `medium`, `high` |
| `approval_status` | `pending`, `approved`, `rejected`, `cancelled` |
| `approval_decision_type` | `approved`, `rejected` |
| `approver_type` | `specific_user`, `any_manager` |
| `activity_action` | `created`, `assigned`, `unassigned`, `status_changed`, `priority_changed`, `resolved`, `closed`, `reopened`, `cancelled`, `approval_requested`, `approved`, `rejected`, `comment_added`, `attachment_added`, `collaborator_added`, `collaborator_removed` |
| `task_activity_action` | `created`, `assigned`, `unassigned`, `status_changed`, `comment_added`, `completed`, `reopened`, `cancelled` |
| `notification_type` | `request_assigned`, `comment_added`, `approval_requested`, `approval_decided`, `request_resolved`, `request_closed`, `task_assigned`, `request_reopened`, `request_created`, `internal_note_added`, `request_reassigned`, `collaborator_added`, `collaborator_removed`, `approval_approved`, `approval_rejected`, `request_auto_closed`, `request_cancelled`, `priority_changed`, `status_changed`, `sla_warning`, `sla_breached`, `mentioned` |
| `custom_field_type` | `text`, `number`, `date`, `dropdown`, `multi_select`, `checkbox` |
| `report_frequency` | `daily`, `weekly`, `monthly` |
| `report_type_enum` | `requests`, `tasks`, `approvals` |
| `kb_article_status` | `draft`, `published`, `archived` |

---

## 2. Tables by domain

> Notation: PK = primary key, FK = foreign key. Most domain tables carry `org_id`
> (FK → `organizations`) for tenant isolation. Standard `created_at`/`updated_at`
> timestamps omitted for brevity unless notable.

### Identity & Organization
- **`profiles`** (1:1 with `auth.users`, PK `id`) — `full_name`, `avatar_url`,
  `role` (`user_role`, default `user`), `is_active`, `org_id`, `department_id`,
  `location_id`, `cost_center_id`, `employee_id`, `job_title`, `manager_id` (self-FK).
  Auto-created by `handle_new_user()` trigger on `auth.users` insert.
- **`organizations`** (PK `id`) — `name`, `slug` (unique), `status` (`org_status`,
  default `trial`), `seat_limit` (default 10), `trial_ends_at`, `is_owner`.
  Default owner org: id `00000000-0000-0000-0000-000000000001`, slug `citykart`,
  `is_owner=true`, all modules enabled perpetually (seed).
- **`org_module_access`** — `org_id`, `module` (`module_slug`), `enabled`, `seat_limit`
  (null inherits org), `valid_from`, `valid_until` (null = perpetual). UNIQUE
  `(org_id, module)`. **This drives `proxy.ts` module gating.**
- **`license_keys`** — `org_id`, `key_hash` (unique), `modules[]`, `issued_at`,
  `expires_at`, `revoked_at`, `notes`. Owner-only RLS.
- **`owner_audit_log`** — `actor_id`, `org_id`, `action`, `metadata` jsonb. Owner-only.

### Teams & Org structure
- **`departments`** — `name`, `code`, `parent_id` (self-FK, hierarchical),
  `head_user_id`, `org_id`.
- **`teams`** — `name`, `slug` (unique), `prefix` (unique, 2–6 UPPERCASE chars, e.g.
  `IT`/`HR`; used in request numbers), `department_id`, `org_id`, `notification_email`.
- **`team_members`** (PK `(team_id, user_id)`) — `org_id` (NOT NULL, explicit isolation),
  `is_lead`, `joined_at`.
- **`locations`** — `name`, `code`, `country`, `city`, `timezone`, `org_id`.
- **`cost_centers`** — `name`, `code`, `department_id`, `org_id`.

### Service Catalog
- **`service_categories`** — `name`, `slug` (unique), `icon`, `sort_order`, `org_id`.
- **`service_sub_categories`** — `category_id`, `name`, `slug`, UNIQUE `(category_id, slug)`.
- **`services`** — `name`, `slug` (unique), `keywords[]`, `category_id`,
  `sub_category_id`, `team_id`, `org_id`, `form_fields` jsonb (legacy),
  `form_sections` jsonb (current), `form_schema_snapshot` jsonb, `default_priority`,
  `sla_config` jsonb (`{priority:{response_hours,resolution_hours}}`),
  `approval_workflow_id`, `status` (`draft|review|published|retired`), `owner_id`,
  `backup_owner_id`, `escalation_policy_id`, `visibility_scope` jsonb
  (`{audience:'all'|'agents_only'|'managers_only', team_ids:[]}`). Full-text + trigram +
  GIN(keywords) indexes.

### Requests (tickets)
- **`requests`** — `request_no` (unique, e.g. `IT-000001`), `title`, `description`,
  `requester_id`, `assigned_to`, `service_id`, `team_id`, `org_id`, `priority`, `status`,
  `form_data` jsonb, `form_schema_snapshot` / `form_sections_snapshot` jsonb,
  SLA fields: `response_due_at`, `resolution_due_at`, `responded_at`, `waiting_since`
  (SLA pause), lifecycle: `resolved_at`, `closed_at`. Triggers auto-populate
  `request_no` (via `generate_request_no`) and `org_id` (from requester). Heavily indexed
  (assignee+status, requester+status, team+status, SLA due dates, org+created, title trgm).
  **RLS:** org-scoped; requester / team member / manager-admin / collaborator can SELECT;
  managers/admins UPDATE with immutable-field guards (`requester_id`, `service_id`,
  `team_id` immutable).
- **`request_sequences`** (PK `prefix`) — `last_no` counter; only mutated by the
  SECURITY DEFINER `generate_request_no(prefix)`.
- **`request_comments`** — `request_id`, `author_id`, `body`, `is_internal`
  (agent-only when true). Immutable (no delete policy).
- **`request_activity`** — append-only audit (`action` `activity_action`, `metadata`
  jsonb). SELECT only via RLS; INSERT denied to authenticated (admin client writes).
- **`request_attachments`** — file metadata; `file_size` ≤ 25 MB (CHECK),
  `storage_path` (unique), `is_internal`, soft-delete `deleted_at`. Bucket
  `request-attachments` (private, MIME allowlist).
- **`request_collaborators`** — `request_id`, `user_id`, `added_by`, UNIQUE
  `(request_id, user_id)`. Helper `is_request_collaborator()` (SECURITY DEFINER, avoids
  RLS recursion). **Backs the planned Collaborators feature.**
- **`request_time_entries`** — `request_id`, `user_id`, `started_at`, `stopped_at`,
  `note` (timer / time tracking).

### Approvals
- **`approval_workflows`** — `name`, `description`, `org_id`.
- **`approval_workflow_steps`** — `workflow_id`, `step_order`, `approver_type`,
  `approver_user_id`. UNIQUE `(workflow_id, step_order)`; CHECK ties
  `specific_user` ⇔ `approver_user_id NOT NULL`.
- **`approvals`** — `request_id`, `workflow_id`, `org_id`, `current_step`, `status`.
  (UNIQUE on `request_id` was **dropped in migration 031** to allow re-approvals.)
- **`approval_decisions`** — `approval_id`, `step_order`, `decided_by`, `decision`,
  `comment`, `decided_at`. SELECT-only RLS; INSERT denied to authenticated.

### Tasks
- **`tasks`** — `title`, `description`, `task_type` (CHECK personal OR `team_id` set),
  `team_id`, `org_id`, `assignee_id`, `created_by`, `parent_task_id` (self-FK subtasks),
  `request_id` (FK, SET NULL), `priority`, `status`, `due_date`, `completed_at`. Many
  composite indexes (assignee+status, team+status, team+due, due_date partial).
- **`task_comments`** — `task_id`, `author_id`, `body`, `is_internal`.
- **`task_activity`** — append-only (`task_activity_action`); INSERT denied to authenticated.
- **`task_attachments`** — bucket `task-attachments` (private, 25 MB, MIME allowlist).
- **`task_custom_fields`** — per-team field defs (`field_type` `custom_field_type`,
  `options` jsonb, `position`).
- **`task_custom_field_values`** — `task_id`, `field_id`, `value` jsonb, UNIQUE
  `(task_id, field_id)`.

### Notifications
- **`notifications`** — `user_id`, `type`, `title`, `body`, `request_id`, `task_id`,
  `actor_id`, `link`, `metadata`, `read_at`, `archived_at`. Partial indexes for unread /
  unarchived.
- **`notification_preferences`** (PK `(user_id, event_type)`) — per-event `enabled`.

### Admin / Config
- **`app_settings`** (PK `key`) — global key/value (e.g. `auto_close_days`).
- **`global_sla_config`** — per `priority` (`low|medium|high|urgent`) `response_hours`,
  `resolution_hours`, `escalation_pct`. Seed: urgent 0.25/4, high 1/8, medium 4/24,
  low 8/72 (hours).
- **`business_hours`** — per `day_of_week` (0=Sun) `start_time`/`end_time`/`is_active`.
  Seed Mon–Fri 09:00–17:00.
- **`holidays`** — `name`, `date`, `is_recurring` (affect SLA math).
- **`task_templates`** / **`task_template_items`** — reusable task sets (`due_offset_days`,
  `position`).
- **`task_statuses`** / **`task_priorities`** / **`request_priorities`** — configurable
  display + behavior (`request_priorities.sla_multiplier` adjusts SLA times; seed
  critical 0.25× … low 2×).
- **`tags`** — request tags (seed: Bug, Feature Request, Urgent, Hardware, Software, HR,
  Finance, Facilities).

### SLA, Escalation, Routing, Alerts, Reports
- **`sla_escalation_rules`** — `tier`, `trigger_pct` (1–100), `notify_roles[]`. Seed
  critical 75 / high 80 / medium 85 / low 90.
- **`sla_escalation_events`** — `request_id`, `rule_id`, `fired_at`, UNIQUE
  `(request_id, rule_id)` (idempotent firing).
- **`escalation_policies`** — `org_id`, `rules` jsonb
  (`[{after_minutes, action:'notify_backup_owner'|'notify_manager'|'reassign_team_lead', notify_roles[]}]`).
- **`assignment_rules`** — `scope_type` (`service|sub_category|category`), `scope_id`,
  `strategy` (`direct|round_robin|load_balanced`), `assignee_ids[]`, `priority_filter`,
  `last_assigned_index` (round-robin cursor).
- **`alert_rules`** — `alert_type` (`due_soon|overdue|unassigned|sla_warning|sla_breached|daily_digest`),
  `entity_type` (`request|task`), `threshold_minutes`, `notify_roles[]`,
  `notify_assignee`, `notify_requester`, `channels[]` (`in_app|email`).
- **`scheduled_reports`** — `report_type` (`report_type_enum`), `frequency`,
  `recipients[]`, `filters` jsonb, `next_run_at`, `last_sent_at`.

### Enterprise features
- **`csat_surveys`** — `request_id` (unique), `requester_id`, `rating` (1–5), `comment`,
  `sent_at`, `submitted_at`.
- **`related_requests`** — `request_id`, `related_id`, `link_type`
  (`related|duplicates|blocks|is_blocked_by|caused_by`), UNIQUE `(request_id, related_id)`,
  CHECK `request_id ≠ related_id`.
- **`kb_articles`** — `title`, `slug` (unique per org), `content`, `status`
  (`kb_article_status`), `author_id`, `view_count`, `helpful_yes`/`helpful_no`. Full-text
  index. Published visible to all; drafts to manager/admin.
- **`kb_article_services`** (PK `(article_id, service_id)`) — link articles ↔ services.
- **`permission_overrides`** — `org_id`, `role_key`, `action_key`, `allowed`, UNIQUE
  `(org_id, role_key, action_key)`.
- **`custom_roles`** — `org_id`, `name`, `base_role`, UNIQUE `(org_id, name)`.

### Signup & Error reporting
- **`org_signup_requests`** — public-insert lead form: `full_name`, `email`,
  `company_name`, `company_size`, `use_case`, `status` (`pending|approved|rejected`),
  `rejection_reason`, `approved_org_id`. No public SELECT (owner/admin reviews via app).
- **`error_reports`** — `org_id`, `user_id`, `app` (default `citykart-desk`), `error_type`
  (`crash|error|feedback`), `message`, `stack`, `url`, `metadata`, `status`
  (`new|triaged|resolved|dismissed`), `owner_note`. Any authenticated user can INSERT;
  admin/platform_owner SELECT.

### Data retention
- **`retention_policies`** — `entity_type` (`request|task|audit_log|notification|attachment`),
  `retention_days`, `archive_after_days`, `purge_after_days`. Seed: requests/tasks 1825d,
  audit 2555d, notifications 90d.

---

## 3. Multi-tenancy & RLS

- Every domain table carries `org_id`; isolation enforced in RLS via
  **`current_org_id()`** (SECURITY DEFINER, STABLE → `profiles.org_id` for `auth.uid()`).
- Owner org (`is_owner=true`) can read across orgs via **`is_owner_org()`**.
- Key SECURITY DEFINER helpers (used to **avoid RLS recursion** and to keep policies
  cheap): `current_user_role()`, `current_org_id()`, `current_user_team_ids()` (evaluated
  once per query), `is_team_member(team_id)`, `is_agent()`, `is_request_collaborator(request_id)`.
- **Recursion fix history:** migration 009 introduced `is_request_collaborator()`;
  migration 042 dropped the collaborator clause from `requests_select` to break a broader
  cycle; migration 045 made team-membership checks evaluate `current_user_team_ids()` a
  single time per query (major RLS perf win).
- Append-only audit tables (`request_activity`, `task_activity`, `approvals`,
  `approval_decisions`) use **RESTRICTIVE INSERT deny** for authenticated — only the
  service-role admin client writes them.

---

## 4. Functions / RPCs

- **`get_home_dashboard(p_is_manager bool, p_is_agent bool, p_team_id uuid, p_has_tasks bool)`**
  — SECURITY DEFINER; computes `org_id`/`team_id` internally; returns JSON with `counts`
  (my_open, resolved, needs_attention, pending_approvals, sla_breached, team_open,
  team_sla, tasks_open/today/overdue/done_week, team_tasks_*) plus row arrays
  (`my_requests`, `needs_attention`, `my_queue`, `tasks_overdue/today/upcoming/open`).
  Replaces ~6–20 separate queries on the home page.
  > The briefing's short form is `get_home_dashboard(p_is_manager, p_is_agent, p_has_tasks)`;
  > the implemented signature also takes `p_team_id`. Confirm arg order against migration
  > `20240101000044_get_home_dashboard.sql` before calling.
- **`generate_request_no(p_prefix text) → text`** — SECURITY DEFINER; atomically bumps
  `request_sequences.last_no`, returns e.g. `IT-000001`. Called by trigger
  `trg_requests_assign_no` BEFORE INSERT.
- **`get_enabled_modules() → module_slug[]`** — SECURITY DEFINER; enabled modules for the
  caller's org.
- **`owner_delete_org(...)`** — SECURITY DEFINER (migration `20240101000065_owner_delete_org.sql`).
  The only surviving RPC from a since-removed multi-tenant owner-portal scaffolding; all
  the other `owner_*` RPCs that scaffolding relied on (org listing, signup approval,
  module-access toggling, etc.) no longer exist in the database — this is a
  single-tenant app now (see `ARCHITECTURE.md` §0).

### Trigger functions
- `handle_new_user()` — create `profiles` row on `auth.users` insert.
- `set_updated_at()` / `touch_updated_at()` — maintain `updated_at`.
- `trg_assign_request_no()` — look up team prefix → `generate_request_no()`.
- `set_request_org_id()` / `set_task_org_id()` — backfill `org_id` from requester/creator.

---

## 5. Storage buckets
- **`request-attachments`** — private, 25 MB limit, MIME allowlist (images, PDF, Office,
  text/CSV, zip, audio/video). Signed URLs only.
- **`task-attachments`** — private, 25 MB, similar allowlist.

---

## 6. Migration evolution (ordered)

| Range | Theme |
|---|---|
| `000` | Initial schema: profiles, teams, departments, services, requests, tasks, approvals, notifications; pgcrypto + pg_trgm |
| `001–002` | RLS hardening: immutable request fields; deny authenticated INSERT on activity/approvals |
| `003–013` | Attachments, form sections, sub-categories, task foundation, internal-comment visibility, request_sequences RLS fix, collaborators (+`is_request_collaborator`), operational hardening (SLA pause), notifications v2, subtasks, custom task fields |
| `014–024` | Admin config (global SLA, templates), time entries, storage/notif security, business hours/holidays, SLA escalation events, scheduled reports, assignment rules, org structure, service governance (owner/backup/escalation), configurable task statuses/priorities, alert rules |
| `025–028` | Attachment security (25 MB + MIME lock), master data (tags, request priorities), retention policies, performance indexes (trigram/composite) |
| `029–038` | Task activity security, task attachments, **multiple approvals per request (drop UNIQUE)**, multi-tenancy foundation (organizations/org_module_access/license_keys/org_id), full org isolation + RLS overhaul, grant fixes, pilot readiness (agent + platform_owner roles; org_id on team_members), service governance phase 2 (escalation_policies), enterprise expansion (CSAT, related requests, KB, permission overrides, custom roles) |
| `039–046` | Role permissions, error reports, signup requests, **fix collaborator RLS recursion (042)**, performance indexes (043), **`get_home_dashboard` RPC (044)**, **RLS optimization via `current_user_team_ids()` (045)**, secondary indexes (046) |

Through-lines: foundation → features → enterprise; RLS broad-read → org isolation →
recursion fixes → STABLE-function perf; multi-tenancy retrofitted late (032–033) with
careful backfill; approvals kept immutable/auditable; iterative indexing.
