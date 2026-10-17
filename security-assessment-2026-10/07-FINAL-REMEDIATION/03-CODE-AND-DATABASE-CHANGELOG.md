# 03 — Code and database change log (final remediation)

LOCAL ONLY. Base = production's `main` (717e5c6, build 20261015-145217). Working branch `security/remediation-phase2-local`. **Nothing here has been pushed, merged or deployed.** The framework upgrade lives separately on `release/p0-framework-next-16.3.8` so it can be released on its own.

## Commits (oldest first, from the branch)

| # | Commit | Date | Summary (first part of the commit message) |
|---|---|---|---|
| 1 | `35922ad` | 2026-10-15 | security hardening from the 2026-10 VAPT - Next.js 16.3.8 (critical advisories), database migration 164, internal-note files/notifications, priority and SLA protected in the database, tickets created by the server only, e-mail ... |
| 2 | `7ee19e0` | 2026-10-15 | business-rule actions no longer return raw database error text |
| 3 | `b6e5a79` | 2026-10-15 | / ISO 27001 / SOC 2 readiness assessment reports (2026-10-15): baseline, VAPT, ISO, SOC 2, remediation, management; not pushed |
| 4 | `6037221` | 2026-10-16 | phase 1A: tickets (and 45 server-owned tables) are written by the server only - migration 165 removes direct INSERT/UPDATE/DELETE for signed-in users and all table rights for anon; assignee validated; status remark written with... |
| 5 | `0fe77a1` | 2026-10-16 | phase 1B/1C: approval separation of duties on every route (choose, add, delegate), approver search for staff only, approval routes private (migration 166); project/task/task-file ownership checks, org checks on comments and att... |
| 6 | `5035918` | 2026-10-16 | tests for projects/tasks/files now assert the permission rule (42501) not just any error |
| 7 | `0afcaf9` | 2026-10-16 | phase 2A: no shared default password (random one-time passwords or invitations), must-change-password enforced by the server and the database (migration 168), failure-based sign-in throttling and spray detection, forgot-passwor... |
| 8 | `855a1b2` | 2026-10-16 | phase 2B: one secret per purpose (no CRON_SECRET fallback), Outlook subscription address carries no secret, secrets checker, tests |
| 9 | `9cabcdd` | 2026-10-16 | phase 2C: permission matrix with four owner-controlled switches (defaults = today's behaviour), settings allow-list with value checks, company-wide setting/rule/workflow actions read the matrix, Business Rules limited to allowe... |
| 10 | `ce64306` | 2026-10-16 | phase 2B (completion): the five route files now read their own purpose-specific secret via lib/secrets (missed in the 2B commit; already covered by the full regression runs) |
| 11 | `bcfe76d` | 2026-10-16 | phase 3A: duplicate request through normal creation path (VAPT-054), re-classification refused on finished tickets + deadlines logged + assigned->open (055/056), status-conditioned updates and decision-after-decided refused (05... |
| 12 | `982515e` | 2026-10-17 | phase 5 (part): independent migration rehearsal on a true baseline (0-163): privileges/policies identical at every step forward and back, no privilege broadened; rollbacks of 165/167 now restore EXACT recorded grants (table, co... |
| 13 | `01577ff` | 2026-10-17 | phase 3B/3C + partial findings (WIP, last test file not yet run because the isolation gate is blocked): 036 push address allow-list + server-only table, 042 Gmail signed token/replay/rate limits, Outlook token shape, WhatsApp c... |
| 14 | `1a01c1e` | 2026-10-17 | phase 3 partial findings tested: 019 profile visibility, 021 storage read rule (old rule proven to fail the forged-reference test) + missing task_attachments read grant, 056 reclassification reason; tests 27 (15) pass; three ol... |
| 15 | `460c1d6` | 2026-10-17 | deterministic store-ticket fixture for the audit database; fixed-report test picks a technician who has rows in the report |
| 16 | `db20f3a` | 2026-10-17 | double-submit protection (identical submissions within 15 s return the first ticket; atomic, released on failure), intake worker SMTP now verifies certificates and requires TLS (scan finding NEW-001), concurrency/idempotency te... |


Counts at the time of writing: 299 files changed against main (182 added, 117 modified), about 31,000 lines added; 44 test files added or changed. The commit after this file adds the final tests, tools, evidence and these reports (see Phase 11 hygiene in `12-FINAL-RELEASE-GATE.md`).

## Database migrations (all additive or tightening; each has an exact rollback in `supabase/rollback/`)

| Migration | What it does | Findings | Rollback behaviour |
|---|---|---|---|
| 164 `vapt_security_hardening` | guard trigger on tickets (priority, SLA, pause ledger, assignee, flags); mobile-number rights; task-attachment upload policy removed; internal-note file hiding; TRUNCATE/TRIGGER/REFERENCES revoked | 001, 004, 005, 012, 020, 022, 064 | restores the weaker rules |
| 165 `server_only_writes` | ~45 configuration/approval/organisation tables and the ticket table lose direct INSERT/UPDATE/DELETE for signed-in users; `anon` loses table rights; exact previous rights recorded in `_grant_snapshots` | 001, 004, 006, 064 | puts back the recorded rights exactly |
| 166 `approvals_privacy` | approval workflows and steps readable only by staff or people with a visible approval; `added_by` on approvals | 015, 016, 019 | restores read rules; **keeps** `added_by` |
| 167 `ownership_and_privacy` | project members/milestones/updates tied to project visibility; org checks on comment/attachment inserts; UPDATE/DELETE on attachments revoked; exact rights recorded | 018, 019, 021 | puts back the recorded rights |
| 168 `must_change_password_enforced` | role/organisation helper functions return nothing while a forced password change is pending | 003 | restores the old helpers |
| 169 `low_findings_db` | activity log staff-only; home dashboard derives roles itself (wrapper + inner function); EXECUTE rights removed from anon/PUBLIC on application functions; new functions not public by default | 062, 063, 064 | restores old policy, function and stored function rights |
| 171 `table_rights_converge` | trims the extra INSERT/UPDATE/DELETE/TRUNCATE rights that the live database gives signed-in users on 26 tables (found by comparing a read-only live snapshot with the rehearsal baseline); keeps the four browser writes that work today (error_reports insert, intake_messages update, intake_notes insert/delete, notification_preferences insert/update/delete); 3 server-only functions lose EXECUTE for signed-in users; exact rights recorded for the rollback | 006, 064 | restores the recorded rights |
| 170 `low_findings_db_b` | push subscriptions server-written only; shared rate-limit and webhook-replay tables with functions; profile name/avatar column write revoked; `current_user_visible_people()` + profile visibility policy; `task_attachments` read right; attachment path check in policy and storage read rule; org check inside `upsert_field_sla_override` | 019, 021, 036, 042, 048, 051, 061, 065 | removes the new tables/functions (they hold only short-lived counters); restores snapshots |

## Application code by purpose (files are under `lib/`, `app/`, `components/` unless noted)

- **Server-only writes and authorization:** `lib/actions/requests.ts`, `lib/requests/status-change.ts`, `lib/requests/create-request-core.ts`, `lib/actions/attachments.ts`, `lib/actions/admin/*` (org, teams, sla-matrix, reports, oems, users, events, system-log, workflows, business-rules, config, policies), `lib/actions/projects*`, five actions that wrote with the user's own session to tables users can no longer write (now write with the server key after the same checks).
- **Permission matrix and owner switches:** `lib/permissions/matrix.ts`, `policies.ts`, `lib/actions/admin/policies.ts`, `components/admin/PolicySwitchesCard.tsx`, `app/(app)/admin/settings/page.tsx`.
- **Approvals:** `lib/approvals/separation.ts`, `decision.ts`, `email-code.ts`, `lib/actions/approvals.ts`, `approvalEmail.ts`, `app/approve/[token]/page.tsx`.
- **Authentication and accounts:** `lib/actions/auth.ts`, `lib/auth/one-time-password.ts`, `lib/auth/session-methods.ts`, `lib/users/display-name.ts`, `lib/queries/profiles.ts`, `lib/rate-limit.ts`.
- **Intake and webhooks:** `app/api/intake/webhook/{gmail,outlook,whatsapp}`, `lib/intake/google-oidc.ts`, `lib/intake/mail-html.ts`, `lib/whatsapp/webhook-handler.ts`, `lib/email/inbound-*.ts`, `lib/security/shared-limits.ts`, `api/src/intake/smtp.ts`.
- **Files and uploads:** `lib/attachments/{scan,validate-server,quota,xlsx-preview}.ts`, `lib/stores/master-file.ts`, `lib/whatsapp/media.ts`.
- **Requester privacy:** `lib/activity-public.ts`, `lib/queries/requests.ts`, `lib/queries/intake/index.ts`, `app/(app)/intake/_components/EmailBody.tsx`.
- **Operations:** `app/api/health/route.ts`, `lib/secrets.ts`, `scripts/check-secrets.mjs`, `scripts/check-auth-settings.mjs`, `scripts/log-shipper.mjs`, `proxy.ts`, `next.config.ts`, `lib/push/{endpoint,send}.ts`.
- **Types:** `types/database.ts` (hand-maintained) updated for new columns/functions.
- **Dependencies:** `package.json` — scoped override for the patched `uuid`.

## Behaviour changes users will notice (all deliberate)

| Area | Before | After |
|---|---|---|
| Re-classification of a ticket | no reason needed | reason of 10–500 characters, recorded; refused on finished tickets |
| Priority | could be changed by hand | never by hand; the service and rules decide |
| History tab (requesters) | raw activity table | server-built view without internal items |
| People lists (requesters) | everyone in the organisation | self, manager, reports, people on own tickets |
| Display name | free text | letters/digits/few marks; cannot copy a staff member's name |
| Bulk import | shared default password | random one-time password or invitation |
| Double click on Submit | two tickets | one ticket (identical submissions within 15 s return the first) |
| Office files with macros | accepted | refused unless the switch is set |
| Hand-written SQL/API access with a user's token | wide table rights | only what the screens need; anything else is refused |

## Functionality removed

None. Every screen and action that existed still exists. Where a rule became stricter the rule is described above and each default policy switch equals the old behaviour.

## Test inventory added or changed

- `tests/integration/approval-email-link.test.ts`
- `tests/integration/fixed-reports.test.ts`
- `tests/remediation/102-system-log-endpoints.test.ts`
- `tests/remediation/103-system-log-actor.test.ts`
- `tests/remediation/110-approval-hardening.test.ts`
- `tests/remediation/118-status-transitions-db.test.ts`
- `tests/remediation/20-db-critical.test.ts`
- `tests/remediation/40-db-high.test.ts`
- `tests/remediation/71-requests-update-identity.test.ts`
- `tests/remediation/92-db-timeout.test.ts`
- `tests/setup/fixtures-d03.ts`
- `tests/unit/approval-code-burst.test.ts`
- `tests/unit/approval-link.test.ts`
- `tests/unit/auth-settings-check.test.ts`
- `tests/unit/auth-throttling.test.ts`
- `tests/unit/csp-report.test.ts`
- `tests/unit/header-trust.test.ts`
- `tests/unit/intake-smtp-tls.test.ts`
- `tests/unit/mail-html.test.ts`
- `tests/unit/oauth-state.test.ts`
- `tests/unit/one-time-password.test.ts`
- `tests/unit/phase3bc-units.test.ts`
- `tests/unit/secrets.test.ts`
- `tests/unit/syslog-writer.test.ts`
- `tests/unit/vapt-hardening-units.test.ts`
- `tests/unit/xlsx-zip-bomb.test.ts`
- `tests/vapt-support/uat-fixture-cleanup.ts`
- `tests/vapt-support/uat-fixture-keep.ts`
- `tests/vapt/10-confidentiality-exploits.test.ts`
- `tests/vapt/11-integrity-exploits.test.ts`
- `tests/vapt/12-email-reply-participant.test.ts`
- `tests/vapt/20-ticket-actions-authz.test.ts`
- `tests/vapt/21-approvals-separation.test.ts`
- `tests/vapt/22-projects-tasks-files-privacy.test.ts`
- `tests/vapt/23-permission-matrix-and-rules.test.ts`
- `tests/vapt/24-ticket-low-findings.test.ts`
- `tests/vapt/25-phase3b-auth-and-integrations.test.ts`
- `tests/vapt/26-phase3c-admin-exports-files.test.ts`
- `tests/vapt/27-partial-findings-019-021-056.test.ts`
- `tests/vapt/28-concurrency-and-idempotency.test.ts`
- `tests/vapt/29-multi-organisation-isolation.test.ts`
- `tests/vapt/30-onboarding-and-password-enforcement.test.ts`
- `tests/vapt/90-performance.test.ts`
- `tests/vapt/91-performance-scale.test.ts`

## Tools and evidence added (`07-FINAL-REMEDIATION/tools`, `rehearsal`, `scans`, `perf`)

`rehearse-migrations.sh` (forward/back/forward rehearsal on a rebuilt baseline), `prepare-audit-db.sh`, `run-suite.sh` (every suite through the 21-point isolation gate, never bypassing it), `schema-diff.cjs`, `acl-diff.cjs`, `write-inventory.cjs` (write paths from the server code), `fixture-store-tickets.sql`, `show-perf.cjs`, `closure-data.cjs` / `make-closure-matrix.cjs` (this report set). Raw logs containing synthetic tokens are not part of the commit set (see `12-…`).
