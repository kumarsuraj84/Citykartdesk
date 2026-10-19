# 06 — Database & Data Integrity

*Drawn from the same DB/RLS review as report 04 (the security-flavored half of its findings); this report covers the integrity/constraint/migration-hygiene half. Cross-references report 04's DB-* IDs where a finding is both a security and an integrity issue.*

## Schema & constraint findings

| Finding | Detail | Confidence |
|---|---|---|
| **No DB-level state machine for `requests.status`** | Only 3 triggers exist on `requests` (org-id, request-no, updated_at touch). The transition matrix (`lib/constants/request-transitions.ts`) and all mandatory-remark/pause-resume logic live in app code only (`lib/requests/status-change.ts`). Any direct PostgREST write bypasses it entirely (see report 04 SEC-08/D-008, and SEC-18/D-023). | CONFIRMED-BY-CATALOG |
| **No CHECK constraints on lifecycle timestamps** | `resolved_at`, `closed_at`, `paused_ms_total`, `waiting_since` have no validation that they're internally consistent (e.g. `resolved_at >= created_at`, `paused_ms_total >= 0`). | CONFIRMED-BY-CATALOG |
| **Request-number sequence is global across all tenants** | `generate_request_no()` increments one shared counter (`request_sequences`), serializing every org's ticket creation on one row and letting tenants infer each other's ticket volume. Gap-free only on rollback — direct RPC calls (report 04 D-007) and deleted rows create gaps. | CONFIRMED-BY-CATALOG |
| **Global UNIQUE constraints in a multi-tenant schema** | `departments.name`, `teams.prefix`/`slug`, `services.slug`, `task_statuses`/`task_priorities`/`request_priorities` value keys, `business_hours.day_of_week` are all unique **across every org**, not per-tenant. A second org cannot reuse a name/slug another org already used, and a 23505 conflict error leaks that another tenant has used the value. | CONFIRMED-BY-CATALOG |
| **DeskTime log keys lack `org_id`** | `desktime_time_logs(work_date, desktime_user_id, desktime_project_id)` and `desktime_app_logs(work_date, desktime_user_id, app_name)` have no tenant scoping — two tenants with colliding DeskTime ids could overwrite each other's logs on upsert. | CONFIRMED-BY-CATALOG |
| **`idx_intake_channels_whatsapp_phone_number_id` is global** | Another tenant's admin can claim a WhatsApp `phone_number_id` that an existing tenant already uses. | CONFIRMED-BY-CATALOG |
| **FK delete semantics are inconsistent and lossy** | 27 of 69 FKs to `profiles` are `NO ACTION` (blocks deleting a profile), 29 are `SET NULL`, 11 are `CASCADE` (silently deletes `team_members`, `notifications`, `task_comments`, `csat_surveys`, `intake_notes`, `project_members` history when a user is removed). `requests.parent_request_id` cascades, so deleting a parent deletes its sub-requests; `request_activity`/`request_comments`/`request_attachments` cascade from `requests`, so a hard-deleted ticket loses its own audit trail. | CONFIRMED-BY-CATALOG |
| **No composite `(id, org_id)` FKs** | Nothing stops `requests.team_id`/`service_id` from pointing at a row in a *different* org than `requests.org_id` itself — such rows would just be invisible to the referencing org under RLS, so this is pollution risk rather than a direct leak. | CONFIRMED-BY-CATALOG |
| **Priority vocabulary drift** | `assignment_rules.priority_filter` allows the literal `'critical'`, but `request_priority` enum only has `low/medium/high/urgent` — a "critical" filter can never match anything. Confirmed independently by the code-quality review (report 11 CQ-28) as part of its "status labels duplicated with drift" finding. | CONFIRMED-BY-CODE (both reviews) |

## Concurrency scenarios reviewed

