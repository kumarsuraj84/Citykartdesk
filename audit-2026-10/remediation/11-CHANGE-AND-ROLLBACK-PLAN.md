# 11 — Change and Rollback Plan

> **Nothing in this document has been executed on production.** It is a plan for a later release that needs the user's **separate, explicit authorization**. All of it was prepared and tested only on the isolated local stack. Per the project's standing rules: test locally, get the user's explicit OK before any push or deploy, never experiment on production, the user runs production migrations on the database server and restarts `CkDeskPostgrest` afterwards, and passwords are only ever typed by the user on the servers.

## 1. What is in the branch

| | |
|---|---|
| Branch | `remediation/post-audit-2026-10`, cut from `e215ebd` (the release already in production) |
| Size | 27 commits · 120 files · +3,839 / −225 lines (75 source files, 37 test files, 8 database files) |
| State | **Local only.** Not pushed, not merged to `main`, not deployed |
| Not in the branch | The audit folder, earlier reports, mock-ups, the launch e-mailer, `.claude/settings.local.json` (left uncommitted, untouched) |

## 2. Database changes (in this order)

| # | Migration | What it does | Rollback | Rollback verified |
|---|---|---|---|---|
| 1 | `…156_post_audit_critical_security.sql` | Closes `owner_delete_org`, `generate_request_no`, `seed_default_sla_config` to client roles; profile self-update limited to name, avatar and clearing the reset flag, plus a guard trigger | `supabase/rollback/20240101000156_rollback.sql` | Executed without error inside a rolled-back transaction |
| 2 | `…157_post_audit_high_security.sql` | Storage policies, company-wide settings, task delete, internal notes, deactivated users (`is_active` in the helpers), ticket-forgery and attachment-row guard triggers | `…157_rollback.sql` | Executed without error inside a rolled-back transaction |
| 3 | `…158_post_audit_rls_performance.sql` | Ticket select/update rules evaluated once per query, three helper functions, `idx_requests_org_updated` | `…158_rollback.sql` | **Applied for real** on the disposable database and the migration re-applied |
| 4 | `…159_ticket_number_overflow.sql` | `generate_request_no()` writes numbers above 999,999 in full | `…159_rollback.sql` | Executed without error inside a rolled-back transaction |

All four are additive or tightening: no table is rewritten, no row is changed. The rollbacks put back the previous behaviour, **which re-opens the audited weaknesses** (they are for undoing a broken deployment only). After running any migration on the production database, **restart `CkDeskPostgrest` on the app server** (its schema cache), as for every earlier migration.

## 3. Order of deployment (important)

1. **Deploy the new application build first.** The new code works with or without the new migrations.
2. **Then** run migrations 156 → 157 → 158 → 159 on the production database.

Why this order: migration 157 refuses SLA deadlines in a ticket INSERT made by a signed-in user. The **old** web ticket-creation code set them in that insert, so running 157 *before* the new build would make web ticket creation fail ("You do not have permission…"). The new build writes the deadlines with the server's client afterwards, so it works either way. Likewise 156 narrows what a signed-in user can update on their own profile; the new code only does what is still allowed.

## 4. Configuration and behaviour changes the owner should know about

| Item | Change | Action needed |
|---|---|---|
| `TRUSTED_PROXY_HOPS` (new, optional) | The number of reverse proxies in front of the app. Unset = 0 = the per-address sign-in limit is off (the per-account limits still apply). Also used for the WhatsApp webhook caller limit | Decide the value for the production network; do not guess |
| `OAUTH_STATE_SECRET` | Mailbox connection (Gmail/Outlook) now needs a signing secret of at least 16 characters (it falls back to `INTAKE_WORKER_SECRET`, then `CRON_SECRET`). A blank value is no longer treated as a valid empty key | Confirm one of them is set and long enough before using the connect flow |
| Scheduled reports | Only administrators can create/change/delete/send them; recipients must be organization addresses | Tell managers; if managers should keep the right, it is a policy change |
| Sign-in | Returns to the page the person asked for (any in-site path) | None |
| Response headers | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` on every response (no CSP, no HSTS) | None; HSTS waits for HTTPS |
| Push notifications | Subscriptions must use a public https address | None |
| WhatsApp webhook | Bodies over 1 MB refused (413); more than 1,200 requests a minute from one trusted caller address refused (429); mixed-phone payloads refused | None |
| Outbound calls | 20 s limit (120 s for mailbox polls and re-classification) | None |
| Ticket numbers | Unchanged below 1,000,000; written in full above | None |
| Attachments | Opened by file extension (images, PDF, text open; others download) | None |

## 5. Pre-deployment checklist (for the later release)

1. The user authorizes the release explicitly (separately from this report).
2. Rebuild and deploy to the **app server only** using the documented procedure in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` (build, deploy, rollback steps; backups).
3. Take the usual database backup **before** running any migration.
4. Run migrations 156–159 on the production database (the user, on the database server), then restart `CkDeskPostgrest`.
5. Re-run the equivalence idea against a **copy** of the production schema (not production): the visibility of tickets for each role must be unchanged (`tests/remediation/70-rls-equivalence.test.ts` is the model).
6. Post-deployment smoke test by the user: sign in as each role; create, assign, start work, comment, resolve and reopen one ticket; open Requests, Queue, Reports and the dashboards; confirm a manager's list is fast; confirm an administrator can still manage users, and a plain administrator cannot change a platform owner.

## 6. Rollback

| Layer | How |
|---|---|
| Application | Redeploy the previous build (the documented rollback in the infrastructure document) |
| Database | Run the matching rollback file(s) in reverse order (159, 158, 157, 156), then restart `CkDeskPostgrest`. Rolling back 157 *after* rolling back the application is safe; rolling back the application while 157 stays applied would break web ticket creation (section 3) |
| Verification after rollback | The same smoke test as above |

## 7. Queued, not done

* The unified audit-trail and system-error capture (requested earlier) was **not built** in this pass; it is queued behind this remediation and needs its own design review (document 10, D-032).
* Open and deferred findings are listed in document 10; those needing the user's decision are D-005, D-011, D-018, D-030, and the design points UI-6/UI-7.
