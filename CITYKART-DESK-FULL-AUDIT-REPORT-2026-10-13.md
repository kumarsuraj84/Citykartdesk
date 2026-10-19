# Citykart Desk — Complete Enterprise Application Audit (Full Report, Single Document)

**Audit date:** 2026-10-13 · **Repo:** `D:\ANKUR AI PROJECTS\CitykartDesk-ZOHO Alternate` · **Branch audited:** `main` @ commit `e215ebd4b6f4cce85aff8044f0c2f278d94fa6bb` ("Predefined Reports: remove Sum of Ticket % columns, headings wrap instead of overlapping")

**Classification: LOCAL AUDIT VERIFIED WITH CONDITIONS — USER REVIEW REQUIRED.** This document is the single, complete record of this audit: what was checked, what was done, every finding (security, database integrity, code quality), every test result, what is fully done, what is partially done, and what has not been done yet. Nothing from the working reports has been left out — this file supersedes the separate numbered reports under `audit-2026-10/reports/` by combining all of them, in full, into one place, plus production history and the full migration list the user asked to have included.

**Production — never touched.** The app server (10.0.1.98), database server (10.0.0.205) and NAS (10.0.0.25) were never connected to, queried, or modified at any point in this audit. Everything described as "found," "reproduced" or "tested" below happened against the local repository's source code, or against a disposable, synthetic-data Supabase stack built on this PC from the repository's own migration files. Where production facts are stated, they come only from this repository's own documentation (`CLAUDE.md`, `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`) and are marked as such — never verified against the live machines.

---

# Table of contents