| Scenario | Finding | Where (cross-ref) |
|---|---|---|
| Duplicate ticket submission | No idempotency key on `createRequest`; UI disables the button while pending but a lost response / retry can duplicate (report 11 CQ-31, ties to CQ-09's retry-on-ambiguous-failure behavior) | Open |
| Request-number generation | Atomic and collision-safe by design (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, verified both by code read and by the PostgREST-level repro in report 04 D-007 showing sequential numbers under direct calls) — the *access control* on who can call it is the problem, not the atomicity | Checked OK (atomicity) / see D-007 (access) |
| Simultaneous assignment | `assignRequest`'s optimistic lock only covers `assigned_to`, not `status` — a stale read can overwrite a concurrent status change (report 11 CQ-10) | Open |
| Concurrent status updates | `applyStatusChange` itself correctly optimistic-locks on `.eq('status', currentStatus)` (checked OK); but 3 *other* code paths that also flip status (Waiting-on-User auto-resume ×2, Business Rules' `runSetStatus`) do not use the same guard (report 11 CQ-11/CQ-15) | Mixed — core path OK, siblings not |
| Approval race conditions | `approval_decisions` insert happens before the pending-status guard check — a losing concurrent decision can still return "success" while a winning one changes the record (report 04 SEC-A-11 in the earlier agent transcript, folded into CQ-cluster D-044) | Open |
| Technician takeover | No dedicated "takeover" guard at all — it's just `assignRequest(self)` by any team technician with no check of current owner (report 03 module inventory, module 6 oddities) | Open (design gap, not a race) |
| SLA pause/resume | Correct in the primary `applyStatusChange` path; duplicated and drifted in 3 side paths with missing status guards (report 11 CQ-11/14/15) | Open |
| Repeated webhook delivery | WhatsApp webhook has real dedupe (`idx_conversation_events_dedup` unique index) — checked OK. Gmail/Outlook webhook → worker calls are fire-and-forget with no retry-on-failure signal to the provider (report 11 CQ-23) | Mixed |
| Duplicate email intake | `processed_inbound_emails` unique `message_id` exists, but the row is written *after* comment-append and regardless of its success — see report 04/11 D-020/CQ-02 | Open |
| Attachment upload failures | Storage-write-then-DB-row ordering is correct with compensating removal on DB failure (checked OK); the *compensating* removal's own result is ignored, so a failed cleanup can orphan a storage object (report 11 CQ-32) | Mostly OK, minor gap |
| Partial transaction failures | `applyStatusChange` commits the status row before logging activity/sending notifications — a failure in those later steps reports "failed" even though the status already changed (report 11 CQ-12); intake "approve and create" and `submitForApproval` have similar non-atomic multi-step writes with no rollback (report 11 CQ-16/17) | Open |

## Migration hygiene (from the DB review)
- No migration uses `CREATE INDEX CONCURRENTLY` — index creation on `requests`/`notifications`/`request_activity` would block writes on a large live table.
- Several migrations take full-table-scan `ALTER ... SET NOT NULL` or `ADD CONSTRAINT ... CHECK` locks that should be split into `NOT VALID` + `VALIDATE CONSTRAINT`.
- A number of migrations are not idempotent (`ADD COLUMN` without `IF NOT EXISTS`, `ADD CONSTRAINT` without a drop guard) — a partial re-apply would fail.
- `types/database.ts` is hand-maintained (no `gen:types` script) and was spot-checked to match the live enum/table list with two intentional exceptions (`email_smtp_settings`, `app_event_log` — both service-role-only, correctly excluded).

## Conclusion
The schema's RLS *coverage* is thorough (every table has it), but several of its *policies* and a number of its *constraints* assume good-faith clients rather than enforcing invariants at the database layer — this is the same theme as report 04's Critical/High findings, just viewed from the integrity angle. The highest-value database-layer fix (beyond the security migration) is adding a real state-machine trigger for `requests.status` and tightening the global unique constraints to be per-tenant, both deferred to report 14 pending user approval given they touch the core `requests`/`profiles` tables.
