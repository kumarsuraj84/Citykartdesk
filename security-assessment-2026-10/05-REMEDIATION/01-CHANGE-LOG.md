# 05 / 01 — Change log (LOCAL only, branch `security/vapt-iso27001-soc2-local`, commit `35922ad`)

Nothing here is pushed, merged or deployed. Production (build `20261015-145217`, main `717e5c6`) does **not** contain any of it.
56 files changed, 1,611 insertions, 703 deletions (includes new tests and the test updates listed in section 4).

## 1. Database — one new migration, with rollback
`supabase/migrations/20240101000164_vapt_security_hardening.sql` (idempotent, one transaction) and `supabase/rollback/164_vapt_security_hardening_rollback.sql`.
Applied to the disposable audit database only; applied → rolled back → re-applied during testing (before/after evidence).
| Block | What it does | Finding |
|---|---|---|
| requests guard trigger | refuses a hand-made change of `priority`; refuses a change of SLA due dates / paused-time ledger unless the status changes in the same update | VA-DB-01, VA-TKT-01 |
| requests insert | direct INSERT by a signed-in user removed (the server creates tickets) | VA-DB-02 |
| System Log watch list | SLA due dates and pause ledger now audited | VA-DB-01 |
| internal-note attachments | back-fill `is_internal`; file-store read rule now needs the organisation and hides internal files from the requester | VA-INT-01, VA-DB-06 (part) |
| `task-attachments` | direct-upload policy removed | VA-INT-10, VA-DB-05 (part) |
| mobile numbers | read: own row or staff; write: admin / platform owner | VA-INT-13, VA-DB-07 (part) |
| must-change-password flag | column right removed; trigger refuses any client change | VA-API-02, VA-DB-04 |
| config tables | services, SLA policies, SLA config, field SLA overrides: admin / platform owner only | VA-DB-03 (part) |
| privileges | TRUNCATE / TRIGGER / REFERENCES revoked from `anon`, `authenticated` | VA-DB-12 (part) |
**Not run on production.** Before any production use: back up, apply in a maintenance window, restart PostgREST (schema cache), run the rollback rehearsal. See `06-MANAGEMENT/05-RELEASE-PREREQUISITES.md`.

## 2. Dependencies
- Next.js 16.2.9 → **16.3.8** (exact), `eslint-config-next` → 16.3.8, `npm audit fix` (non-breaking). Production-dependency vulnerabilities 9 (1 critical, 5 high, 3 moderate) → 2 moderate (uuid via exceljs: only fix is a breaking downgrade; the vulnerable call is not used). One new lint rule of the upgraded plugin was satisfied with a documented disable in `AnalyticsDashboard.tsx` (browser-only localStorage read).

## 3. Application code (what changed and why, in plain words)
| Area | Files | Change |
|---|---|---|
| Tickets are created by the server only | `lib/actions/requests.ts` | `useAdminForWrites: true` (identity and service checks unchanged) |
| Files on internal notes | `lib/actions/attachments.ts` | file copies the note's internal flag; history entry has no file name for internal files |
| Internal-note alerts | `lib/actions/requests.ts` | alerts and @mentions only reach people who may read the note |
| E-mail replies | `lib/email/inbound-participant.ts` (new), `inbound.ts`, `inbound-auth.ts` | sender must take part in the ticket; auto-replies skipped; DMARC pass must match sender domain; two From lines = no sender |
| Outgoing mail | `lib/email/send.ts`, `lib/actions/approvalEmail.ts` | `Auto-Submitted` headers; approval code only in the body |
| Approvals | `lib/actions/requests.ts`, `approvals.ts`, `lib/approvals/email-code.ts` | submit-for-approval: staff only, no random workflow, sender recorded; ad-hoc names without ticket titles; parallel wrong guesses counted |
| Front gate | `proxy.ts`, `next.config.ts` | only root static files skip the session check; no `X-Powered-By`; upload body limit matches 30 MB; Secure cookies + HSTS when the URL is https |
| Log intake | `app/api/csp-report`, `app/api/events` | trusted address, global cap, size check first, 50-event cap |
| Login | `app/auth/confirm`, `lib/actions/auth.ts`, `lib/rate-limit.ts`, `lib/queries/profiles.ts` | Origin check; server clears the reset flag; password change limited and ends other sessions; inactive profile = signed out; rate-limit key cap |
| Users and admin | `lib/admin/target-guard.ts`, `lib/actions/admin/users.ts` | who-may-change-whom rule extended to details, phones, groups; reporting line and phones admin-only; audit rows for phone changes |
| Mail server settings | `lib/validation/mail-host.ts`, `lib/actions/intake/channels.ts` | shortcut spellings of local addresses refused; changing host/user needs the password again |
| Intake | `lib/actions/intake/rules.ts`, `communication.ts` | regex length cap and nested-repeat refusal; notes need reviewer role |
| Reports | `lib/queries/reporting.ts`, `lib/forms/sections.ts` | technician-only fields hidden from requester-type viewers |
| Forms | `lib/requests/create-request-core.ts` | requester answers only requester-settable fields |
| Previews | `components/admin/RichEmailEditor.tsx`, `lib/attachments/xlsx-preview.ts`, `lib/storage/publicPath.ts` | preview built from clean editor HTML; spreadsheet really unpacked with a hard limit; path regex fixed |
| Misc | notifications / profile / push / knowledge-base actions; approval reminder route | database error text sanitised; `sampleTo` only at the company mail domain |

## 4. Tests changed (not weakened) and tests added
Old assertions that encoded the old rules were updated to the new rules with the reason in the test name: `20-db-critical` (ticket creation is by the server; only the server clears the reset flag), `40-db-high` (technician cannot set priority; can still edit), `118-status-transitions-db` (a non-status edit uses description), `113`, `114`, `90` (priority actions removed earlier), `header-trust` (image-looking nested paths now need a session), `csp-report` (mock), `approval-email-link` / `110` (code read from the body). Nothing was deleted to turn a result green.
Added: `tests/vapt/10`, `11`, `12`, `90` (exploit tests, e-mail participant, performance), `tests/unit/vapt-hardening-units`, `approval-code-burst`, `xlsx-zip-bomb`, `no-priority-change` (earlier), plus the support scripts in `tests/vapt-support/` (UAT users).

## 5. Tooling added
`vitest.vapt.config.ts` (runs only through the isolation gate), `security-assessment-2026-10/02-VAPT/work/build-and-start-audit-app.ps1`.