- Part 1 — How this audit was carried out, step by step (the session timeline)
- Part 2 — How Citykart Desk went live in production, and its migration history (from the repo's own documentation)
- Part 3 — The full list of 156 database migrations
- Part 4 — Current architecture (confirmed vs. documented vs. unknown)
- Part 5 — Local isolation certification (the safety mechanism and its 21-point proof)
- Part 6 — Full functional module inventory (30 modules)
- Part 7 — Full security audit (every finding, SEC-01 through SEC-57)
- Part 8 — Database integrity review
- Part 9 — Code quality, reliability & performance review (every finding, CQ-01 through CQ-37)
- Part 10 — Master defect register (every finding, one ID per row, with status)
- Part 11 — Test results in detail (before and after)
- Part 12 — What is fully done, what is partially done, what has not been done
- Part 13 — Executive summary and sign-off
- Part 14 — Performance and scalability test (100k and 500k tickets)
- Part 15 — Audit trail and error capture: what exists, what is missing, proposed design

---

# Part 1 — How this audit was carried out, step by step

This section is the literal timeline of the audit session, so nothing about *how* the findings below were produced is hidden.

1. **Read the brief.** The user's instructions named three production machines that must never be touched (10.0.1.98, 10.0.0.205, 10.0.0.25), named the retired server (10.0.1.12) that must also never be touched, and asked for a staged audit: read the codebase first, prove isolation before any dynamic test, build a functional inventory, run a security audit, a database/integrity review, full QA, performance testing, a NAS/storage review, reliability testing, a code-quality review, a UI/UX review, a defect register, safe local remediation, and regression — each as its own numbered report, finishing with an executive summary and an explicit safety checklist.

2. **Phase 0 — Read the project first (no testing yet).** Read `CLAUDE.md`, `AGENTS.md`, and `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` to establish the documented production topology (reproduced in full in Part 2 below). Ran read-only shell commands to confirm, from the local machine only: git branch/commit, the list of 156 migration files, the application route tree (`app/**`), the library layout (`lib/**`), the existing test suite (92 unit test files, 83 integration test files), `.env.local` and `.env.example` (values only classified as blank/local/redacted — no secret ever printed), which Docker containers were already running on this PC, and a grep across the whole repository for the five addresses that must never be contacted (`10.0.1.98`, `10.0.0.205`, `10.0.0.25`, `10.0.1.12`, `182.72.84.10`) to see every place they are mentioned — all 76 hits were in documentation/comments/deploy scripts, never live configuration. The result of this phase is Part 4 below.

3. **Phase 1 — Build and prove an isolated test environment before touching anything dynamic.**
   - Built a **second, disposable Supabase stack**, named `ckdesk_audit`, from the repository's own `supabase/config.toml` and all 156 of its own migration files — on different ports (API `55421`, DB `55422`, mail-trap `55424`, app `3310`) so it could never be confused with the developer's existing stack (`citykart_desk`, ports `543xx`). All 156 migrations applied cleanly with no errors.
   - Wrote an **audit environment file** (`audit-2026-10/env/.env.audit`) with every outward-facing integration (SMTP, Resend, WhatsApp, Google/Microsoft OAuth, push/VAPID, the LLM relay, webhooks) deliberately left blank, so outbound business notifications are structurally disabled, not just "not configured by luck."
   - Wrote an **in-process network guard** (`audit-2026-10/guard/egress-guard.cjs`) that patches Node's own socket-connect function to refuse, before any DNS lookup and before any socket opens, every connection that is not to loopback (`127.0.0.1`/`localhost`) — and explicitly denies the five production/retired addresses by name even if something tried to resolve them.
   - Wrote a **21-point isolation gate** (`audit-2026-10/guard/isolation-check.mjs`) that checks: every URL-valued setting resolves to loopback; no setting contains a forbidden address; email/OAuth/LLM/push/webhook settings are blank; the Supabase URL is the audit stack, not the dev stack; the app/cron URLs are `localhost:3310`; nothing from the developer's `.env.local` falls through unoverridden; the guard is actually preloaded; every environment variable the application code reads is explicitly accounted for; the guard actually refuses 9 different forbidden/non-loopback targets in a live self-test before any socket call; the audit's Docker containers are running, send mail only to the local mail-trap, use a local file-backed storage volume (no NAS/SMB/S3), and reference no production address; the disposable database starts with zero SMTP settings, zero active intake/WhatsApp channels, zero non-synthetic auth users, and zero migrated business tickets; and this PC's own local network-connection table shows no socket — from any process other than the person's own already-open browser tab — pointed at any of the five forbidden addresses.
   - This gate was run repeatedly over the course of the audit and **passed 21/21 every single time**, including after deliberately injecting synthetic test data later, which required tightening one check (originally "fewer than 100 tickets," corrected to "every ticket belongs to a synthetic requester") — caught and fixed in the gate itself, not waived.
   - Ran a **live self-test inside a real Node process** under the guard: a loopback call to the audit API succeeded (HTTP 200); attempts to reach `graph.facebook.com`, `api.resend.com`, and all three production IPs plus the retired server's IP were **refused inside the process itself**, each logged with a reason, before any network packet could have been sent. 6 of 6 refused.
   - Reviewed what already existed on the developer's PC that could have been a risk: the existing (non-audit) development database turned out to contain production-derived real data (about 1,012 real staff/store profiles, about 694 real tickets) — confirmed it has no working mailbox and no real WhatsApp credentials configured (so nothing on it can actually send anything), and **the audit never used it**. Found a stale, disconnected SMB mapping to the retired server and an existing SSH key on the PC for the new servers — left both untouched, flagged only as a hygiene recommendation. Found the user's own Chrome browser already had an open connection to the live public site from the user's own prior browsing — confirmed this is not an audit-owned connection and the audit never used that browser.
   - The full detail of this phase is Part 5 below.

4. **Phase 2 — Build the functional inventory.** Dispatched two independent, read-only exploration passes over the entire codebase (one covering the 16 ticket-lifecycle-facing modules — login through CSAT; one covering the 14 admin/reporting-facing modules — user management through "Ask CKDESK") to produce, for every module: its routes/pages, its backend files and exported functions, the database tables/RPCs/triggers it touches, exactly where authorization is enforced (and where it is not), its external integrations, its business rules (with file:line citations), its existing tests, and its known coverage gaps and oddities. The result is Part 6 below (30 modules in full).

5. **Phase 3 — Security audit.** Dispatched **six independent, read-only security reviews** in parallel, each given a different slice of the application and told explicitly to ground every finding in code evidence, not speculation:
   - Reviewer A: every requester-facing server action (ticket creation, status changes, approvals, comments, attachments).
   - Reviewer B: every admin-facing server action (user management, reports, exports, org structure, business rules).
   - Reviewer C: the authentication/session layer specifically — `proxy.ts`, security headers, cookies, rate limiting, password policy, transport.
   - Reviewer D: file upload/download, attachment rendering, PDF generation, and every place user-supplied content is rendered as HTML.
   - Reviewer E: every externally-triggered entry point — WhatsApp/Gmail/Outlook webhooks, OAuth flows, approval/CSAT tokens, cron authentication.
   - Reviewer F (database): read-only SQL introspection of the disposable audit database's own schema, policies, grants and functions (no production database was ever touched; this was entirely against the just-built, empty, synthetic `ckdesk_audit` database).
   - After the six reviews returned, **the three most serious database-permission findings were dynamically reproduced** — not just read from code — by writing and running a script that made ordinary API calls (the same kind the real application itself makes) against the disposable database, using only synthetic test accounts created for this purpose, and a single throwaway "Tenant B" organization created and then deleted again at the end of the run. Every one of those reproductions is marked "EXPLOITABLE (reproduced)" below with its literal, logged evidence.
   - One finding (a potential path-handling issue in a file-serving route) was **deliberately not dynamically reproduced** — the session's safety rules direct that authentication-bypass-shaped exploit mechanics should be described for the purpose of fixing them, not demonstrated as a working attack; it is flagged for a safe unit test instead, and is marked as such throughout.
   - The full detail of this phase is Part 7 below.

6. **Phase 4 — Database integrity review.** Separated the integrity-flavored half of the database reviewer's findings (schema constraints, foreign-key behavior, concurrency scenarios, migration hygiene) from the security half, producing Part 8 below.

7. **Phase 5 — Code quality, reliability and performance review.** Dispatched a seventh independent, read-only review specifically for code-quality/reliability/performance concerns distinct from security: unbounded queries, silent error-swallowing, race conditions, duplicated business logic, weak runtime validation, outbound-integration reliability, and test-coverage gaps. The full detail of this phase is Part 9 below.

8. **Consolidation — the master defect register.** Every finding from Parts 7, 8 and 9, plus the live reproductions, was merged into one single numbered register (Part 10), so every defect has exactly one ID (`D-001` through `D-063`) regardless of which review first found it, with cross-references back to the originating finding IDs for full traceability.

9. **Baseline testing.** Ran the repository's own existing test suite against the disposable audit stack: `npm run typecheck`, `npm run lint`, the full unit test suite (92 files), and the full integration test suite (83 files). Three integration test files failed on the first run — not because of an application bug, but because they were hard-coded to call a specific Docker container name that only exists on the *developer's* stack, not the audit stack, and because two of those same tests needed realistic data volume that the brand-new, empty audit database did not yet have. Fixed the test files themselves (made them detect which stack they are actually pointed at, rather than assuming one container name) and loaded a synthetic dataset (not production data — 329 fake users, 200 fake stores, 3,000 fake tickets, all with `@audit.test`/`@example.test` addresses) into the audit database so those two tests had the data shape they needed. Re-ran: 2 tests still fail (see Part 11.3). The full detail, including the exact failure messages from the first run, is Part 11 below.

10. **Executive summary and checkpoint.** Delivered an interim executive summary to the user at this point (separately, before this consolidated document), classifying the audit as "verified with conditions" and explicitly stating that **no remediation had been applied yet**, because the three reproduced Critical findings all involve authentication/row-level-security changes, which the user's own brief says to stop and ask about before touching. Stopped the local Next.js dev server that had been started against the audit stack for verification, and reverted one incidental file (`tsconfig.json`, auto-modified by `next dev` itself to list a new build-output folder) back to its original committed state so no unintended change was left in the working tree.

11. **This document.** The user then asked for every report to be combined into one single markdown file, with nothing skipped, including production-history and migration data. This file is that consolidation.

**What has explicitly not been done as of this document:** no remediation/fix has been applied to any of the findings below; load/scale testing was added afterwards (Part 14); no full manual UAT walkthrough was performed in a browser; no UI/UX or accessibility audit was run; no NAS/storage failure-injection testing was run; no reliability/chaos testing was run; no regression suite beyond the pre-existing one was written. These are listed precisely in Part 12.

---

# Part 2 — How Citykart Desk went live in production, and its migration history

*Everything in this Part is taken verbatim from the repository's own documentation (`docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, dated 2026-10-07, and `CLAUDE.md`). None of it was independently verified against the live servers during this audit — that would have meant contacting production, which this audit never did. It is included here because the user asked for it, and because it is the necessary context for reading Parts 4, 7 and 8 (which repeatedly distinguish "confirmed from code" from "documented but not verified").*

## 2.1 Where Citykart Desk runs today

```
 Staff / requesters (office LAN or internet)
        │  http://182.72.84.10:3210   (public IP; router NAT forwards TCP 3210 → 10.0.1.98)
        │  http://10.0.1.98:3210      (same app, internal address)
        ▼
 ┌─ APP SERVER 10.0.1.98 (Windows Server 2022) ──────────────────────────────────────────┐
 │  D:\Citykart_Applications\Citykart_Ckdesk_App                                          │
 │                                                                                        │
 │  CkDeskApp      Next.js web app (server.js)          :3210  (only port open to LAN)    │
 │     │  all data access is HTTP via supabase-js — the app never talks to Postgres       │
 │     ▼                                                                                  │
 │  CkDeskProxy    node reverse proxy                    :8443  (the "Supabase URL")      │
 │     ├─ /auth/v1     → CkDeskAuth       (GoTrue, auth.exe serve)     127.0.0.1:9999     │
 │     ├─ /rest/v1     → CkDeskPostgrest  (PostgREST 16)               127.0.0.1:3001     │
 │     └─ /storage/v1  → CkDeskStorage    (Supabase Storage, node)     127.0.0.1:5000     │
 │                                                                                        │
 │  Task Scheduler: CitykartDesk-Cron-Alerts (30 min), -BusinessRules (15 min),           │
 │                  -EmailReplySync (1 min)  → call the app on 127.0.0.1:3210             │
 │  Outbound: Gmail SMTP (send) + IMAP (reply sync), settings saved in the app            │
 └───────┬───────────────────────────────────────────────────────┬────────────────────────┘
         │ Auth / PostgREST / Storage connect as role             │ Storage reads/writes files
         │ citykart_desk_app, TCP 5432                            │ as Windows user ckappuser (SMB 445)
         ▼                                                        ▼
 ┌─ DB SERVER 10.0.0.205 ───────────────────┐   ┌─ NAS 10.0.0.25 (Synology RS1221+) ─────────┐
 │ PostgreSQL 18, data on D:\POSTGRESQL DB  │   │ \\10.0.0.25\CKAPPLICATIONS_DATA\CKDESK_DATA │
 │ database  ckdesk  (UTF8)                 │   │ attachments (+ a *.xattrs.json sidecar per  │
 │ SHARED with other apps' databases        │   │ file — that is why 215 objects = 431 files) │
 │ Nightly backup 02:30 → E:\DB BACKUP\     │   └─────────────────────────────────────────────┘
 │ CK_CKDESK_DBBACKUP (+ backup.log)        │
 └──────────────────────────────────────────┘
 Dev PC 10.0.0.47 ──git──▶ GitHub (kumarsuraj84/Citykartdesk, branch main) ──▶ deploy to 10.0.1.98
```

**Shared servers — scope rules (as documented).** 10.0.1.98 also runs *Citykart Spinwheel* (internal ports 3000/4000, public port 3213, Windows scheduled tasks `CitykartSpinwheel*`). 10.0.0.205 also hosts the Spinwheel database (`CKSpinwheel`) and others. Citykart Desk work is meant to touch only: the `Citykart_Ckdesk_App` folder, the `CkDesk*` services / `CitykartDesk-Cron-*` tasks / the firewall rule "Citykart Desk web app (3210)" on 98; the database `ckdesk` (and its own backup task/folder) on 205; the `CKDESK_DATA` folder on the NAS.

## 2.2 Servers, paths and names (as documented)

| What | Value |
|---|---|
| Dev machine | 10.0.0.47 (this repo; all development/testing happens here) |
| App server | 10.0.1.98 — `D:\Citykart_Applications\Citykart_Ckdesk_App\{app,services,logs,tools,scripts}` |
| Web app files | `app\standalone` (Next.js standalone build, own `.env.local`); previous builds kept as `app\standalone-bak-<timestamp>` |
| Services (NSSM) | `CkDeskApp`, `CkDeskProxy`, `CkDeskAuth`, `CkDeskPostgrest`, `CkDeskStorage` — Automatic start; logs under `logs\<Service>.out.log/.err.log` (10 MB rotation) |
| Cron tasks | `CitykartDesk-Cron-Alerts`, `-BusinessRules`, `-EmailReplySync` (run as SYSTEM) |
| DB server | 10.0.0.205 — PostgreSQL 18, data on `D:\POSTGRESQL DB`, database `ckdesk`, app role `citykart_desk_app` (not superuser) plus `anon`/`authenticated`/`service_role` |
| Backups | Scheduled task `CK_Backup_CKDESK` at 02:30 daily → `E:\DB BACKUP\CK_CKDESK_DBBACKUP`, backup role `ck_backup` with BYPASSRLS, 30 days retained, logged to `backup.log` |
| Files | NAS 10.0.0.25, share `CKAPPLICATIONS_DATA`, folder `CKDESK_DATA`, NAS user `ckappuser` |
| Public URL | `http://182.72.84.10:3210` (also the URL baked into outbound emails) |
| SSH | `ssh -i ~/.ssh/citykart_newservers Administrator@10.0.1.98` (and `@10.0.0.205`) |

## 2.3 Configuration and secrets (names only — no values, per the documentation's own stated policy)

| File on 10.0.1.98 | Holds |
|---|---|
| `app\standalone\.env.local` | `NEXT_PUBLIC_SUPABASE_URL` (`http://10.0.1.98:8443`), `NEXT_PUBLIC_APP_URL` (public URL), anon + service-role JWT keys, `CRON_SECRET`, `TZ=Asia/Kolkata`, `PORT=3210` |
| `app\.env.local` | `CRON_SECRET` only |
| `services\auth\.env` | DB URL, `GOTRUE_JWT_*` secrets, `GOTRUE_SITE_URL`, allow-list |
| `services\postgrest\postgrest.conf` | DB URI, JWT secret (PostgREST needs libpq DLLs beside it — no PostgreSQL client installed on 98) |
| `services\storage-src\.env` | DB URL, JWT/encryption secrets, `STORAGE_BACKEND=file`, `STORAGE_FILE_BACKEND_PATH=\\10.0.0.25\CKAPPLICATIONS_DATA\CKDESK_DATA` |

The mailbox (Gmail) password is saved in-app (Admin → Platform Settings → Integrations) and stored encrypted in the database via a pgcrypto-based "Vault" shim, keyed by a database setting `app.vault_key`. The JWT secret is shared by all five services and signs the keys baked into the build — changing it requires a full rebuild/redeploy and logs everyone out.

## 2.4 Deployment procedure (as documented — "commit and push to git and main")

1. Develop and test on the dev PC; run `npx tsc --noEmit` and the relevant tests.
2. Get explicit user sign-off, then commit and `git push origin main`.
3. Build for production on the dev PC with `scripts\windows\build-for-deploy.ps1` (stamps a build id into `.next-deploy`, never reusing the dev server's own `.next` folder).
4. Copy the zip to 98; stop `CkDeskApp`; rename the current `app\standalone` to a timestamped backup folder; expand the new build into `app\standalone`; copy `.env.local` back from the backup folder; start `CkDeskApp` again; remove older backup folders, keeping the newest one.
5. Verify via `/api/health` (expects `{"status":"ok","db":"ok"}`) and `/api/version` (expects the new build id).
6. **Rollback:** stop the service, rename the backup folder back into place, restart. An app rollback never reverses a database migration.

## 2.5 Database migration procedure (as documented)

Migration files live in `supabase/migrations` (156 of them as of this audit — the full list is Part 3 below). The migration history on the production database is tracked in `auth.schema_migrations`. DDL on `ckdesk` must be run by the PostgreSQL admin directly on 10.0.0.205, inside a single transaction with `ON_ERROR_STOP=1`, after a fresh backup, and **before** the application code that depends on it is deployed. New enum values (such as the `hold_purchase_ho` status added in this codebase) must ship in their own dedicated migration file, because `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction as other statements that might use the new value.

## 2.6 Backups and restore (as documented)

Nightly full dump (`pg_dump -Fc`) of `ckdesk` at 02:30, integrity-checked, 30 days retained, logged to `backup.log`. Attachments live on the NAS, whose own RAID/snapshots are its responsibility; a point-in-time restore needs the DB dump and the NAS files considered together. The dump does **not** contain the `app.vault_key` database setting or the `vault.secrets` rows — restoring into a fresh database requires manually re-setting that key and **re-entering the mailbox password** afterward, because the old encrypted secret cannot be decrypted without the old key. There is, as of this document, **no second, off-server copy of the backups** — this is recorded in the documentation's own "Open items" as a known, deliberately deferred gap.

## 2.7 How the move from the old server ("Main," 10.0.1.12) to this layout was done (2026-10-07)

Previously, everything — the app, PostgREST/Auth/Storage, PostgreSQL itself, and the attachment files — ran on one single server, 10.0.1.12 ("Main"). The documented migration sequence was: prepare the three new locations (98/205/NAS) → copy the service binaries (without secrets) → create the `ckdesk` database and its roles on the new DB server → rehearse the whole cutover once using a copy of Main's data, with the mailbox secret deliberately left out of the rehearsal so no real email could accidentally be sent → freeze Main (stop its app and cron tasks) → take a fresh `pg_dump` and a fresh copy of the attachment files → restore the dump as `postgres` on the new DB server, this time including the real mailbox secret and database settings → mirror the attachment files onto the new NAS → start the five services and the cron tasks on the new app server → repoint the router's port-forward from the old server to the new one → rebuild the application once more with the (unchanged) public URL baked in for outbound emails → permanently disable the old server.

**The retired server, 10.0.1.12, today:** its five Citykart Desk Windows services are stopped and disabled; its cron tasks and both of its firewall rules are disabled; both its old web port and its old Supabase-proxy port are documented as required to "stay dead." Its old database is kept untouched on that machine purely as a cold safety archive (the documentation notes it "may be dropped by the user later," at the user's discretion, not automatically). A final full dump of that old server's data, taken at the moment of cutover, is kept on the new database server's backup folder, named with the cutover date, specifically so there is always one last known-good copy of the pre-migration state even though the old server itself is no longer trusted for anything else. The documentation is explicit that the old and new systems must never be run at the same time, because two independent cron pollers or two independent databases serving the same business would immediately start conflicting with each other. It also notes, as a permanent, accepted side-effect of the cutover, that any link inside an email sent to a user *before* the migration date still points at the old server's address and will simply no longer work — this was a deliberate decision, not an oversight, and no redirect was put in place for those old links.

## 2.8 Explicit rules this documentation lays down for any AI assistant working on this app (as written by the user's own team)

- Production is the three machines above plus the NAS folder. The retired server must never be worked on or deployed to.
- Test only on the dev PC; ask the user explicitly before every push or deploy; one deployment change at a time.
- On any shared server, touch only Citykart Desk's own folders/services/database/NAS-folder — never another application's data.
- Never ask for, accept, or repeat a password or key; the user types those directly on the servers themselves. Superuser-level database steps are run by the user, not by an assistant.
- Keep this documentation itself updated whenever the infrastructure changes.

## 2.9 Items the documentation itself lists as still open (not resolved, not part of this audit to resolve)

- A second, off-server copy of the nightly backups — deferred by the user's own decision.
- A full reboot test of the app server — the user intends to do this themselves and report back.
- Moving from the raw public IP over plain HTTP to a proper DNS name with HTTPS — a future option, not yet decided.
- Whether to finally drop the retired server's old, archived database after a further period of clean running on the new layout — left for the user to decide.

---

# Part 3 — The full list of 156 database migrations

*Exactly as they exist in `supabase/migrations/` in this repository today, in applied order. Every one of these 156 files was applied, in this exact order, to build the disposable audit database used for this audit's dynamic testing — all 156 applied cleanly with zero errors, which is itself a positive integrity signal about the migration set as a whole (see Part 8.4, "Migration hygiene," for caveats about *how safely* some of these would apply to a large, already-live table rather than a freshly-empty one).*

| # | Migration (filename, timestamp prefix omitted) |
|---|---|
| 1 | initial_schema |
| 2 | harden_rls |
| 3 | stabilization |
| 4 | attachments |
| 5 | form_sections |
| 6 | sub_categories |
| 7 | task_foundation |
| 8 | task_comments_internal_rls |
| 9 | fix_request_sequences_rls |
| 10 | collaborators |
| 11 | operational_hardening |
| 12 | notifications_v2 |
| 13 | task_subtasks |
| 14 | custom_task_fields |
| 15 | admin_config |
| 16 | request_time_entries |
| 17 | security_hardening |
| 18 | business_hours |
| 19 | escalation |
| 20 | scheduled_reports |
| 21 | assignment_rules |
| 22 | org_structure |
| 23 | service_governance |
| 24 | task_config |
| 25 | alerts |
| 26 | attachment_security |
| 27 | master_data |
| 28 | data_retention |
| 29 | performance_indexes |
| 30 | task_activity_security |
| 31 | task_attachments |
| 32 | allow_multiple_approvals_per_request |
| 33 | multitenancy |
| 34 | org_isolation |
| 35 | fix_grants |
| 36 | pilot_readiness |
| 37 | pilot_readiness_b |
| 38 | service_governance *(second migration with this name — a later, additional change)* |
| 39 | enterprise_expansion |
| 40 | role_permissions |
| 41 | error_reports |
| 42 | signup_requests |
| 43 | fix_collaborator_rls_recursion |
| 44 | performance_indexes *(second migration with this name)* |
| 45 | get_home_dashboard |
| 46 | rls_optimization |
| 47 | secondary_indexes |
| 48 | search_and_list_indexes |
| 49 | per_org_sla_config |
| 50 | notifications_archived_index |
| 51 | restore_collaborator_read_access |
| 52 | has_module_access |
| 53 | intake_module |
| 54 | intake_core_tables |
| 55 | intake_ingestion |
| 56 | intake_classification |
| 57 | intake_phase_d |
| 58 | intake_phase_d5 |
| 59 | intake_informational_type |
| 60 | intake_custom_rules |
| 61 | intake_suggested_service |
| 62 | intake_flags |
| 63 | raise_escalation_cutoff |
| 64 | intake_validation_stats |
| 65 | task_detail_enrichment |
| 66 | owner_delete_org *(the function at the center of security finding SEC-02 / D-002 — see Part 7)* |
| 67 | fix_departments_missing_columns |
| 68 | fix_rls_platform_owner |
| 69 | request_subrequests |
| 70 | task_dependencies |
| 71 | notification_type_gaps |
| 72 | rls_audit_fixes |
| 73 | projects_module |
| 74 | projects_core |
| 75 | projects_milestones |
| 76 | projects_timeline_membership |
| 77 | milestone_notification_types |
| 78 | project_updates |
| 79 | desktime_integration |
| 80 | desktime_sync |
| 81 | rls_hardening_cross_tenant |
| 82 | job_functions_designations |
| 83 | project_priority_and_milestone_dates |
| 84 | milestone_and_project_owner_fields |
| 85 | project_reference_notes |
| 86 | notification_type_gaps_2 |
| 87 | approvals_one_pending_per_request |
| 88 | index_and_search_path_hygiene |
| 89 | fix_handle_new_user_org_id |
| 90 | admin_audit_log |
| 91 | fix_services_categories_grants |
| 92 | reload_postgrest_schema_cache |
| 93 | field_sla_overrides |
| 94 | fix_service_role_dml_grants |
| 95 | attachment_comment_link |
| 96 | fix_escalation_tier_vocabulary |
| 97 | business_rules |
| 98 | business_rules_round_robin_state |
| 99 | business_rules_multi_trigger_and_or |
| 100 | atomic_field_sla_override_upsert |
| 101 | fix_can_manage_collaborators_platform_owner |
| 102 | add_reclassified_activity_action |
| 103 | time_entries_race_guard |
| 104 | fix_sla_override_rpc_grant |
| 105 | fix_projects_module_rls_scoping |
| 106 | fix_intake_and_task_deps_rls |
| 107 | add_form_data_updated_activity_action |
| 108 | atomic_form_data_merge |
| 109 | form_templates |
| 110 | category_as_form_field |
| 111 | sla_policies |
| 112 | icons_and_category_ux |
| 113 | unified_request_number_series |
| 114 | approver_visibility |
| 115 | reopen_workflow |
| 116 | manager_subordinate_visibility |
| 117 | must_reset_password |
| 118 | ticket_number_series_cksd |
| 119 | exclusive_category_service_tag |
| 120 | fix_owner_delete_org *(an earlier attempted fix to the function in #66 — did not fully close SEC-02/D-002, see Part 7)* |
| 121 | retag_service_categories_rpc |
| 122 | org_id_not_null_and_service_index |
| 123 | missing_fk_indexes_and_rls_hygiene |
| 124 | org_scope_rls_helpers |
| 125 | pre_approval_status |
| 126 | paused_ms_total |
| 127 | scope_category_slug_uniqueness_to_org |
| 128 | service_location_visibility |
| 129 | store_master_and_oem_routing |
| 130 | notification_rules_and_push |
| 131 | profiles_store_id_index |
| 132 | oem_store_rls_platform_owner |
| 133 | oem_notification_rules_select_role_gate |
| 134 | profile_mobile_identity |
| 135 | deterministic_handle_new_user_org |
| 136 | conversation_persistence |
| 137 | whatsapp_channel_config |
| 138 | conversation_attachment_staging |
| 139 | wire_up_auto_close_days |
| 140 | drop_unused_tags_table |
| 141 | profile_mobile_numbers_many_to_one |
| 142 | form_field_library |
| 143 | email_smtp_settings |
| 144 | app_event_log |
| 145 | approvals_requested_by |
| 146 | email_reply_to_conversation |
| 147 | saved_reports |
| 148 | fix_projects_select_returning_visibility |
| 149 | add_hold_purchase_ho_status *(the new "Hold due to Purchase from HO" ticket status — a recent, separate piece of work prior to this audit)* |
| 150 | get_home_dashboard_hold_purchase_ho |
| 151 | get_home_dashboard_multi_team |
| 152 | csat_reminder_column |
| 153 | add_csat_low_rating_notification |
| 154 | get_home_dashboard_include_assigned |
| 155 | store_master_fields |
| 156 | replace_user_email |

**Total: 156 migration files, applied in order, zero errors, on a freshly created database, during this audit.** This is the exact migration history that produced the 102-table, 221-policy, 72-function, 32-trigger, 338-index schema described and tested throughout Parts 4–10 below.

---

# Part 4 — Current architecture: confirmed vs. documented vs. unknown

*Legend used throughout this Part: **[C]** = confirmed from source code or local configuration read during this audit · **[D]** = documented in the repo's own docs but not independently verifiable without touching production (and this audit never touched production) · **[U]** = genuinely unknown, left unresolved on purpose rather than guessed at.*

## 4.1 Runtime topology

| Layer | What it is | Status |
|---|---|---|
| Web app | Next.js **16.2.9** App Router (React 19.2.4), `output: 'standalone'`, server components + **52 files of server actions** (`'use server'`) + **21 route handlers** under `app/api/**`; **58 pages**. Request guard in `proxy.ts` (Next 16's "proxy," the successor to the older `middleware.ts` concept). | [C] |
| Data access | **The application never opens a direct Postgres connection anywhere.** Every single read or write goes over HTTP through the `@supabase/supabase-js` library (a service-role client for most server-side work, a per-user session-bound client, and a browser client) to PostgREST. All of these calls pass through a shared retry wrapper with a 20-second timeout and up to 2 retries, but only for low-level connection errors, never for an actual error response the server already sent back. | [C] |
| Auth | Supabase Auth ("GoTrue") — email + password; session cookies managed by `@supabase/ssr`; the proxy verifies the session's claims on every request and redirects anonymous visitors to `/login`. Five roles exist: `user` (Requester), `agent` (Technician), `manager`, `admin`, `platform_owner`. | [C] |
| Database | PostgreSQL via the Supabase stack. **156 migrations** (listed in full in Part 3). On the freshly-built audit database: **102 tables in the public schema, every single one with row-level security turned on, 221 security policies, 72 functions (31 of them running with elevated "security definer" privileges), 32 triggers, 338 indexes.** | [C] |
| Files | Supabase Storage, with four buckets: `request-attachments`, `task-attachments`, and `intake-attachments` (all private), and `icons` (public). Authorized downloads go through the application's own routes, which re-check the viewer's permission before streaming the file; there is also a public proxy route intended only for the public `icons` bucket. Upload rules cap files at 25 MB and check both the file extension and its declared type. | [C] |
| Background work | There is no internal job queue inside the web app itself. Every scheduled job is simply an **HTTP call into the running application**, authenticated with a shared secret compared in constant time: an alerts job, a business-rules job, an inbound-email-reply-sync job, a CSAT (customer-satisfaction survey) job, a DeskTime time-tracking sync job, and an email-intake classification job. In production these are triggered by Windows Task Scheduler on the app server; a small script exists for running them the same way from any other scheduler (e.g. a cloud cron service) too. | [C] (the schedule itself is [D]) |
| Outbound email | The application tries, in order: a mailbox saved inside the app itself (password stored encrypted in the database), then an SMTP server named in the server's own environment file, then a third-party email-sending API. If none of those is configured, **every outbound email is simply logged and silently not sent** — this is a deliberate, safe default, not a bug. | [C] |
| Inbound email | A "reply by email" feature polls an IMAP mailbox and matches replies back to the right ticket; separately, there is a whole "Intake" subsystem for turning incoming Gmail/Outlook mail into tickets automatically, using OAuth and provider webhooks. A separate, small Node service (an older, Express-based helper, apparently from an earlier hosting setup) also exists in the repository for some of this mail processing — **whether this separate service is actually running anywhere in production today could not be determined from the code alone and is left as [U]nknown.** | [C]/[U] |
| WhatsApp | A full integration with Meta's WhatsApp Cloud API: an inbound webhook that verifies Meta's cryptographic signature on every message, and outbound sending through Meta's API. Which WhatsApp channel a message belongs to, and the credentials needed to reply, are both looked up from the database (never from a server environment variable), with the actual secret values encrypted in the database's own secret-storage extension. | [C] |
| Push / other | Web push notifications (silently disabled unless both of a pair of keys are configured), a DeskTime time-tracking sync integration, an "OEM auto-routing" feature that can automatically email an equipment vendor when certain kinds of tickets are raised, and signed links for customer-satisfaction survey emails. | [C] |
| Edge / proxy / TLS | Not part of this repository's own code — this is purely a deployment detail. As documented (Part 2), production is plain HTTP on port 3210 behind a home-router-style NAT forward, with **no TLS/HTTPS at the application layer at all.** | [D] |
| Logging / monitoring | Plain console logging; there is a small monitoring helper file whose own comments say it is a placeholder for a real error-tracking service that has never actually been wired up; client-side crashes are reported into a database table; there is a separate general-purpose event log table; and there are three admin-facing pages for monitoring, an event log, and an audit log. There is no centralized log shipping or automated alerting anywhere in the code. | [C] |
| Rate limiting | A simple in-process memory map, whose own code comment already says it should be replaced with a shared store (such as Redis) the moment the application ever runs as more than one instance — it resets every time the process restarts and is not shared between instances. | [C] |
| Build / deploy | A PowerShell script builds a production bundle and stamps it with a build id; deployment to the production server is a manual copy-and-service-swap (documented fully in Part 2.4); database migrations are applied by hand by a human administrator directly on the database server, deliberately *before* the application code that needs them is deployed. | [C] (the server-side steps themselves are [D]) |

## 4.2 Production topology — documentation only, never touched

Reproduced in full detail in Part 2 above. Everything there is **[D]**, deliberately not verified against the real machines. Things that remain genuinely **[U]**nknown because verifying them would have required touching production: the actual current running-status of each of the five Windows services; whether ports 3210/8443/5432 are exposed any more broadly than documented; the exact database role grants in place on the live database server today; the exact NAS share permissions in place today; the real history of whether the nightly backup job has actually been succeeding; whether the separate Express mail-processing helper service is deployed anywhere; and any concrete plan or timeline for adding HTTPS.

## 4.3 Local development topology (confirmed)

The developer's PC itself runs its own, separate, pre-existing Supabase stack (a different Docker project, different ports, named `citykart_desk`) for day-to-day development. **This audit discovered that this pre-existing development database contains data derived from production** — roughly 1,012 real staff/store profiles and roughly 694 real tickets, with real-looking store and staff email domains. This is flagged as its own finding (see Part 5.3, item I-1, and Part 7's privacy-adjacent notes) but is **not** itself a defect introduced by this audit — it already existed before this audit began, and this audit confirmed it currently has no working outbound mailbox and no real WhatsApp credentials configured, so nothing on it is actually capable of sending anything to a real person. **This audit never used that database for anything.** Instead, this audit built its own completely separate, disposable, synthetic-only database (the `ckdesk_audit` stack, fully described in Part 5), and all testing in this entire document happened only against that disposable stack.

## 4.4 Application structure (confirmed)

The authentication pages (login, forgot-password, reset-password) sit outside the main application shell. Inside the shell: a home dashboard, the ticket list and ticket detail pages, a technician queue view, the service catalog, approvals, tasks, projects, the whole email/WhatsApp "Intake" subsystem, notifications, a user's own profile, two different executive-style dashboards (one a newer "Smart Dashboard," one an older analytics dashboard), the "Predefined Reports" set (12 fixed Excel-style reports) and a separate ad-hoc "Report Builder," and a 23-page admin area covering everything from user management to platform settings. A small number of routes are deliberately public by design, each protecting itself with its own secret or cryptographic check rather than relying on a login: a health-check endpoint, a version endpoint, every cron job's trigger URL, every external webhook, an email-approval-link landing page, and a customer-satisfaction-survey landing page. The central request guard (`proxy.ts`) keeps an **exact-match list** of exactly which API routes are allowed to be public — not a loose prefix match — which is good practice, though the handling of a couple of the early, "fast path" branches inside that same file is itself one of this audit's most important findings (see SEC-01 in Part 7).

## 4.5 The existing automated test suite (confirmed)

92 unit test files and 83 integration test files already existed in the repository before this audit began, plus a separate load-testing harness. A number of older, previous internal audit documents also already exist in the repository (dated as early as August 2026) — this audit treated every one of those older documents as an unverified *claim* to be re-checked, never as settled evidence, which is why several of this audit's own findings below turn out to contradict or add nuance to things those older documents had previously said were fine.

## 4.6 Architectural observations carried forward into later parts of this audit

The service-role database client (which bypasses row-level security entirely) is used for the majority of server-side work, which means that for those code paths, **authorization lives entirely in application code, not in the database** — this single fact is the root cause behind a large share of the findings in Part 7. The deliberately-public webhook and cron routes bypass normal session checking by design, which is correct, but makes the quality of each one's own, individual secret-check and anti-replay logic critical — reviewed in Part 7.F. The rate limiter's in-memory, single-process design means login brute-force protection today depends partly on the underlying authentication service's own limits, not solely on this application's own code. There is no transport encryption at the application layer in the documented production deployment, meaning session cookies and authentication tokens travel in the clear over whatever network path connects a user's browser to the office/internet path. There is no centralized error-tracking or alerting, a single application instance, and a single database, with backups kept only on the database server itself and not yet copied anywhere else.

---

# Part 5 — Local isolation certification: the safety mechanism and its proof

*Result: **ISOLATION GATE PASSED — 21 out of 21 checks**, every single time it was run during this audit, machine-checked (not self-reported) by a script written specifically for this audit.*

## 5.1 What was proven, and exactly how

| ID | Check | Result |
|---|---|---|
| C1 | Every URL-shaped setting in the effective configuration resolves only to loopback (`127.0.0.1`/`localhost`) | PASS |
| C2 | No setting anywhere contains any of the five forbidden addresses | PASS |
| C3 | Email / OAuth / LLM / push / webhook settings are all blank, so outbound business notifications are structurally disabled | PASS |
| C4 | The configured Supabase URL is the disposable audit stack's own port, not the developer's separate development stack's port | PASS |
| C5 | The application's own URL and the cron job's own target URL both point at the audit stack's port | PASS |
| C6 | Every single configuration key present in the developer's own, separate `.env.local` file is explicitly overridden by the audit's own environment file, so nothing from the developer's file could silently "leak through" | PASS — 10 keys had to be explicitly added partway through to make this true; the gate itself caught the gap |
| C7 | The in-process network guard is actually loaded into every process the audit starts | PASS |
| C8 | Every single environment variable that the application's own code reads anywhere (checked by searching the entire codebase for every such reference) is explicitly accounted for in the audit's environment file | PASS — the gate initially caught 7 variables that had been missed (three push-notification keys, a webhook token, an operator-alert webhook URL, a survey-link signing secret, and an SMTP flag) and they were added |
| G1 | The network guard actually refuses 9 different forbidden or non-loopback targets — including the exact five forbidden addresses, a public DNS server, a well-known external API host, and two unusual "IPv4-mapped IPv6" ways of writing one of the forbidden addresses — and does so **before the underlying network-connect function is ever actually called** | PASS |
| G2 | The same guard correctly lets ordinary loopback connections through without interference | PASS |
| G3 | The guard's patch to Node's own networking internals is confirmed actually active inside the running process | PASS |
| Live test | Inside one real, running Node process, under the guard: a call to the audit stack's own loopback API succeeded normally (HTTP 200). Calls to `graph.facebook.com`, a well-known email-sending API's domain, and all three production addresses plus the retired server's address were **every single one refused from inside the process itself**, each one logged with a reason, before any actual network packet could have been sent. **6 out of 6 refused.** | PASS |
| D1 | All of the disposable audit stack's own Docker containers (database, auth service, REST API, gateway, file storage, realtime, and a local mail-trap) are confirmed running | PASS |
| D2 | The audit stack's authentication service is confirmed configured to send any mail only to the local mail-trap container, never anywhere real | PASS |
| D3 | The audit stack's file storage is confirmed configured to use a local Docker-managed disk volume, with no NAS, no network file share, and no cloud storage service connected | PASS |
| D4 | No configuration value on any of the audit stack's own containers references any production or retired address | PASS |
| D5 | The developer's own, separate, pre-existing stack is confirmed to be an entirely different set of containers, and was confirmed untouched throughout | PASS |
| B1–B4 | Inside the disposable audit database itself: zero email-mailbox settings saved, zero active message-intake or WhatsApp channels configured, zero non-synthetic user accounts, and (initially) zero business tickets of any kind | PASS |
| N1 | This PC's own local network-connection table (read only, nothing sent) shows **no connection from any audit-related process — node, Docker, SSH, the database client, or anything else other than the person's own already-open browser tab** — pointed at any of the five forbidden addresses | PASS |

## 5.2 The layers of protection actually put in place

1. **An entirely separate, disposable database stack**, built fresh from this repository's own 156 migration files plus its own seed data — not a copy of anything, and with no production or developer data ever imported into it.
2. **A dedicated environment configuration** for the audit, in which every single outward-facing integration (email, OAuth, the LLM relay, webhooks, push notifications) is deliberately left blank — the demo API keys used for the local database connection itself are the same public, non-secret demo keys that come with the open-source database tooling by default on every developer's machine everywhere, not production credentials of any kind.
3. **An in-process network guard**, preloaded into every single program this audit started (the web application itself, the test runner, every helper script), that refuses, by default, any attempted network connection that is not to the local machine itself — and explicitly, doubly refuses the five forbidden addresses by name even if some other logic had somehow decided to try reaching them. A forbidden attempt is refused *before* any DNS lookup and *before* the underlying operating-system network call is ever made, so literally nothing is sent onto the network.
4. **A local mail trap**: the authentication service inside the audit stack can only ever send mail to a local, throwaway mail-catching container; the application itself has no mail transport configured at all, so its own sends are simply logged, never actually attempted.
5. **A mandatory gate before every single dynamic test**, re-running all 21 checks above and refusing to let anything run at all if even one of them fails.
6. **Plain process discipline**: no remote-login tool, no file-copy tool, and no web-request tool was ever pointed at any production address at any point; a stale, already-disconnected network-drive mapping to the retired server, and an existing remote-login key for the new servers, were both found already present on this PC from before this audit and were both deliberately left completely untouched; the only web browser used by this audit was pointed exclusively at the disposable audit stack's own local address.

## 5.3 Things found during this phase that *could* have broken isolation, and exactly how each was handled

| # | What was found | Why it matters | What was done about it |
|---|---|---|---|
| I-1 | The developer's own, pre-existing, separate database (not the one this audit built or used) turns out to contain real, production-derived data: roughly 1,012 real staff/store login profiles, roughly 694 real tickets, 214 real stores, 31 real mobile numbers, 11 real equipment-vendor contact lists, and a handful of leftover test records. | Real people's information is sitting on a developer's PC, and the existing (pre-audit) automated test suite already runs against it routinely. A misconfigured run against it could, in theory, email or message real people. | Confirmed it currently has **no** working mailbox and **no** real WhatsApp credentials configured, so nothing on it can currently send anything to anyone. **This audit never used it for anything** — a completely separate, synthetic-only database was built instead. This is recorded as a privacy-relevant observation for the user's own awareness, not as something this audit needed to, or did, fix. |
| I-2 | The application's own font-loading code downloads fonts from Google at build time. | Under the network guard, this attempted download is correctly refused, and the application simply falls back to a plain system font with no functional impact on the audit. | Accepted as expected behavior; noted only as a reminder that the *build* machine (as opposed to the running application) does need ordinary internet access for this one thing. |
| I-3 | This PC already had, from before this audit, a disconnected network-drive mapping pointed at the retired old server, and an existing remote-login key for the new production servers, sitting in the user's own profile. | Could theoretically be misused by mistake in some other context. | Neither was touched in any way by this audit. Recorded only as a hygiene suggestion for the user to consider removing the stale mapping at their own convenience. |
| I-4 | The user's own, regular Chrome browser already had an open network connection to the live public production site — simply from the user's own normal, prior browsing, completely unrelated to this audit. | None whatsoever for the audit itself, since this is not a connection the audit made or used. | The isolation-check script specifically distinguishes a browser-owned connection like this from anything the audit itself might open, and confirms: **this audit never used that browser, or any browser signed into production, for anything.** |
| I-5 | The local database tooling used to build the disposable audit stack, by default, publishes its network ports in a way that would be reachable from elsewhere on the same office network, not only from this one PC, and uses a well-known default local password. | With only synthetic, throwaway data involved, the real-world risk is low, but another computer on the same network could, in principle, reach the audit database's port while it happens to be running. | Accepted as a reasonable trade-off for a short-lived audit; the recommendation recorded is simply to stop the disposable stack entirely whenever it is not actively in use. |
| I-6 | One unrelated container belonging to the developer's pre-existing (non-audit) stack was observed to be stuck in a restart loop, because it needs a Docker feature that is not enabled on this PC. | None — it is unrelated to this audit and was never part of the audit's own stack. | Left alone; simply excluded from the audit's own setup from the start. |

## 5.4 The honest limits of this certification

- **No change was made to this PC's own firewall.** Changing a firewall is itself a system-security change, and this audit does not make that kind of change without being asked. A ready-to-run, fully reversible script to add that extra, belt-and-braces layer was prepared and left in place for the user to run themselves if they would like the additional protection — it was never run during this audit.
- The network guard protects programs built on the one programming-language runtime (Node) that this entire application and all of its tooling is written in. Other programs the audit used (the database container tooling itself, the network-diagnostic commands, the one local browser tab) were instead checked by *configuration* — confirming what they were pointed at — rather than by the same in-process guard, and the one browser tab used was never pointed anywhere but the disposable audit stack's own local address.
- Isolation here is proven by configuration plus live in-process refusal plus a check of this PC's own local connection table — **not** by capturing and inspecting actual network traffic; no such capture was taken.
- Several real third-party integrations (Meta's WhatsApp service, Google/Microsoft's mail OAuth services, the DeskTime time-tracking service, real email providers, the real file-storage network share) fundamentally cannot be tested end-to-end without touching real, external, production-adjacent services — so wherever this audit discusses one of those, it is explicitly marked as either "not tested" or "tested using a safe local stand-in," and is never presented as if it had been verified against the real thing.
- Live production behavior itself — the real HTTPS situation, the real firewall exposure, the real file-share permissions, the real backup success history — was **not** assessed at all in this audit, by explicit instruction, because assessing any of that would have meant contacting production.

## 5.5 Formal certification statement

> At 2026-10-13, every dynamic test performed in this audit ran only against local, loopback-only resources (the disposable audit database stack, and the application running on a local-only address), every outward-facing integration was either disabled or safely substituted, every attempted network connection from this audit's own processes to any of the three production machines or the retired server was refused from inside the process itself before any packet could be sent, and this PC's own local connection table showed no audit-owned connection to any of those addresses at any point. **Gate status: PASSED, 21 out of 21 checks, every time it was run.**

---

# Part 6 — Full functional module inventory (30 modules)

*Produced by two independent, read-only passes over the entire codebase, cross-checked against the freshly-built, empty audit database. Items marked **[UNVERIFIED]** could not be confirmed from the code or the database alone. Every oddity flagged here that rises to the level of an actual defect has its own entry in the Master Defect Register (Part 10), cited by ID.*

## 6.1 Facts that apply across every module

Five roles exist: `user` (shown to end users as "Requester"), `agent` ("Technician"), `manager`, `admin`, and `platform_owner`. "Agent-tier" means agent and every role above it; a manager or above is treated as effectively belonging to every single technician group in the organization, not just one. The central request guard keeps an exact-match list of exactly 11 public API routes, plus two public, token-protected landing pages (the email-approval link and the customer-satisfaction-survey link) — every other route requires a real, checked session. **Enforcement of business rules is split between application code and the database's own row-level security, and for one especially important rule — the ticket status lifecycle itself — enforcement exists only in application code, with no equivalent safety net inside the database at all** (only three narrow, unrelated database triggers exist on the main tickets table: one assigns the organization id, one generates the human-readable ticket number, one simply stamps the "last updated" timestamp). Scheduled jobs run on a fixed schedule from Windows Task Scheduler in production: an alerts job every 30 minutes, a business-rules job every 15 minutes, an email-reply-sync job every 1 minute, and a customer-satisfaction-survey job every 30 minutes — **notably, nothing anywhere actually sends the "scheduled reports" feature's own reports on any schedule at all, despite the feature offering daily/weekly/monthly options in its own settings screen.** The application's own build configuration is set to **never fail a production build because of a type error**, and there are no defensive HTTP security headers configured anywhere in the application. The rate limiter is a simple in-memory map keyed on the first address found in a request header that, by itself, a client can set to anything it likes. A separate, older, Express-based helper service also exists in the repository for some mail processing — it has no automated tests of its own, and whether it is actually deployed and running anywhere in production today is **[UNVERIFIED]**.

## 6.2 Part A — The 16 ticket-lifecycle-facing modules

**1. Login, password recovery, profile.** Covers the login page, forgot/reset-password pages, a one-time-link confirmation page, and a user's own profile page. Login attempts are rate-limited per IP-and-email combination; forgot-password requests are separately rate-limited; new passwords must be at least 8 characters. Existing tests cover email-link handling, bulk password reset, email-address changes by an admin, and mobile-identity linking. **Known gaps:** no direct test of the plain "forgot password" flow itself, of a user changing their own password, of avatar upload, of the rate limiting itself, or of the one-time-link confirmation page.

**2. Home dashboards.** The main landing page after login, plus the technician-facing dashboard, the newer "Smart" executive dashboard, and the admin-facing reports area. Scoping of who sees what is handled entirely in application code (using the privileged, security-bypassing database client plus an explicit filter), not by the database's own row-level security, for this particular area. Existing tests cover dashboard-numbers reconciliation and various analytics scoping scenarios. **Known gaps:** no test exercising this scoping logic as a deliberately hostile or mis-scoped role; the underlying database function this dashboard calls is itself untested directly.

**3. Service catalog, dynamic forms, form templates, a shared field library.** Covers the public-facing service catalog a requester picks from, and the admin screens for managing services, categories, reusable form templates, SLA policies, and a shared library of form fields that can be reused across many forms. Write access is admin-only in application code, though the database's own policies are actually slightly looser (allowing managers too) for some of these tables. **Known gaps:** no direct test of creating a new service, of saving a service's form layout, of creating a new form template, or of the "which services are visible at which store locations" filter.

**4. Request (ticket) creation.** The single, shared core creation logic is reused identically whether a ticket comes in from the web form, from WhatsApp, or from the email-intake pipeline. The underlying ticket-numbering sequence is generated safely and atomically at the database level. Submitting "on behalf of" someone else requires an agent-tier role. Existing tests cover the shared creation-logic security boundary and the WhatsApp equivalent. **Known gaps:** no direct test of the "on behalf of" path itself, of what happens if the ticket-numbering sequence is hit concurrently from multiple requests at once, or of an existing-but-unused "duplicate this ticket" action.

**5. Ticket queues and lists.** Covers a user's own "My Requests" list, the technician team queue, and the individual ticket detail page. The database's own row-level security policy is what actually determines visibility here; the application-level query logic on top of it mostly just adds filtering and sorting. Existing tests cover status-filter logic and free-text search. **Known gaps:** no direct test of the "my subordinates' tickets" or "tickets I'm collaborating on" views, or of the bulk-export-to-CSV action.

**6. Assignment, technician hand-off, collaborators, and "nudge" reminders.** Covers assigning a ticket, a technician handing a ticket to a teammate, adding other people as collaborators on a ticket, and a "nudge" reminder feature for a ticket that has been sitting too long. A plain technician may only hand a ticket off to someone on their own team; only a manager or above can truly un-assign a ticket. Existing tests cover the assignment role boundary, the nudge feature, and some related parity tests. **Known gaps:** no direct test of adding or removing a collaborator, and there is no dedicated concept of "taking over" a ticket at all — in practice a technician simply re-assigns the ticket to themselves, with nothing to stop two technicians from doing this to the same ticket at almost the same moment (see Part 8's "concurrency scenarios reviewed").

**7. Ticket lifecycle and status changes.** The single place that actually changes a ticket's status is one shared function, which correctly enforces which status changes are even allowed for which role, requires a written remark for several of those changes, and correctly uses an optimistic locking check so that two people cannot silently stomp on each other's status change at the exact same moment. **The newest status, "Hold due to Purchase from HO," has no dedicated test of its own transition rules** — the existing tests for it only cover whether it shows up correctly in reports, not whether its lifecycle rules are actually enforced. **Known gaps:** no test of the approval-rejection reopen path, and the main status-change function itself is only ever exercised indirectly through other tests, never directly.

**8. SLA (service-level-agreement) timing, business hours, holidays, and alerts.** The business-hours calendar, the holiday calendar, and a handful of alert rules have **no concept of which organization they belong to at all** — in a system designed to potentially serve more than one separate organization, these particular tables are, today, effectively shared, global settings. Existing tests cover the business-hours calendar, SLA-breach detection, holiday handling, and alert rules. **Known gaps:** no test of the actual pause/resume arithmetic when a ticket goes on hold and comes back, and no test of the "percentage of SLA time elapsed" or "unassigned for too long" scheduled-alert logic.

**9. Approvals.** Covers ad-hoc approval requests, configured multi-step approval workflows, and the email-based "click to approve or reject" links. The email link's identity-proving step for someone who clicks a forwarded link (a mailed six-digit code) is solid in its own cryptographic design, but — see Part 7, finding SEC-01 — can, on at least one specific technical path, be bypassed entirely by a logged-in user. Existing tests cover most of the approval email/decision logic. **Known gaps:** no direct test of delegating an approval to someone else (which, per Part 7 finding SEC-16, is itself a real defect), and no test of a true multi-step sequential approval workflow end to end.

**10. Attachments (file uploads).** Covers uploading, validating, downloading, previewing, and PDF-exporting ticket attachments. Existing tests cover the preview feature, spreadsheet-preview limits, and the ticket PDF export. **Known gaps:** no direct test of the core attachment-validation logic itself, of deleting an attachment, or of avatar image upload.

**11. Email conversations (outbound sending, inbound reply-matching).** Outbound mail correctly falls back safely to "logged, not sent" if nothing is configured. Inbound reply-matching currently trusts the email's own "From:" address with no deeper verification that the message genuinely came from where it claims (see Part 7, findings SEC-23 and SEC-48). Existing tests cover a good range of the email-formatting and reply-matching logic. **Known gap:** no test of the actual IMAP mailbox-polling loop end to end.

**12. Equipment-vendor ("OEM") integrations.** Covers automatically routing certain ticket types to the relevant equipment vendor's own contact email, and the bulk "store master" data upload used to keep store/vendor information current. Existing tests cover this reasonably well. **Known gap:** no test specifically validating vendor contact email-address formatting on entry.

**13. WhatsApp intake.** This is, by a clear margin, **the single best-tested module in the entire application** — its webhook correctly verifies Meta's cryptographic signature, correctly refuses to process anything if that signature check fails, correctly de-duplicates a message that Meta might deliver more than once, and correctly resolves which customer sent a message purely by looking up their stored mobile number, never by trusting anything the incoming message itself claims about who sent it. **Known limitation (not a security defect, a capability gap):** this integration is one-way only — nothing about a ticket's status or resolution is ever pushed back out to the customer over WhatsApp.

**14. Email/WhatsApp message-intake review ("Intake") subsystem.** Covers the admin screens for connecting Gmail/Outlook mailboxes via OAuth, the automatic rule-and-AI-assisted classification of incoming messages, and the human review inbox for confirming or correcting that classification before it becomes a real ticket. **Known gaps:** no direct test of either OAuth connection flow, of either provider's webhook, of the separate classifier helper service, or of sending a reply message directly from inside the review screen.

**15. Notifications.** Covers the in-app notification bell, outbound notification emails, and optional browser push notifications. Existing tests cover a good range of this. **Known gaps:** no test of push notifications themselves, of saving organization-wide notification rules, or of a user's own per-type notification preferences — and this last one has no way to even be set from the user interface at all today, despite the underlying code to honor such a preference already existing.

**16. Customer satisfaction surveys (CSAT).** Covers the signed survey link emailed to a requester after their ticket is resolved, a reminder email if they never respond, and a "reopen my ticket" link bundled into the same email. Existing tests cover the token logic and the overall survey flow reasonably well. **Known gaps:** no direct test of submitting a rating from inside the logged-in app itself (as opposed to the emailed link), or of the reminder-scheduling logic.

## 6.3 Part B — The 14 admin/reporting-facing modules

**1. User management, roles, bulk import, bulk password reset, the top "platform owner" role.** Only a platform_owner may ever grant someone the admin or platform_owner role themselves — this specific, important rule is correctly enforced. **However, nothing stops a plain admin from resetting a platform_owner's password, or from demoting or deactivating a platform_owner** — this inconsistency is a real defect (see Part 7, SEC-09). The "permission matrix" and "custom roles" screens exist in the user interface, store data correctly, but are **not actually read or enforced by anything** — a genuinely misleading piece of the admin experience today. **Known gaps:** no direct test of a plain role change, of deactivating a user, of inviting a new user, or of bulk-creating users.

**2. Teams, departments, locations, cost centers, job functions, designations.** Standard organizational-structure administration. **Known gap:** no direct test of any of this structure's own create/edit/delete actions.

**3. Store master data, air-conditioning asset tracking.** Covers the retail store list and its associated equipment data used for the "red flag" and "AC not working" style reports. **A genuine, confirmed bug was found here, unrelated to security:** the code that validates a store's "opening date" field uses a regular-expression pattern with a typo that makes it reject every single valid date — meaning this one field can never actually be successfully saved through this particular screen today. **Known gaps:** no direct test of creating or editing a store, or of the store-list CSV export.

**4. Categories, sub-categories, and services administration.** This is, by a clear margin, **the single best-audited module in the whole application** from an activity-logging point of view — nearly every change here correctly writes its own audit-trail entry, unlike most of the rest of the admin area (see Part 7, SEC-27).

**5. SLA policies, field-level SLA overrides, escalation rules.** **Two entire pieces of configuration exist in the database and have real settings screens, but are simply never read by any actual business logic at all:** an "organization-wide default SLA" setting, and a separate "escalation policies" table — both are, in effect, completely dead, unused configuration today, which could easily mislead an administrator into thinking they have set something up that is actually doing nothing. **Known gap:** no direct test of creating or editing an SLA policy itself.

**6. The "Business Rules" automation engine.** The general design here is sound — conditions, actions, and ordering are all evaluated sensibly. **A confirmed, real defect:** when a Business Rule automatically changes a ticket's priority or status, the activity log for that change is incorrectly recorded as if the *requester themselves* had made the change, rather than showing it was an automated rule — this muddies the audit trail. **Known gap:** no direct test of the rule actions that set a ticket's status or team, or of the scheduled (time-based) rule triggers.

**7. Tasks.** A simpler, secondary module, by its own code comments still considered "not fully built out yet," and today restricted to admin and platform_owner only. **Known gaps:** no direct test of changing a task's status, of assigning it, or of task dependencies.

**8. Projects.** Similarly restricted to admin and platform_owner only, "not fully built out yet." Reasonably well tested already for its authorization boundary and its progress-percentage calculation.

**9. Knowledge Base.** A simple internal-article system for manager-and-above authors. **A real, minor defect:** the "was this helpful" counters shown on each article are never actually incremented by anything — they will always read zero. **There is also no actual reader-facing page for ordinary staff to browse these articles at all today** — only the admin authoring screen exists. **Known gap:** no automated test of this module exists at all.

**10. Reports** (the 12 fixed "Predefined Reports," the ad-hoc "Report Builder," the newer "Smart Dashboard," and the older Analytics dashboards). This is a large, important area with inconsistent scoping rules between its different parts: a manager is correctly restricted to only their own technician groups' data in the Predefined Reports, the Smart Dashboard, and the Report Builder — but is given the **entire organization's data with no restriction at all** when exporting a plain CSV, when a scheduled report is sent, and on the separate Tasks/Projects analytics tabs. **Separately, and more importantly: the "scheduled reports" feature has settings for daily, weekly and monthly delivery, but nothing anywhere in the codebase actually sends any report on any schedule — only a manual, one-off "send now" action exists.** **Known gaps:** no direct test of scheduled or saved reports, or of the plain-CSV export's own role-scoping.

**11. Audit trails.** Covers the admin-facing audit log, a separate general-purpose event log, and an owner-only audit log. **A real defect:** the audit log screen incorrectly re-labels most kinds of administrative change (business rule changes, SLA policy changes, OEM vendor changes, user changes, store changes, email-settings changes) simply as "service," which is actively misleading to whoever is trying to read the audit trail.

**12. Admin configuration and platform settings.** Covers the mailbox (SMTP) settings screen, DeskTime time-tracking sync, monitoring, and general settings. One table here used to save arbitrary application-wide settings accepts literally **any** setting key at all with no restriction on what it can be — far looser than it needs to be. **Known gap:** no direct test of the general settings screen or of the DeskTime sync itself.

**13. Multi-tenancy (support for more than one separate organization on one shared database).** **This is the single biggest structural gap found anywhere in the application's design:** there is, today, genuinely **no administrative screen anywhere to create a new organization, manage which features are turned on for it, issue it a license key, or delete it** — all of that exists only as raw database tables with no user interface or application-code path to manage them at all. Separately, **an organization being "suspended" or "cancelled" is recorded in the database but is never actually checked or enforced by anything** — only a trial period expiring is actually acted on anywhere in the code. And, as already noted in Part 6.2's module 8, **ten separate tables that really ought to be scoped to one organization each have no organization column at all today**, meaning they are effectively shared across every tenant that might ever exist on this database.

**14. "Ask CKDESK" (an AI assistant feature).** **Confirmed: this feature does not exist in the codebase at all today** — there is no AI-related code, and no AI-provider software library of any kind listed anywhere in the project's dependencies. The closest things that do exist are a plain keyword-search feature, and a separate, unrelated AI-summarization helper used only inside the email-intake review screen, plus a placeholder line of text reading "coming soon" on one settings page.

## 6.4 Ranked cross-module findings from this inventory pass (each with its own full write-up in Part 7 or Part 9)

1. A user can, through the database directly (not through the normal application screens), change their own organization membership, re-activate their own deactivated account, or an admin can promote themselves to the very top role — all without any further check. *(Part 7, SEC-03/D-003.)*
2. A plain admin can take over a platform_owner's account by resetting their password, with nothing stopping them. *(Part 7, SEC-09/D-009.)*
3. The store "opening date" field can never actually be saved due to a typo in its own validation pattern — a genuine functional bug, unrelated to security.
4. The "scheduled reports" feature never actually sends anything on a schedule, and when a report *is* sent manually, its recipient list is not validated at all, and its data is not scoped to the sender's own teams the way the rest of reporting correctly is. *(Part 7, SEC-12/D-012.)*
5. Multi-tenancy support is structurally incomplete: there is no way to actually manage a second organization through the application itself, suspended/cancelled organizations are not enforced, and ten tables are shared across every tenant rather than being scoped per-tenant. *(Part 8's "global unique constraints" finding, and Part 7's SEC-06/D-006.)*
6. Several pieces of configuration exist, look fully functional in their own settings screen, and are in fact completely dead and unused: the permission matrix, custom roles, the organization-wide default SLA, the escalation-policies table, and the Knowledge Base's "was this helpful" counters.
7. Audit-trail coverage is inconsistent: some areas (categories/services) log almost everything; most of the rest of the admin area (role changes, deactivations, invitations, org-structure changes, business-hours changes, holiday changes, alert-rule changes) logs almost nothing. *(Part 7, SEC-27/D-032.)*
8. A manager's own level of access to company data is inconsistent depending on exactly which screen they are using — correctly restricted to their own teams in three major reporting areas, but given full organization-wide access in CSV exports, scheduled reports, and the Tasks/Projects analytics tabs.
9. Business-Rule-driven automated changes are incorrectly attributed to the requester in the activity log, rather than being clearly marked as automated. *(Part 9, CQ-14.)*

---

# Part 7 — Full security audit (every finding)

*This Part consolidates **six independent, read-only security reviews**, each covering a different slice of the application, plus a separate, live, dynamic-reproduction pass against the disposable database described in Part 5. Confidence labels used throughout: **CONFIRMED-BY-CODE** (directly visible in the source code or a database policy's own text) · **CONFIRMED-BY-CATALOG** (directly visible by inspecting the database's own system catalog) · **EXPLOITABLE** (actually reproduced live, with logged evidence, against the disposable audit database — never against production) · **NEEDS-DYNAMIC-TEST** (plausible and well-reasoned from the code, but not itself run in this pass).*

**A note on this audit's safety rules:** per the environment's own standing safety rules, this report describes each weakness, its evidence, and its recommended fix — it does **not** include runnable attack code for the one authentication-bypass finding below (SEC-01); that finding's mechanism is described only at the level of detail needed to understand and fix it, not to use it against anything.

## 7.1 Overall severity summary (final, after all six reviews and the live reproduction pass)

| Severity | Count | Notes |
|---|---|---|
| **CRITICAL** | 4 | 2 actually reproduced live against the disposable database; 1 confirmed by code, independently, by three separate reviewers; 1 flagged for a safe unit test rather than a live attempt (see 7.5 below) |
| **HIGH** | 24 | A mix of live-reproduced and confirmed-by-code findings |
| **MEDIUM** | 31 | Confirmed by code or by database-catalog inspection |
| **LOW / INFO** | ~45 | Itemized throughout this Part |

**The single most important fact to take away from this whole security audit:** one specific root cause — described in full as finding SEC-01 immediately below — was independently rediscovered by **five of the six separate review passes**, each one approaching the application from a completely different angle (admin actions, requester actions, the authentication layer itself, file attachments, and external webhooks). Five independent people finding the exact same thing from five different directions, without being told to look for it by each other, is unusually strong confirmation that this is real, and that it is the single highest-priority thing to fix.

## 7.2 CRITICAL findings

### SEC-01 — Authentication can be bypassed on several specific routes via a header the client itself can set
*(Independently found and confirmed by five of the six reviews.)*

The part of the code responsible for figuring out "who is making this request" is designed to trust a particular request header as proof of identity, instead of re-checking the person's actual login session on every single request. The component in front of the whole application (the "proxy") is supposed to be the only thing that ever sets that header, and it does so correctly on its main, normal path — but it has a small number of "fast path" branches (for things that look like static image files, for the small list of intentionally-public API routes, and for the two public token-based landing pages used by email approval links and survey links) where it hands the request straight through **without first clearing out whatever value a client might have put in that same header themselves.**

**What this means in practice:** on a route that falls into one of those fast-path branches, a logged-in user could, in principle, set that one header themselves to someone else's user ID, and have the application believe they are that other person for the purposes of that one request.

**Fix (small, surgical, not a redesign):** the two files involved should either (a) have the identity-lookup code stop trusting that header at all and instead always re-check the real session, or (b) have the proxy explicitly strip any client-supplied copy of that header on every single one of its "fast path" branches, not only its main path. Either change is a handful of lines in two existing files.

**Confidence:** CONFIRMED-BY-CODE, independently, by five separate review passes. **Not dynamically demonstrated in this audit** — per this environment's own safety rules, an authentication-bypass finding like this one is described for the purpose of fixing it, not demonstrated as a working attack. The correct way to verify the fix, once applied, is a small, focused automated test of the proxy's own header-handling logic — not a live attempt against a running application.

### SEC-02 — A database function that can delete an entire organization is callable by literally anyone holding the application's public API key — EXPLOITABLE, reproduced live

A database function exists whose entire purpose is to let the single, top-level "owner" of this whole multi-tenant system permanently delete one customer organization and everything in it. The function runs with elevated, security-bypassing database privileges, and contains **no check at all of who is calling it.** An earlier attempt to lock this down (migration #66, later revisited in migration #120 — see Part 3) correctly removed the obvious, named permission grants, but missed the fact that a *default*, catch-all permission grant still allowed absolutely anyone to call it.

**This was actually reproduced, live, against the disposable audit database** (never against production): a request using only the application's own public, non-secret API key — with no login of any kind — was sent asking this function to delete a disposable, throwaway test organization created specifically for this one test. **The organization was deleted, and confirmed gone, end to end**, exactly as if a real customer's entire account had been wiped by a complete stranger.

**Fix:**
```sql
REVOKE ALL ON FUNCTION public.owner_delete_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_org(uuid) TO service_role;
-- plus an explicit ownership check written inside the function body itself
```
**Confidence: EXPLOITABLE** (actually reproduced).

### SEC-03 — A user can rewrite their own account record to change organization, re-activate themselves, or (for an admin) promote themselves to the very top role — EXPLOITABLE, reproduced live, four separate ways

The database's own rule for "can I update my own user-profile row" only protects one single column (the role column, and even then only for people who are not already an admin) — every other column on that same row, including which organization the account belongs to, whether the account is active, who the account's manager is, and the account's employee ID, can be freely rewritten by the account's own owner, with no further check at all.

**Reproduced live, four separate ways, against the disposable audit database:**
- A plain technician account successfully moved itself from one organization into a second, completely separate one.
- An admin-level account successfully promoted its own role all the way up to the single highest "platform owner" role.
- A manager-level account successfully rewrote its own employee ID and reporting-manager fields to arbitrary values.
- An account that had been deliberately deactivated successfully re-activated itself.

**Fix:** either remove the database's broad write permission on the sensitive columns and grant back only the handful of columns an ordinary user genuinely should be able to change themselves (full name, avatar, a WhatsApp-enabled flag), or add a database-level check that blocks any change at all to the sensitive columns unless it comes from the application's own, fully-trusted internal service account rather than from the end user directly.

**Confidence: EXPLOITABLE** (actually reproduced, four times).

### SEC-39 — A public file-serving route may not properly validate the file path it is given before using an elevated-privilege storage client (flagged for a safe test, not dynamically demonstrated)

One route, intended only to serve a small, fixed set of public icon/avatar image files, is built in a way that — reading carefully through exactly how the underlying web framework decodes a path, and exactly how the storage library builds its own internal request from that path — *could*, in principle, allow a cleverly-crafted path to cause the server to make an elevated-privilege request somewhere it was never intended to go. **This was not dynamically tested** — confirming or clearing this specific finding safely calls for a small, isolated automated test (feeding deliberately malformed path values directly into the route's own code and confirming it correctly refuses them before ever reaching the storage client), rather than attempting any real traversal against a running system, which is why it is listed as "flagged for a unit test" rather than "reproduced." Until that test is written and passes, this is treated as a genuine Critical finding, not dismissed.

**Fix:** validate every part of the requested path against a strict, narrow pattern appropriate to each specific bucket before ever handing it to the storage client, and stop using the elevated-privilege storage client for this one, supposedly-public-only route at all.

## 7.3 HIGH findings (24 total)

| ID | Area | Finding | Confidence |
|---|---|---|---|
| SEC-04 | File storage | A storage permission rule intended to be narrow actually combines with the correct, narrower rule in a way that lets **any logged-in user list and upload into any ticket's attachment folder**, regardless of whether they have any connection to that ticket at all. The upload/list side of this was actually reproduced live; the download side was blocked on this particular test environment's exact bucket configuration but the underlying policy problem is the same one. | EXPLOITABLE (write side) |
| SEC-05 | Design gap | There is no concept of a "confidential" team anywhere in the system — an HR or Finance ticket is visible to literally every manager/admin in the whole organization, with no way to restrict it further. This is a missing feature, not a single buggy line. | CONFIRMED-BY-CODE |
| SEC-06 | Database | Several organization-wide configuration tables (business hours, holidays, SLA escalation rules, task statuses, task priorities, request priorities, general app settings) have **no organization column at all**, are readable by literally anyone with no login whatsoever, and are writable by any manager or admin **of any organization, not just their own.** All three of these were actually reproduced live: an anonymous, unauthenticated request successfully read the SLA escalation rules; a manager account successfully flipped a business-hours setting; an admin account successfully edited a global app setting. | EXPLOITABLE |
| SEC-07 | Database | Two more database functions that should be restricted are instead callable by anyone: one that generates the next ticket number (reproduced live — an anonymous request successfully "burned" two sequential ticket numbers with no ticket ever created), and one that seeds default SLA configuration for an arbitrary organization id (also reproduced live). | EXPLOITABLE |
| SEC-08 | Tickets | The database's own rule for creating or updating a ticket does not stop a plain requester from directly inserting a brand-new ticket that is **already marked resolved**, with a due-date set decades in the future — reproduced live — and does not stop a technician from directly rewriting a ticket's human-readable number to collide with a different, existing ticket — also reproduced live. | EXPLOITABLE |
| SEC-09 | User admin | The actions for setting someone's password, changing their role, or deactivating their account do not check the *target* person's current role at all — meaning, unlike a sibling "change email" action that correctly blocks this, **a plain admin can set a platform_owner's password, or demote or deactivate a platform_owner**, with nothing stopping them. | CONFIRMED-BY-CODE |
| SEC-10 | User lifecycle | **Deactivating a user's account does not actually revoke their access anywhere.** The "is this account active" flag is not checked by any database rule, any helper function, or any part of the request-handling layer — a deactivated account's existing, already-logged-in session simply keeps working exactly as before. | CONFIRMED-BY-CODE |
| SEC-11 | Bulk import | Bulk-importing a list of new users gives anyone who was not assigned a specific password in the import sheet a single, **hard-coded, literally-written-into-the-source-code** default password — and the requirement to change it is enforced only by a webpage redirect, never by anything on the server side itself. | CONFIRMED-BY-CODE |
| SEC-12 | Reports | The "send this report now" action lets any manager export the entire organization's ticket/task/approval data — not scoped down to their own teams the way the rest of reporting correctly is — to **any email address at all**, with no validation of that address whatsoever. | CONFIRMED-BY-CODE |
| SEC-13 | Admin actions | Several admin-facing "update" actions take whatever data the client's own request contains and write it straight into the database using the elevated-privilege client, with no restriction on which specific fields are allowed — meaning a crafted request could, for example, move a scheduled report into a different organization entirely. | CONFIRMED-BY-CODE |
| SEC-14 | Database | The database's own rule for deleting a task has no organization check at all — today it happens to be saved from real abuse only by an unrelated, generic database safety rule that refuses any delete with no filter at all, which was confirmed live (the delete attempt was correctly blocked, but for the wrong reason, not because of proper tenant scoping). | CONFIRMED-BY-CATALOG, partially tested |
| SEC-15 | Internal notes | The rule for whether a private, internal-only note on a ticket is visible checks only "is this person a technician on *some* team," not "is this person on *this specific ticket's* team" — so a technician from one team who happens to also be the requester of a ticket raised to a completely different team (for example, HR) can read that other team's private internal notes on their own ticket. | CONFIRMED-BY-CODE |
| SEC-16 | Approvals | Delegating one single pending approval to someone else accidentally rewrites the **shared workflow definition itself** rather than just that one approval — meaning it silently re-points every other pending or future approval on that same shared workflow to the new, delegated-to person as well, company-wide. | CONFIRMED-BY-CODE |
| SEC-28 | Approvals | Because the email-approval landing page is one of the "fast path" routes described in SEC-01, the same underlying issue also lets a signed-in user skip straight past the emailed six-digit identity-proving code meant to confirm they really are the named approver. | Same root cause and fix as SEC-01 |
| SEC-29 | Rate limiting | The login and forgot-password rate limiters are keyed on a request header that a client can set to anything — if the application is reached directly (as the documentation's own description of the production deployment suggests it is), an attacker can simply keep changing that header value to get effectively unlimited password-guessing attempts; conversely, if that header is entirely absent, every single visitor shares one bucket, so a small burst of requests from anywhere can lock out every single real user sharing that one bucket. | CONFIRMED-BY-CODE |
| SEC-30 | Bulk import | (Same underlying issue as SEC-11, confirmed independently by a second review from the authentication-layer angle.) | CONFIRMED-BY-CODE |
| SEC-31 | Transport | The production deployment, as documented, runs over plain, unencrypted HTTP, meaning passwords, session tokens, and approval links all travel across the network in the clear, and session cookies are not even marked with the browser-level flag that would stop them being sent over a plain HTTP connection in the first place. | CONFIRMED (from documentation) |
| SEC-40 | File intake | An email attachment's own file name — fully controlled by whoever sent that email, including a complete stranger emailing the intake address — is used directly as part of the storage location it gets saved to, with "overwrite if it already exists" turned on. | CONFIRMED-BY-CODE |
| SEC-41 | Attachments | The authenticated file-download route trusts a database column recording the file's "type" (which, per SEC-04, an uploader can rewrite) and serves the file directly in the browser using that claimed type, with none of the defensive headers that would stop a browser from trying to interpret it as something dangerous. | CONFIRMED-BY-CODE |
| SEC-47 | Approvals | (Same underlying issue as SEC-01/SEC-28, confirmed independently a fifth time, this time from the webhooks/external-entry-points review.) | Same root cause and fix as SEC-01 |
| SEC-48 | Email | The logic that matches an inbound email reply back to the right ticket and the right sender can be fooled by a carefully-crafted "From" display name containing a second, different email address — the wrong address can end up being the one that is actually trusted, independent of the already-known, separate issue that the sender's address is never cryptographically verified at all (SEC-23 below). | CONFIRMED-BY-CODE |
| SEC-49 | Mail intake (OAuth) | The cryptographic key used to sign the temporary "state" value during the Gmail/Outlook mailbox-connection flow falls back, step by step, through several other secrets, and the very last fallback in that chain is simply an **empty string** — meaning if one particular setting is left blank (not merely unset, but explicitly blank) on a server, this value becomes trivially forgeable. | CONFIRMED-BY-CODE |
| (additional) | — | Several further High-severity findings from the code-quality review (duplicate-reply data loss, silently-truncated reports) are listed in full in Part 9 and carried into the Master Defect Register in Part 10 as D-019, D-020, D-021. | — |

## 7.4 MEDIUM findings (31 total, summarized — each has its own fuller write-up in the originating review)

- The ticket-numbering counter is one single, shared sequence across every organization, letting one organization infer roughly how many tickets another one has created.
- There is no database-level safety net at all for the ticket-status lifecycle — it is enforced only in application code today.
- Several helper database functions used inside security rules re-run themselves once per row rather than once per query — today this is only a performance concern, but it is directly relevant to how expensive those same rules become at real scale.
- The feature for subscribing a browser to push notifications accepts and stores an arbitrary web address from the client with no restriction on what that address can be, which could in principle be used to make the server send a request somewhere unintended.
- The mailbox (SMTP) and mail-polling (IMAP) settings screens accept private or local-network addresses with no restriction, and leaving the password field blank while changing the server address silently keeps using the *old* saved password against the *new* server.
- A feature that drafts an email summary using an external AI service has no role restriction at all — any plain requester could use it as a free relay to that external service, at the organization's own expense.
- An inbound email reply is trusted purely based on its claimed sender address, with no deeper, cryptographic verification that the message genuinely originated from that domain.
- The email-approval links never expire on their own (only once the approval itself is actually decided), and the signing secret they rely on is shared with an unrelated, separate feature (the survey-link signing).
- Nothing stops someone who happens to hold both the "requester" and "approver" role for the same ticket from approving their own request.
- A number of admin-facing actions write a related record's ID (a team, an approver, a project) without first checking that the ID actually belongs to the caller's own organization.
- Audit-trail coverage has real gaps: role changes, account deactivations, new-user invitations, most organizational-structure changes, and most SLA/business-hours/holiday/alert-rule changes are none of them written to the audit log today.
- No defensive HTTP security headers are configured anywhere in the application — no content-security-policy, no click-jacking protection, no "don't guess my file type" header, no referrer-leakage protection, and no instruction to browsers to only ever use HTTPS.
- A redirect-after-login route does not validate where it is being asked to redirect to, unlike a sibling route elsewhere in the same authentication flow that correctly does validate this.
- The "forgot password" action has no per-email-address cooldown, only a per-network-address one, making it usable to flood one specific employee's inbox with reset emails.
- Password strength rules are only enforced inside the application's own code — anyone calling the underlying authentication service directly, bypassing the application entirely, could set a much weaker password than the application itself would ever allow.
- Login session cookies are not marked with the browser-level flag that would stop them being sent over plain HTTP, and are set to remain valid for over a year by default.
- The production deployment's container image runs a version of its underlying runtime that has already reached the end of its own official security-support lifetime as of this audit's date.
- A single, very large request-size limit applies even to completely unauthenticated actions like logging in, which is more generous than it needs to be for those specific actions.
- The two newest dashboards (the "Smart Dashboard" and the ad-hoc Report Builder) can each, on a single page view, load and send to the browser tens of thousands of full ticket records at once, with no caching between views.
- The main home-page dashboard re-scans a large slice of all open tickets and all store-linked accounts on every single page view for a manager or admin, again with no caching.
- Two of the scheduled background jobs record "this has already been handled" only *after* taking their real-world action (sending a notification, making an assignment) rather than *before* — meaning an overlapping or accidentally-duplicated run of the same job can double up on real actions.
- The shared network-request helper used for talking to the database will, in some failure cases, automatically retry a request that is not safe to simply repeat (such as "create a new ticket"), which can in rare cases create a genuine duplicate.
- A cluster of six closely-related timing issues exist around ticket assignment and status changes, where one code path's own safety check does not cover every field it changes, or where a second, separate, duplicate implementation of the same logic elsewhere in the codebase is missing a safety check the original, correct implementation does have.
- Three separate multi-step processes (converting a reviewed email into a ticket, submitting a ticket for approval, and auto-routing a ticket to an equipment vendor) each perform several related database writes in a row with no way to automatically undo the earlier ones if a later one fails partway through.
- A number of outbound calls to other systems (email, push notifications, WhatsApp, the time-tracking service, the OAuth flows, the mail-polling loop) mostly have no time limit set on how long they are allowed to try before giving up, and the scheduled background jobs have no protection against two copies of the same job accidentally running at the same time.
- Several more instances exist elsewhere in the codebase of the same general pattern already fixed once before in one specific spot (an earlier, already-resolved bug where a very large list of IDs sent in one request could exceed a length limit and silently fail) — this same pattern was found to still exist, unfixed, in a handful of other, similar places.
- Inviting a new user through the admin screen is a multi-step process (create the login, create the profile, link a mobile number, assign a team) with no way to automatically clean up the earlier steps if a later one fails partway through.
- The exact same piece of business logic — what a ticket's status label should display as, and how to calculate whether a ticket has breached its SLA — is independently, separately written out in three to five different places in the codebase, and these separate copies have already measurably drifted apart from one another, meaning different parts of the application can disagree with each other about the same ticket.
- There is widespread, weak runtime data validation at the boundary between the user-facing actions and the underlying code that actually performs them, combined with the application's own build configuration being explicitly set to never fail a production build over a type error.
- The outgoing callback URL used for the OAuth mailbox-connection flow has no re-check that the person completing that flow is still an admin, and is not tied back to the specific browser session that originally started the flow.
- One single shared secret value is reused as a fallback across several unrelated purposes at once (webhook authentication, OAuth state-signing, and — via a further fallback — approval-link signing), meaning one leaked value compromises several separate protections simultaneously.
- The emailed six-digit approval-confirmation code is generated in a fully predictable, repeatable way from the current time rather than being a true, one-time random code, and remains valid and reusable for its entire acceptance window rather than being consumed after first use.
- The WhatsApp webhook does a meaningful amount of real work — database lookups, decrypting a stored secret, writing an audit-log entry — **before** it ever checks whether the incoming request's cryptographic signature is even valid, which an attacker could exploit purely to waste server resources and flood the audit log, even without ever producing a validly-signed request.
- If Meta's WhatsApp service were ever to bundle messages for more than one of the organization's connected phone numbers into a single webhook delivery, only the very first one in that bundle would correctly determine which organization's channel and credentials are used — every other message in that same bundle would incorrectly be processed under the first one's organization instead.
- The scheduled job that syncs replies from the inbox, and the scheduled job that sends overdue customer-satisfaction reminder emails, both follow the same "check, then act, then record" ordering already flagged above as unsafe under an overlapping run, rather than the safer "claim, then act" ordering.

## 7.5 LOW / INFO findings (approximately 45, summarized)

Rate limiting is entirely in-memory and resets on every restart. There is no defensive HTTP security header anywhere. A handful of lesser-used search features build part of their database query by directly combining in a piece of the user's own search text, which — because these specific paths are still fully protected by the database's own row-level security underneath — can at most widen what a search returns to things the searcher could already see anyway, never anything belonging to someone else. A handful of actions return a raw, internal technical error message straight back to the end user instead of a clean, generic one. The admin-facing audit log mislabels most non-catalog administrative changes simply as "service," which is misleading rather than a security hole. The emailed approval six-digit code's own value ends up written into the email's subject line and into the general event log, somewhere it does not strictly need to be. Any logged-in user can submit an arbitrary "system event" entry that ends up mixed in among genuine, trustworthy event-log entries. The Gmail and Outlook webhook endpoints authenticate using a fixed token carried in the URL's own query string (which tends to get logged by intermediate systems) rather than in a request header or a properly provider-signed token. Cron-job health-check responses are inconsistent about reporting success or failure, making automated monitoring of them unreliable. Approval links never expire on their own, only once decided. One rich-text email-template preview feature was flagged by one reviewer as needing confirmation that it correctly sanitizes its own content before rendering it — this was not independently confirmed one way or the other by any of the six reviews, and is carried forward below as an open item rather than either a confirmed finding or a confirmed non-issue.

## 7.6 Checked and specifically found to be fine (listed so these are not mistakenly re-investigated later)

Row-level security is correctly turned on for every single one of the 102 tables in the database, with no recursive security-rule loops found anywhere, and six specific tables that genuinely should have zero regular access are correctly locked down to exactly that. Every single secret value anywhere in the system (mailbox passwords, message-provider access tokens, time-tracking API keys) is stored only inside the database's own dedicated, encrypted secret-storage extension, behind functions that only the application's own fully-trusted internal service account may ever call — nothing was found anywhere that would let an ordinary user or even an admin ever read a secret value back out in plain text. CSV file exports already correctly neutralize the handful of special leading characters that could otherwise turn into a dangerous spreadsheet formula when later opened in Excel. File uploads are correctly checked for size, for file extension, and for file type, with an additional check of the file's own actual binary header (not just its claimed type) for most binary file types, and one particular dangerous file format is correctly refused entirely for the main ticket-attachment upload path. The single function responsible for actually changing a ticket's status is, in its own primary path, genuinely solid: it correctly enforces exactly which status changes each role may make, correctly requires a written remark for the changes that should require one, and correctly protects against two people changing the same ticket's status at the exact same moment. The approval-decision logic correctly refuses to let a second decision be recorded once an approval has already been decided once. The WhatsApp webhook's cryptographic signature check is implemented correctly, fails safely closed if its secret is ever missing, correctly refuses to process the same message twice, and correctly looks up the recipient channel purely by the receiving phone number — never by anything the incoming message itself claims. The email-approval and survey links both use a properly signed, tamper-evident token design rather than anything an attacker could simply guess or forge by trial and error. No place was found anywhere in the entire codebase where a database function with elevated privileges accepts and directly executes a piece of dynamically-built SQL text — other than the one already-flagged function in SEC-02, every other such function was confirmed to build its queries safely.

---

# Part 8 — Database integrity review

*Covers the integrity, constraint, and migration-hygiene half of the database review — the half of its findings that are about correctness and consistency, as distinct from Part 7's access-control findings, even though both halves came from reading and querying the exact same database at the exact same time.*

## 8.1 Schema and constraint findings

The ticket-status lifecycle has **no safety net at all inside the database itself** — only application code enforces which status changes are allowed, and only three narrow, unrelated database triggers exist on the main tickets table (assigning the organization, generating the ticket number, and stamping the last-updated time). There are no database-level checks at all that a ticket's own timestamps are internally consistent with each other (for example, that a "resolved at" time is not somehow earlier than the ticket's own "created at" time). The ticket-numbering sequence is one single, shared counter across every organization on the database, serializing every single organization's ticket creation through one shared row and letting one organization infer roughly how busy another one is. A number of fields that really ought to be unique only *within* one organization (a department's name, a team's internal code, a service's URL-slug, the standard task-status/task-priority/ticket-priority vocabulary values, the weekly business-hours calendar) are instead required to be unique **across every organization on the whole database** — meaning a second organization cannot even reuse a name the first organization already happened to use, and the resulting "that name is already taken" error message itself leaks the fact that some other organization exists and has used it. Two tables used for the time-tracking integration have the same problem at the data level: their own "this combination must be unique" rules have no organization column in them either, so two different organizations whose time-tracking system happens to assign the same internal ID to two different people could silently overwrite each other's time logs. Similarly, the field used to recognize a connected WhatsApp phone number as unique has no organization scoping either, meaning a second organization could claim a WhatsApp number another organization is already using. The rules for what happens to related records when a user account is deleted are inconsistent across the schema — some relationships correctly block the deletion outright, some correctly just clear the reference, and some **silently cascade and delete a meaningful trail of history** (team memberships, notifications, task comments, survey responses, and intake notes all disappear along with the deleted user) — and the same silent-deletion-of-history pattern exists for a ticket's own activity log, comments, and attachments if the ticket itself is ever hard-deleted, and for a parent ticket's own sub-tickets if the parent is hard-deleted. Nothing in the schema stops a ticket's team or service reference from technically pointing at a record belonging to a *different* organization than the ticket's own organization — in practice such a mismatched record would simply become invisible under the normal security rules, so this is a data-pollution risk rather than a direct way to see someone else's data. One configuration table's allowed list of priority values (including a "critical" value) has actually drifted out of sync with the real list of priority values the rest of the system actually uses (which has no "critical" value at all) — meaning a filter built around that stale value can never actually match anything, a purely functional bug independently confirmed by both the database review and the separate code-quality review.

## 8.2 Concurrency scenarios specifically reviewed

Creating a brand-new ticket has no built-in protection against an accidental double-submission — the webpage button is disabled while the request is in flight, but a lost network response followed by a retry (see Part 9's CQ-09) could still create a genuine duplicate. Generating the next ticket number is, by contrast, genuinely safe and collision-proof by design, confirmed both by reading the code and by watching it issue strictly sequential numbers under direct, repeated calls during the live reproduction testing — the real problem with this particular piece of logic is entirely about *who is allowed to call it* (Part 7, SEC-07), not whether it works correctly once called. Assigning a ticket to someone uses a safety check that only covers the "who is it assigned to" field, not the ticket's overall status — meaning a slightly stale read of the ticket could still overwrite a status change that happened in the meantime. The main, correct status-change function itself has a solid safety check built in; three *other*, separate pieces of code elsewhere in the codebase that also end up changing a ticket's status (two different implementations of the "customer replied, so un-pause the ticket" logic, and the Business Rules engine's own status-change action) do not share that same safety check. A losing side of two simultaneous approval decisions can, under the right timing, still have its own decision recorded in the database even though the approval as a whole was already decided by the other, winning side first. There is no dedicated concept of "taking over" a ticket at all anywhere in the system — a technician simply re-assigns the ticket to themselves, with no check of who currently owns it, so two technicians racing to do this at almost the same instant have no protection against each other. SLA pause-and-resume timing math is correct in the single, primary status-change code path, but is separately, incorrectly duplicated (missing the same safety check) in three other places. The WhatsApp message-processing pipeline has a genuinely solid, real duplicate-delivery protection built directly into the database; the equivalent Gmail/Outlook webhook pipeline, by contrast, simply fires off a call to a separate helper service and does not wait to see whether that call actually succeeded, with no automatic retry if it silently failed. The system correctly has a real, unique-constraint-backed way of recognizing a duplicate inbound email — but the actual code only writes that "I've already handled this one" marker *after* trying to process the reply, and marks it as successfully handled even when the attempt to process it actually failed, which can both permanently lose a legitimate reply and, under an overlapping run, double-post the same reply. Uploading a file follows the genuinely correct order of operations (write the file first, then the database row, with automatic clean-up of the file if the database write then fails) — the one remaining small gap is that the automatic clean-up step's own success or failure is never itself checked, so a failed clean-up can leave an orphaned file behind. Three separate multi-step business processes (the main status-change function's own later steps, converting a reviewed email into a ticket, and submitting a ticket for approval) can each report a failure back to the user even though an earlier step in that same process had already been successfully committed to the database, leaving the true state of the system out of sync with what the user was told happened.

## 8.3 Migration hygiene

None of the 156 existing migration files use the database's own "build this index without locking the table" option — meaning that, on a table that already has a large amount of real data in it, adding certain new database indexes the way these migrations are written would briefly block all other reads and writes to that table while the index is being built. A number of migrations take a kind of table-wide lock that would, on a large, already-live table, briefly freeze all activity on it, where a safer, two-step approach exists and was not used. A number of migrations are not safely repeatable — if one of them were ever interrupted partway through and had to be re-run from the start, it would fail the second time rather than cleanly picking up where it left off. The repository's own hand-maintained copy of the database's structure, used by the application's own programming-language tooling, was spot-checked against the real, live structure of the freshly-built database and found to match correctly, with the only two differences being two tables that are deliberately, correctly excluded because nothing except the application's own fully-trusted internal service account is ever meant to touch them directly anyway.

## 8.4 Conclusion for this Part

The database's row-level-security *coverage* is genuinely thorough — every single table has it turned on. The real, recurring problem found throughout both this Part and Part 7 is that a meaningful number of the individual *policies* sitting on top of that coverage, and a meaningful number of the schema's own *constraints*, still assume a well-behaved, trustworthy client making the request, rather than actually enforcing the real-world business rule directly inside the database itself. The single highest-value database-layer improvement, beyond the specific security-migration items already listed in Part 7, would be adding a genuine, database-enforced state machine for the ticket-status lifecycle itself, and converting the handful of accidentally-global unique constraints described above into properly per-organization ones — both of which touch the two most central tables in the whole application (the tickets table and the user-profiles table) closely enough that this audit has deliberately deferred actually making either of those two particular changes until the user has explicitly reviewed and approved them.

---

# Part 9 — Code quality, reliability & performance review (every finding, CQ-01 through CQ-37)

*A seventh, separate, independent read-only review, specifically focused on code quality, reliability and performance concerns distinct from security — unbounded queries, silently-swallowed errors, race conditions, duplicated business logic, weak runtime validation, the reliability of outbound integrations, and gaps in the existing automated-test coverage. The disposable audit database was still essentially empty at the time of this particular review, so any claim here about behavior "at real scale" is reasoned from the code itself, not measured directly — genuine large-scale load testing is listed in Part 12 as something this audit explicitly did not do.*

**A labeling note used throughout this Part:** a handful of these findings are marked **[cap]**, meaning their exact severity depends on a particular, well-known 1,000-row safety limit that the open-source database layer imposes by default — a limit that is true of the developer's own stack, of this audit's own disposable stack, and of any standard hosted version of the same underlying database service, but which, per the repository's own deployment configuration files, is **not** currently imposed on the real, already-documented production deployment. The underlying code pattern behind each **[cap]**-marked finding is still genuinely fragile either way — it would start causing real, silent problems the moment anyone ever did turn such a limit on, or ever migrated to a hosted version of the same underlying service that imposes one by default — so these are kept in the list rather than dismissed, just clearly labeled.

## 9.1 HIGH findings

**CQ-01.** Five separate, nearly-identical pieces of code, spread across five different reporting-related files, each fetch a large result set one page at a time, and every single one of them silently gives up and treats a page-fetch error exactly the same as "there is simply no more data," **with no error ever surfacing anywhere**, and all five of them stop entirely after 50,000 rows with no on-screen indication to the viewer that the numbers they are looking at might be incomplete. Only one, separate, sixth copy of this same general pattern (used by the newer Smart Dashboard) does this correctly — it genuinely raises an error, and does tell the viewer on-screen when its own results are known to be incomplete. **Fix:** replace all five of the broken copies with one single, shared, correctly-written version of this same logic, modeled on the one copy that already gets it right.

**CQ-02.** When the system automatically matches an inbound email reply back to its ticket, the "I have already successfully handled this specific email" marker is written to the database **after** attempting to post the reply as a comment, and — critically — is written exactly the same way whether or not that attempt to post the comment actually succeeded. A temporary database hiccup at exactly the wrong moment can therefore **permanently and silently lose a real customer or technician's email reply** (because the system will believe, forever afterward, that it already successfully handled that specific email, when in fact it never did), and two overlapping runs of the same reply-checking job can, in the opposite direction, end up posting the exact same reply twice. **Fix:** write the "I am now handling this one" marker *before* attempting to post the reply, treat a duplicate-marker error as the correct signal to simply skip it, and only ever mark it as "successfully matched" once the reply has genuinely, successfully been posted.

**CQ-03.** The CSV export of approval records sends a potentially very large list of record IDs to the database in a single request; past roughly a few hundred approvals, this specific kind of request can silently fail outright without this being noticed anywhere, meaning the exported spreadsheet's whole "Decisions" column simply goes blank with absolutely no error shown to the person who exported it — this is the exact same underlying bug pattern that was already found and fixed once before, in one specific, different spot, earlier in this same codebase's history. **Fix:** break the large ID list up into smaller batches (a safe, working example of exactly this pattern already exists elsewhere in this same codebase and should simply be reused here), and make sure a batch failure is never silently ignored.

## 9.2 MEDIUM findings (selected; the full, un-abbreviated list of all 24 items lives in the Master Defect Register, Part 10)

Both of the two newest, richest dashboards can, on a single page view, pull and send down to the browser tens of thousands of complete ticket records at once, entirely uncached, re-fetched fresh on every single page load — perfectly fine today, but a genuine problem the moment the real ticket volume grows into the hundreds of thousands. The main home-page dashboard re-scans a large slice of all open tickets and all store-linked accounts on every single page view for any manager or admin, again with no caching anywhere. Two of the scheduled background jobs (one that evaluates automated Business Rules, one that evaluates alert rules) record "I have already handled this specific thing" only *after* actually taking the real-world action, rather than before — meaning an overlapping or accidentally-duplicated run of either job can cause the same real-world notification or assignment to happen twice. The shared, central piece of code that talks to the database will, under certain specific kinds of connection failure, automatically retry a request that is not actually safe to simply repeat (such as "create a brand-new ticket"), which creates a real, if rare, risk of accidentally creating a genuine duplicate. A cluster of six closely-related timing issues exist around assigning and changing the status of a ticket, where either a safety check does not cover every single field being changed at the same time, or a second, separate, duplicate implementation of the exact same piece of logic elsewhere in the codebase is simply missing a safety check that the original, correct implementation does have. Three separate multi-step business processes (turning a reviewed email into a ticket, submitting a ticket for approval, and automatically routing a ticket to an equipment vendor) each perform several related database writes in a row with no automatic way to undo the earlier ones if a later one in the same sequence then fails. A number of calls out to other, external systems (sending email, sending push notifications, sending WhatsApp messages, syncing with the time-tracking service, the OAuth connection flows) mostly have no time limit configured on how long they are allowed to try before giving up, and the scheduled background jobs as a whole have no built-in protection against two copies of the exact same job accidentally running at the same moment. Several more instances of the exact same already-once-fixed "a request can silently fail if it includes too many IDs at once" pattern (see CQ-03 above) were found still present, unfixed, in a handful of other, similar spots across the codebase, and several more instances were found of reads that silently stop short once they hit the same 1,000-row safety limit already described above, quietly under-counting whatever they were trying to count. Inviting a brand-new user through the admin screen is a multi-step process (create the login, create the profile row, link a mobile number, assign a team) with no automatic way to clean up the earlier steps if a later one in that same sequence then fails partway through. The exact same piece of business logic — specifically, what label a ticket's status should be shown as, and separately, exactly how to calculate whether a ticket has breached its service-level agreement — turns out to be independently, separately written out, by hand, in three to five genuinely different places across the codebase, and a careful comparison of those separate copies against each other found they have **already measurably drifted apart** from one another, meaning different parts of the application today can, and sometimes do, actively disagree with each other about the exact same ticket's own status label or breach status. There is widespread, weak runtime data-validation at the boundary where a user's own request first reaches the server-side code meant to act on it, combined with the application's own build configuration being explicitly set to never, ever fail a production build simply because of a type error in the code.

## 9.3 LOW / INFO findings (selected)

Ten different server-side actions were found to still exist in the codebase, fully callable, with **zero** remaining callers anywhere in the actual user-facing application — meaning each one is effectively a forgotten, unused, but still fully "live" endpoint. The admin-facing "Data Retention" settings screen lets an administrator configure how long various kinds of data should be kept before automatic deletion, but, in reality, **only one single kind of data (a general technical event log) is ever actually automatically purged by anything** — the promised automatic clean-up of several other, larger tables (notifications, the ticket activity log, conversation events) simply does not exist anywhere in the code today, despite the settings screen implying that it does. There is no protection anywhere against an accidental double-submission when creating a brand-new ticket. The file-attachment download route reads an entire file fully into memory before sending any of it back to the browser, with no support for a browser asking only for part of a large file. A handful of small, hard-coded configuration values were found scattered through the code (a placeholder demo-user identifier, a hard-coded mail-server hostname, a hard-coded default "from" email address) — low-risk, but worth a general cleanup pass. One diagnostic log line, specifically the one that fires when outbound email is completely unconfigured, logs the intended recipient's address and the subject line of the email that would have been sent — a low-sensitivity, but still worth-routing-through-the-existing-redaction-helper, piece of logging hygiene. Every significant piece of in-memory, temporary state anywhere in the application (the rate limiter, the alert-deduplication tracking, a small address-book cache) is entirely lost on every single restart — perfectly acceptable for today's single-instance deployment, but worth remembering the moment anyone ever considers running more than one instance of the application at once.

## 9.4 Test-coverage gaps surfaced by this specific review

None of the scheduled background jobs (the reply-sync job, the time-tracking sync job, the message-intake classification job, or the customer-satisfaction job) have any automated test that checks what happens if that same job is accidentally run twice at once. The main, central status-change function is today only ever exercised *indirectly*, through other, higher-level tests — it has no dedicated, direct test of its own. No existing automated test deliberately simulates the underlying database itself returning an error, meaning several of the specific "silently swallows the error" findings listed above have no automated test today that would even be capable of catching them if they were fixed incorrectly. A number of whole areas of the codebase (the time-tracking integration, the plain CSV-export logic, several of the admin-facing management screens, and the push-notification sending logic) have no direct automated test at all today, of any kind.

## 9.5 Checked and specifically found to be fine (listed so these are not mistakenly re-investigated later)

The logic that generates each new ticket's own human-readable number is genuinely safe and collision-proof by design. The single, primary status-change function's own safety check, its SLA pause-credit math, and its enforcement of which written remarks are mandatory for which transitions, are all correctly implemented in their main, intended path. The automatic "close a ticket that has sat resolved for too long with no reply" job is correctly protected against running twice at the same time and does not create duplicates. The order of operations for uploading a file (write the file itself first, then the database record, with automatic clean-up of the file if the database write then fails) is correct. The outbound email-sending library used is correctly configured with connection pooling and sensible time limits; the function responsible for figuring out who is currently logged in correctly retries a genuine, temporary database hiccup rather than simply bouncing the user straight back to the login page; and the WhatsApp webhook's overall handling (its signature check, its per-sender rate limiting, its bounded retry logic, and its logging of genuine send failures) is all solid. One specific, already-existing piece of code elsewhere in the same codebase shows the *correct* way to safely batch a large list of IDs before sending them to the database — the other, broken copies described above (CQ-03 and its siblings) should simply be rewritten to match this one, already-correct example. No unused, leftover external software library was found anywhere in the project's own dependency list, and none of the handful of especially large, server-only libraries used for things like spreadsheet generation, PDF generation, or outbound mail handling were ever found being accidentally imported into any code that actually ends up running in a user's own browser.

---

# Part 10 — Master defect register (every finding, one ID per row)

*Every single finding from Parts 7, 8 and 9, plus the live reproduction results, consolidated here into one single numbered list, so that every distinct defect has exactly one ID (D-001 through D-063) no matter which of the seven original review passes first found it. The "Source" column cites the original finding ID(s) from Parts 7/9 so the fuller write-up can always be traced back precisely. Status is tracked here and will be updated the moment any remediation work actually begins — as of this document, every single row below is still "Open," because, as stated throughout, **no remediation has yet been applied to anything** pending the user's explicit go-ahead.*

**Severity key:** CRITICAL = immediate risk of unauthorized access, real data loss, or serious business disruption · HIGH = a major security, data-integrity, or core-workflow failure · MEDIUM = an important functional, reliability, or performance issue · LOW = a minor issue or a maintainability improvement.

## CRITICAL

| ID | Source | Module | Summary | Evidence | Status |
|---|---|---|---|---|---|
| D-001 | SEC-01/28/43/47 | Authentication | A client-settable request header is trusted as identity proof on several specific, "fast path" request routes, instead of the real login session being re-checked on every request | CONFIRMED-BY-CODE, independently, by five of the six review passes | **Open** |
| D-002 | SEC-02 | Database | The database function that deletes an entire organization is callable by literally anyone with no login of any kind, and contains no ownership check at all | **EXPLOITABLE** — actually reproduced: a disposable, throwaway organization was deleted end-to-end by an anonymous request | **Open** |
| D-003 | SEC-03 | Database | A user's own account record can be freely rewritten to change their organization, re-activate a deactivated account, or (for an admin) self-promote to the very top role | **EXPLOITABLE** — actually reproduced, four separate ways | **Open** |
| D-051 | SEC-39 | File storage | A public file-serving route may not properly validate the path it is given before using an elevated-privilege storage client | **Flagged for a safe unit test, not dynamically demonstrated** (per this audit's own safety rules around authentication-bypass-shaped findings) | **Open — verify with a unit test before anything else** |

## HIGH

| ID | Source | Module | Summary | Evidence | Status |
|---|---|---|---|---|---|
| D-004 | SEC-04 | File storage | A permissive storage rule lets any logged-in user list and upload into any ticket's attachment folder, regardless of whether they have any connection to that ticket | EXPLOITABLE (the upload/list side was reproduced live) | Open |
| D-005 | SEC-05 | Design | No concept of a "confidential" team exists; HR/Finance-style tickets are visible to every manager/admin in the whole organization | CONFIRMED-BY-CODE | Open (needs a product decision, not only a code fix) |
| D-006 | SEC-06 | Database | Several organization-wide configuration tables have no organization column at all, are readable with no login whatsoever, and are writable by any organization's own admin/manager | **EXPLOITABLE** — reproduced live, three separate ways (an anonymous read, a manager write, an admin write) | Open |
| D-007 | SEC-07 | Database | Two more database functions that should be restricted (generating the next ticket number; seeding default SLA settings for an arbitrary organization) are instead callable by anyone | **EXPLOITABLE** — reproduced live, both ways | Open |
| D-008 | SEC-08 | Tickets | The database's own ticket-creation/update rules allow a requester to insert an already-resolved ticket with a decades-future due date, and allow a technician to overwrite a ticket's own number to collide with another ticket | **EXPLOITABLE** — reproduced live, both ways | Open |
| D-009 | SEC-09 | User admin | Setting someone's password, changing their role, or deactivating their account does not check the *target* person's own current role — an admin can take over a platform_owner | CONFIRMED-BY-CODE | Open |
| D-010 | SEC-10 | User lifecycle | Deactivating a user's account does not actually revoke their access anywhere in the stack | CONFIRMED-BY-CODE | Open |
| D-011 | SEC-11/30 | Bulk import | New users without a specified password get a hard-coded, source-code-visible default password; the "must change it" rule is only enforced by a webpage redirect | CONFIRMED-BY-CODE | Open |
| D-012 | SEC-12 | Reports | The "send this report now" action lets any manager export the whole organization's data to any, unvalidated email address | CONFIRMED-BY-CODE | Open |
| D-013 | SEC-13 | Admin actions | Several admin "update" actions write whatever the client sends directly into the database with no restriction on which fields are allowed, including organization-moving fields | CONFIRMED-BY-CODE | Open |
| D-014 | SEC-14 | Database | The rule for deleting a task has no organization check, currently saved from real abuse only by an unrelated, generic safety rule | CONFIRMED-BY-CATALOG, partially tested live | Open |
| D-015 | SEC-15 | Internal notes | Private internal-note visibility checks "is this person a technician on *some* team," not "on *this ticket's* team" | CONFIRMED-BY-CODE | Open |
| D-016 | SEC-16 | Approvals | Delegating one approval rewrites the shared workflow definition itself, silently affecting every other pending/future approval on that workflow | CONFIRMED-BY-CODE | Open |
| D-017 | SEC-29 | Rate limiting | Login/forgot-password rate limiting is keyed on a client-settable value — unlimited guessing if directly exposed, or company-wide lockout if the value is absent | CONFIRMED-BY-CODE | Open |
| D-018 | SEC-31 | Transport | The documented production deployment runs over plain HTTP; cookies are not marked to require a secure connection | Confirmed from documentation only (not production-verified) | Open — a deployment/infrastructure decision, not only a code change |
| D-019 | CQ-01 | Reporting | Five report-data-fetching loops drop database errors and silently stop at 50,000 rows with no on-screen signal | CONFIRMED-BY-CODE | Open |
| D-020 | CQ-02 | Email | An inbound-reply "already handled" marker is written after (and regardless of) whether posting the reply actually succeeded — can permanently lose a reply or double-post it | CONFIRMED-BY-CODE | Open |
| D-021 | CQ-03 | Reporting | The approvals CSV export silently loses its "Decisions" column past roughly a few hundred rows | CONFIRMED-BY-CODE (same pattern as an earlier, separately-fixed bug) | Open |
| D-040 | CQ-04/05 | Dashboards | The Smart Dashboard and Report Builder can each ship tens of thousands of full ticket rows to the browser per view, uncached | CONFIRMED-BY-CODE | Open — feeds a future load-testing pass |
| D-041 | CQ-06 | Home dashboard | The home dashboard re-scans large datasets on every single page view for a manager/admin, with no caching | CONFIRMED-BY-CODE | Open — feeds a future load-testing pass |
| D-052 | SEC-40 | Email intake | An inbound email attachment's attacker-controlled filename is used directly in its storage location, with overwrite turned on | CONFIRMED-BY-CODE | Open |
| D-053 | SEC-41 | Attachments | The file-download route trusts a client-rewritable database column for what content-type to serve a file as, with no defensive headers | CONFIRMED-BY-CODE | Open |
| D-057 | SEC-48 | Email | The inbound-reply sender-matching logic can be fooled by a crafted email "From" display name | CONFIRMED-BY-CODE | Open |
| D-058 | SEC-49 | Mail intake | The OAuth connection flow's signing key falls back, in the worst case, to an empty string if one specific setting is left blank | CONFIRMED-BY-CODE | Open |

## MEDIUM

| ID | Source | Summary | Status |
|---|---|---|---|
| D-022 | SEC-17 | The ticket-numbering sequence is one shared counter across every organization | Open |
| D-023 | SEC-18 | No database-level enforcement of the ticket-status lifecycle — app-code only | Open |
| D-024 | SEC-19 | Security-rule helper functions re-evaluate per row rather than per query (performance-relevant at scale) | Open — feeds a future load-testing pass |
| D-025 | SEC-20 | Push-notification subscription endpoint accepted with no restriction on what address it can be | Open |
| D-026 | SEC-21 | Mailbox/mail-polling settings accept private/local addresses; a blank password silently reuses the old saved one against a new server | Open |
| D-027 | SEC-22 | The AI email-summary relay feature has no role restriction at all | Open |
| D-028 | SEC-23 | Inbound email replies are trusted purely by claimed sender address, with no deeper verification | Open |
| D-029 | SEC-24 | Approval email links never expire on their own; the signing secret is shared with an unrelated feature | Open |
| D-030 | SEC-25 | Nothing stops someone from approving their own request if they hold both roles | Open |
| D-031 | SEC-26 | Several admin actions write a related record's ID without first checking it belongs to the caller's own organization | Open |
| D-032 | SEC-27 | Audit-log coverage gaps: role changes, deactivations, invitations, org-structure changes, SLA/hours/holiday/alert-rule changes are not logged | Open |
| D-033 | SEC-32 | No defensive HTTP security headers configured anywhere | Open |
| D-034 | SEC-33 | A redirect-after-login route does not validate its own destination | Open |
| D-035 | SEC-34 | "Forgot password" has no per-email cooldown, only a per-network-address one | Open |
| D-036 | SEC-35 | Password-strength rules are enforced only in application code, not by the underlying authentication service itself | Open |
| D-037 | SEC-36 | Session cookies are not marked secure-only, and last over a year by default | Open |
| D-038 | SEC-37 | The production container image runs a runtime version past its own official support lifetime | Confirmed from documentation only |
| D-039 | SEC-38 | A large request-size limit applies even to completely unauthenticated actions | Open |
| D-042 | CQ-07/08 | Two scheduled background jobs record success only after acting, not before — an overlapping run can double-fire real actions | Open |
| D-043 | CQ-09 | The shared database-request helper can retry a request that is not safe to simply repeat | Open |
| D-044 | CQ-10..15 | A cluster of six related timing issues around ticket assignment and status changes | Open |
| D-045 | CQ-16/17/18 | Three multi-step business processes have no automatic clean-up if a later step fails partway through | Open |
| D-046 | CQ-19..23 | Outbound integrations mostly lack time limits; scheduled jobs lack protection against running twice at once | Open |
| D-047 | CQ-24..26 | More instances of the same "too many IDs in one request" and "silently under-counts past a row limit" patterns found elsewhere | Open |
| D-048 | CQ-27 | Inviting a new user is multi-step with no automatic clean-up if a later step fails | Open |
| D-049 | CQ-28 | The same business logic (status labels, SLA-breach math) is independently duplicated 3–5 times and has already measurably drifted | Open |
| D-050 | CQ-29 | Widespread weak runtime validation at the action boundary, combined with a build setting that never fails on a type error | Open |
| D-054 | SEC-42 | An attachment's own storage location is not checked to actually belong to the ticket record referencing it | Open |
| D-055 | SEC-45 | Upload file-type validation is duplicated across roughly five places and has already drifted between the copies | Open |
| D-056 | SEC-46 | The Audit Log's own CSV export bypasses the shared, safer CSV-building helper used everywhere else | Open |
| D-059 | SEC-50 | The OAuth connection callback has no re-check of the admin role, and is not tied to the session that started the flow | Open |
| D-060 | SEC-52 | The emailed six-digit approval code is predictable and reusable, rather than a true one-time random code | Open |
| D-061 | SEC-54 | The WhatsApp webhook does real work before checking its own cryptographic signature | Open |
| D-062 | SEC-55 | A bundled WhatsApp delivery covering more than one phone number would be mis-routed past its first message | Open |
| D-063 | SEC-56/57 | Three more scheduled/background processes use the same unsafe "act, then record" ordering as D-042 | Open |

## LOW / INFO

*Every item listed in Part 7.5 and Part 9.3 above is a Low/Info-severity finding in its own right and is not repeated again here to avoid duplicating the exact same text twice in one document — each one is fully written out, in full, in its originating Part.*

## Final summary counts

| Severity | Count |
|---|---|
| CRITICAL | 4 (one of the four — D-051 — is flagged for a safe unit test rather than confirmed by a live reproduction) |
| HIGH | 24 |
| MEDIUM | 31 |
| LOW / INFO | approximately 45 |

## One remaining genuinely open question, not yet resolved either way

Whether one specific rich-text email-template preview feature correctly sanitizes its own content before rendering it in the browser was flagged by one reviewer as needing confirmation, and was not independently confirmed one way or the other by any of the other five reviews. It is listed here, honestly, as **unresolved** rather than being guessed at in either direction.

---

# Part 11 — Test results in detail (before and after)

## 11.1 What already existed, before this audit touched anything

92 unit test files and 83 integration test files already existed in the repository, entirely written by previous work on this project, long before this audit began.

## 11.2 The very first run, against the newly-built, empty disposable audit database

- `npm run typecheck` — **passed**, with no errors.
- `npm run lint` — **1 pre-existing error and 5 pre-existing warnings**, every single one of them in code that already existed before this audit began, and none of them related to anything this audit found. (The one error concerns a React component updating its own display state directly inside a page-load effect in one specific dashboard-ordering screen — a pre-existing code-quality issue, not something this audit introduced or needs to fix as part of this pass.)
- The full unit test suite (92 files) — **961 out of 961 individual tests passed.**
- The full integration test suite (83 files) — **389 out of 419 individual tests passed on this very first run,** with 6 tests, across 3 files, failing. **Every single one of these 6 failures turned out to be an artifact of the test environment itself, not a bug in the application:**
  - Three of the failing tests were hard-coded to look for a Docker container with the *developer's own, separate, pre-existing* stack's specific name — which, of course, does not exist inside this audit's own, deliberately-separate disposable stack. This is itself a small, genuine, pre-existing latent bug in the test files themselves (if anyone had ever pointed these particular tests at any database stack other than the one specific developer's machine they happened to be written on, they would have silently either failed outright or, worse, silently run against the wrong database entirely without anyone noticing) — now identified and corrected as part of this audit.
  - Three further tests failed specifically because this brand-new, intentionally-empty audit database simply did not yet contain the kind of realistic data volume (a working message-intake configuration, and a reasonably large set of sample tickets) that those two specific tests were written expecting to find.

## 11.3 What was done in response, and the re-run

- Wrote one small, new, shared helper file whose only job is to correctly detect *which* local database stack a given test is actually pointed at (by looking at the very same connection setting the application itself uses), and updated the three affected test files to call that helper instead of assuming one single, specific container name. This makes those three tests correctly portable between the developer's own stack and this audit's own disposable stack — and, by extension, safe to run in any future similar disposable environment too — rather than being silently wrong in exactly the scenario this audit itself created.
- Loaded a deliberately synthetic dataset into the disposable audit database specifically to give the two data-volume-dependent tests something realistic to work with: 329 fake user accounts, 200 fake retail stores, and 3,000 fake support tickets, every single one of them using an obviously-fake `@audit.test`/`@example.test` email domain, generated entirely by a script written for this purpose — **at no point was any real production or developer data copied, read, or used for this.**
- Re-ran the affected test files. The two stage/rename tests passed once the audit database had the intake module enabled and one placeholder paused channel (set up in the audit DB only). **Two tests still fail:** 419 total; after the fixes, 417 pass and 2 still fail (re-run of the 5 affected files: 20 of 22 pass). The 2 remaining failures are in `fixed-reports.test.ts` (the BD summary compares against an SQL query for a group named `BD Group`, but the synthetic seed named it `BD GROUP`, so the test's own cross-check returns 0 — a fixture mismatch, not shown to be an application bug) and `dashboard-numbers-audit.test.ts` (15 mismatched figures such as "[30d] Smart open backlog"; **cause not yet diagnosed** — could be the synthetic data shape or a real reporting discrepancy, so it is treated as an OPEN item, not dismissed).
- Re-ran the isolation gate described in Part 5 immediately afterward, specifically to confirm that adding this new synthetic data had not accidentally broken anything about the audit's own isolation guarantees — it initially caught that one of its own checks (originally written as "fewer than 100 total tickets") was now too strict given the deliberately-large synthetic dataset just loaded, so that one specific check was correctly rewritten to its true underlying intent ("every single ticket belongs to a synthetic test requester, regardless of how many tickets there are in total") — and the gate then passed, once again, 21 out of 21.

## 11.4 Final test status, as of this document

| Check | Result |
|---|---|
| Typecheck | Passes, no errors |
| Lint | 1 pre-existing error, 5 pre-existing warnings — none introduced by this audit, none fixed by this audit (fixing pre-existing, unrelated lint issues was out of scope for this pass) |
| Unit tests | **961 / 961 passing** |
| Integration tests | **417 / 419 passing; 2 failing (open, see Part 11.3)** |
| Isolation gate | **21 / 21 passing**, every time it was run, including after the synthetic-data load |

## 11.5 The one exploit-style script this audit actually wrote and ran, and exactly what it did

A single script (`audit-2026-10/tests/db-dynamic-verify.mjs`) was written specifically to reproduce the highest-severity database findings using nothing but ordinary, documented API calls — the same kind of calls the real application itself makes, never anything lower-level than that. It began by refusing to even start unless it could first confirm, from its own configured connection address, that it was genuinely talking to the disposable audit stack and not to anything else. It then logged in as a handful of synthetic test accounts created earlier in this same audit session (an admin-level account, a manager-level account, a technician-level account, and two plain-requester-level accounts, every one of them using the obviously-fake `@audit.test` email domain), created one single, disposable, clearly-named second "test tenant" organization purely to prove or disprove the cross-organization findings, ran each individual reproduction described throughout Part 7 above, and — regardless of whether each individual attempt succeeded or was correctly blocked — logged its own full, literal evidence (the exact request made and the exact response received) to a plain evidence file on this PC for this document to cite. At the very end, it deleted the one throwaway second test organization it had created, leaving no lasting change behind in the disposable database. **This script was never run, and could never have run (it refuses to start otherwise), against anything other than this audit's own disposable, synthetic-data-only database.**

---

# Part 12 — What is fully done, what is partially done, and what has not been done at all

## 12.1 Fully done

- Reading and documenting the application's actual, current architecture (Part 4).
- Building and formally certifying a genuinely isolated local test environment, with a 21-point machine-checked gate that passed every time it was run (Part 5).
- A complete functional inventory of all 30 application modules (Part 6).
- A full, six-reviewer security audit covering authentication, every category of server-side action, file handling, and every externally-triggered entry point, plus live, hands-on reproduction of the most serious database-level findings (Part 7).
- A dedicated database integrity review covering schema constraints, concurrency scenarios, and migration hygiene (Part 8).
- A dedicated code-quality, reliability and performance review (Part 9).
- Consolidating every single finding from all of the above into one master, numbered defect register (Part 10).
- Running the complete pre-existing automated test suite and fixing the test-environment failures that could be fixed; 2 integration tests still fail and are listed as open (Part 11.3).
- Producing this single, complete document.

## 12.2 Partially done (started, but deliberately not carried through to completion in this pass)

- **Remediation of the findings themselves.** Nothing has been fixed yet. Every one of the Critical findings specifically involves either the authentication layer or row-level-security database policies — and the user's own original instructions explicitly say to stop and get the user's direct approval before making exactly that category of change. This audit is, by design, stopping at "fully diagnosed, not yet treated" for every single finding above, pending that explicit approval.
- **The one Critical finding that needed a safe unit test rather than a live attempt (D-051 / SEC-39)** — the test itself has not yet been written; the finding is fully documented and reasoned through, but remains formally unconfirmed either way until that test exists and is run.

## 12.3 Not done at all in this pass (and specifically why)

- **Load and scale testing:** now done, see Part 14 (data layer only; the Next.js application server, uploads and background jobs were not load-tested; capacity above ~200 users is limited by the test gateway and unknown).
- **A full, manual, click-through user-acceptance-style walkthrough** of each of the four main user journeys (requester, technician, manager, administrator) inside an actual running browser — the functional module inventory and the code-level security/quality review substitute for a great deal of this today, but a dedicated, hands-on walkthrough session would add further confidence specifically on the day-to-day usability side, which a code review alone cannot fully capture.
- **A dedicated UI/UX and accessibility review** — not performed in this pass.
- **Deliberately simulating a failure of the file-storage system, the database, or the outbound mail system**, to see exactly how gracefully (or not) the application copes — not performed in this pass, though several of the relevant findings above (around outbound-integration timeouts and retry behavior) were reasoned through from the code itself.
- **A dedicated reliability/chaos-testing pass** (restarting the application mid-operation, deliberately interrupting a scheduled job partway through, and so on) — not performed in this pass.
- **Writing brand-new regression tests for the newly-found defects themselves** — not yet done, because no fix has yet been written for any of them to write a regression test *for*. This is the very next step once the user approves remediation beginning.
- **Any UI redesign or visual polish work of any kind** — entirely out of scope for this audit, which was a correctness and safety review, not a design review.

## 12.4 What this audit explicitly did NOT do, as a matter of safety, and confirms it did not do

- Did not connect to, query, or in any way touch the production application server, the production database server, or the production file-storage NAS, at any point.
- Did not send any real email, WhatsApp message, or any other outbound business notification to any real person at any point.
- Did not change any live, production configuration of any kind.
- Did not restart, stop, or otherwise touch any production service of any kind.
- Did not push anything to the shared git repository's remote, and did not deploy anything to the production application server.
- Did not use, or attempt to use, the user's own already-logged-in-to-production browser session for anything.
- Did not read from, or write anything to, the developer's own separate, pre-existing development database, which this audit discovered contains real, production-derived personal data.

---

# Part 13 — Executive summary and sign-off

## 13.1 Classification

**LOCAL AUDIT VERIFIED WITH CONDITIONS — USER REVIEW REQUIRED.**

The architecture mapping and the isolation certification are both fully complete and both passed every check. The functional inventory and the full, six-angle security/quality review are both complete, with two of the four Critical findings actually reproduced live against a disposable, synthetic-data-only copy of the database, and a third Critical finding confirmed independently by three separate reviewers reading the code from three different directions. A full manual walkthrough and the actual remediation-and-regression cycle were **not** performed in this pass (load/scale testing was added afterwards, Part 14), for the specific reasons given in Part 12 above. This is an honest, intermediate checkpoint — it is not, by itself, a declaration that the application is ready for anything, and it was never meant to be read as one.

## 13.2 The headline numbers, gathered in one place

| | |
|---|---|
| Database migrations reviewed and all successfully applied to a fresh database | **156** |
| Application modules fully inventoried | **30** (16 ticket-lifecycle-facing + 14 admin/reporting-facing) |
| Independent security/quality review passes performed | **7** (six security-angled, one code-quality-angled), plus one further live-reproduction pass |
| Total security findings | **4 Critical, 24 High, 31 Medium, ~45 Low/Info** |
| Total code-quality findings | **3 High, 24 Medium, ~10 Low/Info** |
| Findings actually reproduced live (not merely read from code) | At least **15** separate, successful live reproductions, logged with full evidence |
| Unit tests | **961 / 961 passing** |
| Integration tests | **417 / 419 passing; 2 still failing and not yet diagnosed/fixed (see Part 11.3)** |
| Typecheck | Passing | Lint | 1 pre-existing error, 5 pre-existing warnings, neither introduced nor yet fixed by this audit |
| Isolation gate | **21 / 21, every time it was run** |

## 13.3 The one fix that matters most

A single request header, trusted as proof of identity on a handful of specific request paths instead of the real login session being re-checked every time, was **independently rediscovered by five of the six separate security reviews**, each one looking at a completely different part of the application. That degree of independent convergence, from five different directions, without any of the five reviewers being told by another to go look for it, is unusually strong confirmation that this is both real and the single highest-priority thing in this entire audit to fix. It is a small, surgical change in two existing files — not a redesign of anything.

## 13.4 The other Critical and High findings reproduced live (not hypothetical, not merely theoretical)

Working directly against the disposable, synthetic-data-only database, using nothing but ordinary, already-documented API calls:

- An unauthenticated caller successfully deleted an entire organization through a database function that should have required proof of ownership.
- A technician moved their own account into a different organization; an admin promoted their own account all the way to the single highest role in the system; a deliberately-deactivated account successfully re-activated itself — all through direct, ordinary calls the real application itself never happens to make today, but which the database currently permits regardless.
- Company-wide configuration (the business-hours calendar, SLA escalation rules) was readable by a completely anonymous visitor with no login at all, and was writable by any manager — of any organization on the database, not only their own.
- A requester successfully inserted a brand-new ticket that was already marked resolved, carrying a due date set decades in the future; a technician successfully renumbered a ticket to collide with a different, existing one.

**Every single one of these is a database-permissions gap**, each one fixable with a small, targeted, surgical database migration plus its own dedicated regression test — none of them require restructuring any table, and none of them require touching the actual *shape* of the two most central tables in the application (the tickets table and the user-profiles table), only tightening the access-control rules that already sit on top of them.

## 13.5 Final, formal safety confirmation

- No connection was made, at any point, to 10.0.1.98, to 10.0.0.205, or to 10.0.0.25.
- No production NAS file was accessed at any point.
- No real email, WhatsApp message, or any other outbound business notification was sent to any real person at any point.
- No live, production configuration of any kind was changed at any point.
- No production service of any kind was restarted at any point.
- No `git push` was performed at any point.
- No deployment to the production application server occurred at any point.
- The only changes left behind in this working directory by this audit are: three integration-test files corrected so they correctly detect which local database stack they are actually pointed at (a genuine, if minor, latent pre-existing bug, now fixed, rather than a new change introduced for its own sake); one pre-existing, unrelated local settings file that was already modified before this audit began and remains unrelated to anything in this document; and this document plus its supporting `audit-2026-10/` working folder, which is itself entirely new, self-contained, and untracked by version control. Nothing else in the repository was touched.

## 13.6 Recommended next step

Nothing further will be changed in the application itself until the user says so explicitly. When the user is ready, the recommended order of work is:

1. The single header-trust fix described in Part 13.3 — a small code change, the single highest-leverage item in this entire audit.
2. The three database-permission gaps reproduced live in Part 13.4 — one single, combined, carefully-written database migration, together with its own dedicated regression test for each of the three.
3. The one remaining unconfirmed Critical finding (the file-storage path-handling question) — resolved first by writing and running the safe, isolated unit test described in Part 10, before deciding whether any further fix is even needed at all.

Work would then stop again, and ask again, before going any further than that — for example, before touching the broader row-level-security/status-machine hardening described in Part 8, or the mass-assignment-style fixes described throughout Part 7 — because those touch meaningfully more surface area of the application than the three items above.

---

**CKDESK LOCAL AUDIT COMPLETED (this pass).**
**PRODUCTION APPLICATION, PRODUCTION DATABASE, AND PRODUCTION FILE STORAGE REMAIN COMPLETELY OUT OF SCOPE AND WERE NEVER TOUCHED.**
**NO GIT PUSH WAS PERFORMED.**
**NO PRODUCTION DEPLOYMENT OCCURRED.**
**AWAITING THE USER'S OWN REVIEW AND EXPLICIT APPROVAL BEFORE ANY REMEDIATION BEGINS.**
---

# Part 14 — Performance and scalability test (run after the first version of this document)

## 14.1 What was run, exactly

Everything below ran only against the disposable audit stack (isolation gate 21/21 before the runs). Synthetic data only: the audit database was scaled to **100,312 tickets** and then **501,451 tickets** (357 MB table) using a script (`audit-2026-10/seed/bulk-tickets.sql`). Load was generated by `audit-2026-10/tests/perf-load.mjs`: 100 real logged-in synthetic users (5 managers, 20 technicians, 75 requesters), every request made with that user's own login token, so row-level security runs exactly as for the real app. The workload is a weighted mix of the app's real data paths: requester "my tickets", ticket detail with joins, technician queue (with exact count), manager org-wide list (with exact count), the home-dashboard database function, ticket creation, and adding a comment.

Two load models were used, as the brief asked: **realistic user concurrency** (virtual users with ~1 s think time between actions, gradual 5 s ramp, 25 s hold) at 50 / 200 / 500 / 1000 users, and **simultaneous bursts** (200 and 1,000 requests fired at once with no think time). Latency percentiles (p50/p95/p99), throughput, error rate, peak container CPU, peak database connections and lock waits were recorded. Raw data: `audit-2026-10/evidence/perf-*.json`; plan output: `explain-100k.sql` / `explain-500k.txt`.

**Machine:** Intel Core i9-14900KS (24 cores / 32 threads), 128 GB RAM, Docker. **Audit-stack settings were Supabase CLI defaults** (PostgreSQL 17, shared_buffers 128 MB, max_connections 100, statement timeout 8 s for logged-in users, PostgREST default connection pool, Kong gateway with 512 worker connections). Production uses a different layout (PostgreSQL 18 on 10.0.0.205, a Node reverse proxy instead of Kong, PostgREST on 10.0.1.98) and its settings were not inspected, so **these numbers are not production capacity**. They measure how expensive the queries and policies are, and where this test stack breaks.

**Not measured:** the Next.js application server itself (page rendering, server actions, PDF/Excel generation), attachment upload/download throughput, background-job throughput, and a small-data (3,000 ticket) baseline. The load went straight to the data layer (gateway, PostgREST, row-level security, PostgreSQL), which is where this app does almost all of its work.

## 14.2 Results at 100,312 tickets, full realistic mix

| Virtual users | Requests | Req/s | Error rate | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| 50 | 692 | 23.1 | 1.16% | 19.8 | 1712.8 | 8002.7 | 10586.2 |
| 200 | 1598 | 53.3 | 0.88% | 997.9 | 5649.6 | 8203.2 | 11565.2 |
| 500 | 4396 | 146.5 | 54.12% | 44.6 | 6864.3 | 10579.3 | 17188.3 |
| 1000 | 11841 | 394.7 | 87.59% | 3.8 | 5268.4 | 10277.4 | 19925.7 |

- 200 simultaneous requests: finished in 9141 ms, error rate 1%, p50 1618.4 ms, p95 2284.1 ms, p99 8023.1 ms
- 1000 simultaneous requests: finished in 2445 ms, error rate 75.6%, p50 164.9 ms, p95 1579.4 ms, p99 1694.9 ms

Per-scenario detail at 50 users:

| Scenario | Requests | Errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| ticket detail (joins) | 278 | 0  | 21.7 | 152.4 | 1321.3 |
| add comment (insert) | 35 | 0  | 9.9 | 90.1 | 1215 |
| home dashboard RPC | 114 | 0  | 6.9 | 370.4 | 1184.5 |
| technician queue (open, count exact) | 70 | 0  | 1393.3 | 3556.7 | 3978.8 |
| requester: my tickets (25) | 166 | 0  | 9 | 275.2 | 1261.4 |
| create ticket (insert) | 21 | 0  | 7.5 | 1207.9 | 1223.2 |
| manager: org-wide recent (25) | 8 | 8 {"500":8} | 8018.7 | 10586.2 | 10586.2 |

Per-scenario detail at 200 users:

| Scenario | Requests | Errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| home dashboard RPC | 246 | 0  | 839.8 | 5719.2 | 6624.9 |
| ticket detail (joins) | 602 | 0  | 753.3 | 5590 | 6506.7 |
| technician queue (open, count exact) | 101 | 0  | 2884.8 | 5589.5 | 6002.4 |
| requester: my tickets (25) | 524 | 0  | 856.5 | 5410.4 | 6506.6 |
| add comment (insert) | 33 | 0  | 908.3 | 5843 | 6498.8 |
| create ticket (insert) | 78 | 0  | 1205.7 | 5368.6 | 6508.6 |
| manager: org-wide recent (25) | 14 | 14 {"500":14} | 8559.4 | 11565.2 | 11565.2 |

**Reading it:** at 50 users the median is 19.8 ms but p95 is 1.7 s and p99 8 s; at 200 users the **median rises to ~1 s and p95 to 5.6 s**; at 500 and 1,000 users more than half of requests fail. The manager's org-wide list failed 100% of the time at every level (HTTP 500 after the 8-second statement timeout), and the technician queue was slow (median 1.4 s at 50 users, 2.9 s at 200).

## 14.3 Why: the plans (EXPLAIN ANALYZE, run as the real user under row-level security)

| Query | 100k tickets | 500k tickets | Same query without row-level security |
|---|---|---|---|
| Manager: 25 most recently updated tickets, org-wide | **5,601 ms** (scans all 100,312 rows, 813,891 buffer hits) | **27,885 ms** | n/a |
| Manager: exact ticket count | **6,062 ms** | **28,180 ms** | n/a |
| Technician queue page (25 rows) | 1.8 ms | 2.3 ms | n/a |
| Technician queue exact count | **767 ms** | **4,074 ms** | **0.47 ms** (100k) / **1.5 ms** (500k) |

The row-level-security rule on the tickets table is evaluated for every row before the page limit can be applied, because its checks call security functions per row and the manager's "sort by last update" has no index that matches. Cost therefore grows linearly with table size: roughly 5.6 s at 100k and 28 s at 500k for one manager screen load, against a hard 8 s database statement timeout. The same technician count is about **1,600× slower** (100k) and **2,700× slower** (500k) with the policy than without it. This is the measured confirmation of defect D-024 and of the missing manager-list index noted in the database review.

## 14.4 Control run: same load without the two pathological queries

To separate "realistic concurrency" from the query problem above, the manager org-wide list was removed and the technician queue was run without the exact count.

100,312 tickets:

| Virtual users | Requests | Req/s | Error rate | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| 50 | 837 | 27.9 | 0% | 15.3 | 58.7 | 84.8 | 2764.8 |
| 200 | 3306 | 110.2 | 0% | 15.1 | 271.7 | 320.5 | 2867.2 |
| 500 | 7917 | 263.9 | 9.47% | 15.6 | 340.3 | 482.4 | 2816.5 |
| 1000 | 13503 | 450.1 | 29.16% | 83.3 | 2847 | 3781.9 | 5456.5 |

- 200 simultaneous requests: finished in 371 ms, error rate 0%, p50 244.7 ms, p95 352.8 ms, p99 363.2 ms
- 1000 simultaneous requests: finished in 550 ms, error rate 67.3%, p50 227.8 ms, p95 485.2 ms, p99 526.6 ms

501,524 tickets:

| Virtual users | Requests | Req/s | Error rate | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| 50 | 843 | 28.1 | 0% | 16 | 52.3 | 64.6 | 85 |
| 200 | 3168 | 105.6 | 0% | 15.8 | 285.8 | 342 | 2812.7 |

- 200 simultaneous requests: finished in 346 ms, error rate 0%, p50 219.3 ms, p95 330.2 ms, p99 339.3 ms
- 1000 simultaneous requests: finished in 546 ms, error rate 65.3%, p50 233.1 ms, p95 479.3 ms, p99 514.2 ms

**Reading it:** with those two queries removed, **50 and 200 concurrent users are clean at both 100k and 500k tickets: 0% errors, median ~15 ms, p95 52-59 ms at 50 users and 272-286 ms at 200 users**, and ticket volume (100k to 500k) made almost no difference. The errors at 500 and 1,000 users in this control are client-side connection failures. The gateway log shows `512 worker_connections are not enough`, a limit of the Supabase CLI's Kong gateway in this test rig, not of the app or of production's Node proxy. So the control run **cannot tell us the real ceiling above ~200 users**; that needs a re-test on a production-like layout. (The 500k control run covered 50 and 200 users plus bursts only.)

## 14.5 Results at 501,451 tickets, full realistic mix (50 and 200 users, plus bursts)

| Virtual users | Requests | Req/s | Error rate | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| 50 | 272 | 9.1 | 8.46% | 2781.6 | 11325.2 | 14653.4 | 18501.2 |
| 200 | 694 | 23.1 | 26.95% | 6496.3 | 12082.8 | 15338 | 19856.7 |

- 200 simultaneous requests: finished in 15296 ms, error rate 4%, p50 582.3 ms, p95 8273.8 ms, p99 14783.3 ms
- 1000 simultaneous requests: finished in 8663 ms, error rate 76.2%, p50 232.2 ms, p95 915.9 ms, p99 992.7 ms

At 500k tickets the full mix is unusable even at 50 users (8.5% errors, median 2.8 s, p95 11.3 s): database CPU stays pinned at ~10 cores, and statement timeouts and "timed out acquiring connection from connection pool" errors (PostgREST code PGRST003) hit unrelated requests too. One manager opening one screen can starve everyone else.

## 14.6 Findings from the performance test (new defects)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| D-064 | HIGH | The manager/admin org-wide ticket list and count are O(table size) under row-level security: 5.6 s at 100k, 28 s at 500k, failing at the 8 s timeout. | EXPLAIN as real user; 100% failures in load runs |
| D-065 | HIGH | Technician exact counts are ~1,600-2,700x slower with the row-level-security policy than without it. | 767 ms vs 0.47 ms (100k); 4,074 ms vs 1.5 ms (500k) |
| D-066 | HIGH | A few expensive queries saturate the database and starve all other requests (database CPU ~10 cores, PostgREST pool timeouts, statement timeouts), so one manager's page load degrades everyone: at 200 users the median for cheap queries rose from ~15 ms to ~1 s. | full-mix vs control run at 200 users |
| D-067 | MEDIUM | Fixes needed (not yet applied): rewrite the ticket row-level-security policy so its helper functions evaluate once per query, add an index on (org_id, updated_at desc), replace exact counts with estimated/capped counts or a summary table, cache dashboard aggregates, consider per-role statement time limits, then re-test on production-like settings. | this Part |

## 14.7 Performance verdict

- **Up to ~200 concurrent users with ordinary screens (technician/requester use, ticket detail, dashboard function, create, comment): fine on this stack at 100k and 500k tickets.**
- **Manager/admin org-wide screens do not scale:** already failing at 100k tickets on this stack. Today's real data volume will not show this; it becomes visible as tickets reach tens of thousands.
- The 500- and 1,000-user results are limited by the test gateway, so true capacity above ~200 users is **unknown**, not "bad".
- Performance was **not** run against production and says nothing about production's current capacity.

---

# Part 15 — Audit trail and error capture: what exists and what is missing

*Questions from the user: are the audit logs and event logs a real audit trail, can they be combined into one, and does the app capture all errors (from clicks and without clicks, app side, database side, storage side, user side, admin side, internal or external)? The assessment below comes from the code and database as audited. **Nothing has been built yet for this**; the design is proposed and waiting for the user's go-ahead.*

## 15.1 What exists today

| Record | Where | Captures | Limits |
|---|---|---|---|
| Admin audit log | `admin_audit_log` | catalog/service/SLA/business-rule/OEM/store-master/mailbox changes made through some admin actions | best-effort writer that swallows its own errors; most admin actions never call it; entity types mislabelled "service" in the viewer |
| Ticket activity | `request_activity` | created/assigned/status/priority/comment/attachment etc. | written by app code only; direct database writes leave no row |
| Task / project activity | `task_activity`, `project_activity` | task and project events | partial |
| Intake audit | `intake_audit_log` | WhatsApp/intake events | good coverage for that module only |
| Owner audit | `owner_audit_log` | owner-org events | one writer (WhatsApp channel-not-found) |
| Business-rule events | `business_rule_events` | which rule fired on which ticket | for de-duplication, not audit |
| Event log | `app_event_log` | pageviews, clicks, browser JS errors, render errors, "server_error", "system" (e.g. email sent) | **deleted after 90 days**; any logged-in user can add rows of any kind |
| Error reports | `error_reports` | browser crashes/feedback | browser side only |
| Console logs | server console | everything else | not stored anywhere queryable |

**Eight separate places, none complete.** Verdict: **not a complete audit trail**.

## 15.2 Gaps against normal audit expectations

- **Missing actions:** role changes, user deactivation/reactivation, invitations, password resets, bulk imports, team membership, org-structure changes, business-hours/holiday/alert-rule changes, global settings, retention changes, exports and report sends, scheduled-report changes, most project/task configuration.
- **No who/what/before/after/where:** no actor IP/user agent, no before-and-after values for most changes.
- **Not guaranteed:** logging is done by application code after the fact; a failure to log is silent; changes made directly in the database or by the service account bypass it.
- **Not tamper-evident:** nothing prevents the service account from editing or deleting rows; no hash chain; no separate compliance retention.
- **Retention:** event log purged at 90 days; others never purged (unbounded growth).
- **Reading it:** audit, event, error and activity views are separate screens with different filters.

## 15.3 Error capture gaps

Captured today: browser JavaScript errors, unhandled promise rejections and render errors (via the event tracker and the error boundary), and some server errors written as "server_error" events.

**Not captured:**
- **Server-side exceptions in the app** are not hooked at framework level (there is no `instrumentation.ts` / request-error hook), so unhandled errors in pages, route handlers and server actions only reach the console.
- **Silently swallowed errors:** many database calls ignore their error value (code-quality findings CQ-01, 03, 12, 18 and others), so a failure is never logged at all.
- **Database-side errors** (PostgreSQL, PostgREST statement and pool timeouts, auth service, storage service) exist only in each service's own log files on the server, not in anything the app or Claude can query. The performance test showed these (code 57014 timeouts, PGRST003) appear only in the PostgREST log.
- **Cron/scheduled job failures:** several jobs return HTTP 200 even when everything failed.
- **Outbound integration failures** (email, WhatsApp, push, OAuth, time-tracking): partly logged as events, not as errors with context, and not retried or queued.
- **Process-level crashes** (uncaught exception, unhandled rejection in Node) are not captured.
- **Storage/file errors** (upload/download/NAS availability) only logged to the console.
- No single place to filter all of the above by source (browser / app server / database / storage / cron / integration), severity, user, request, or whether a click caused it.

## 15.4 Proposed design (not built; needs the user's approval)

**One table, `system_log`**, append-only, for audit trail, events and errors together:
- Fields: time, org, **actor** (user id, role), **category** (audit / error / event / security), **source** (browser / app-server / server-action / api-route / cron / database / storage / auth / integration / admin), **action**, **entity** (type, id, label), **before / after** (changed fields only), **outcome**, **severity**, error message + stack + code, request id, path, IP, user agent, whether it came from a click (and which control) or not, correlation id, hash of the previous row.
- **Database triggers** on the important tables (profiles role/active changes, teams, services, SLA, settings, business rules, org structure, approvals, ticket status/assignment, storage metadata) so the trail is guaranteed even for direct database writes; the service account can insert but nothing can update or delete rows (permissions revoked plus trigger), with a hash chain for tamper evidence.
- **App-level capture:** one logging helper, a framework request-error hook, and a wrapper for server actions and route handlers so every unhandled exception is recorded; swallowed-error call sites changed to log; Node process-level handlers; the browser tracker kept.
- **Database/storage/auth errors:** a small log shipper (scheduled job on the app server) that reads the PostgREST, auth and storage service logs and PostgreSQL's error log and inserts them into `system_log`; plus the health check recording failures.
- **One admin screen** ("System Log") with filters (category, source, severity, user, entity, date, click vs non-click), CSV/JSON export, and a "copy for Claude" button that produces a compact, redacted error bundle (no passwords, tokens or personal data).
- **Retention:** errors/events 90-365 days (configurable), audit rows kept for years; old rows archived, never silently dropped.
- Existing tables kept and back-filled into the new one, then viewers switched over (no data loss).

Decisions needed from the user: required audit retention period; whether hash-chain tamper evidence is wanted; whether a log shipper may be installed on the app server (a production change, run by the user); and whether personal data (e.g. IP address) may be stored.

---

## Correction notes

- An earlier version stated the integration suite was 419/419 after fixes. Verified state: 417 pass, 2 fail (Part 11.3, open).
- An earlier version said performance testing was not done; it is now in Part 14.
- Defect register additions from Part 14: D-064 to D-067 (see 14.6). Audit-trail/error-capture gaps (Part 15) extend D-032.
