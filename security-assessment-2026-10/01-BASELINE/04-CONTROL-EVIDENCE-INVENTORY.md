# 04 - Control Evidence Inventory (what the repository itself shows)

Date: 2026-10-15 · Branch read: `security/vapt-iso27001-soc2-local` (same commit as `main` = `origin/main` = `717e5c6`) · Method: read-only reading of the checkout; no command that changes anything, no network, no production access, no ssh.

Purpose: input to an ISO/IEC 27001:2022 and SOC 2 readiness assessment. **This file records facts and where they are written. It does not judge compliance.** Nothing here says a control "passes" or "fails".

## How to read this file

| Class | Meaning used here |
|---|---|
| **B** | Repository evidence: source code, migrations, scripts, or a document that describes a procedure, and the thing itself is in the repo. B shows the control is *designed/written*. It does **not** show it is *running in production* (the repo cannot show that). |
| **D** | Documentation-only: a document in the repo says so; nothing in the repo shows it operating (live settings, schedule records, run logs, approvals). |
| **E** | Missing: looked for, **not found in repository**. (It may exist outside the repo; the repo cannot show it.) |

Source files referenced are the checked-in ones. `file:line` is as read on 2026-10-15.

### Reliability of the documents themselves (facts that affect how much weight a D item deserves)

- `CLAUDE.md` and `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` (status "as of 2026-10-07") are the stated source of truth for production. Many other documents are older and describe retired or different setups: `docs/ARCHITECTURE.md` (reconstructed 2026-08-06; says Resend e-mail, "Local only", `ignoreBuildErrors` on - `next.config.ts` now says type errors fail the build), `docs/RAILWAY-DEPLOYMENT.md` (Railway + hosted Supabase), `docs/WINDOWS-DEPLOYMENT.md` and `docs/PERFORMANCE-MAIN-SERVER.md` (the retired server 10.0.1.12 and `Citykart*` service names; production services are `CkDesk*`), `.claude/uat/*` (2026-06-14, Vercel-era template; every go-live item unticked), `HANDOVER.md` (an older session note: Docker not running, QA accounts, "Admin login" account named). `docs/SYSTEM-AUDIT-2026-09-09.md` says "no automated test suite and no CI/CD"; the tree now has 268 test files (see 6). Treat all of these as history.
- `supabase/migrations/20240101000160_system_log.sql` header says "LOCAL migration; NOT applied to production". `docs/POST-AUDIT-BATCH-2.md` describes the release of 156-163 as "only on your instruction". `security-assessment-2026-10/01-BASELINE/02-LOCAL-ISOLATION-CERTIFICATION.md` (written today) says the previous change was "deployed to 10.0.1.98 over ssh" earlier in the session. **Whether migrations 156-163 and the System Log are live on 10.0.0.205 cannot be established from the repo**; an assessor must read `auth.schema_migrations` on 205. (The assistant's own memory notes, which are outside the repo, record a 2026-10-14 deployment of 156-163; that is not repo evidence.)
- Working tree at read time: `git status` showed uncommitted changes to `.claude/settings.local.json`, `package.json`, `package-lock.json`, `vitest.config.ts`; `package.json` showed `next` / `eslint-config-next` moved from `16.2.9` (committed) to `16.3.8` (uncommitted) while this file was being prepared. The committed state is what is described below.

---

## 1. Governance, policies and roles documented in the repo

| Fact | Where | Class |
|---|---|---|
| Five application roles exist: `user` (shown "Requester"), `agent` ("Technician"), `manager`, `admin`, `platform_owner` ("Platform Owner"). Display labels in one table; enum in the database. | `lib/constants/roles.ts:11-17`; `docs/DATABASE.md`; `docs/ARCHITECTURE.md` §5 | B |
| Authorization is hard-coded `profile.role` comparisons plus Postgres RLS (109 `ENABLE ROW LEVEL SECURITY` and 360 `CREATE POLICY` statements across the migrations). The admin "Roles & Permissions" matrix (`custom_roles` / `permission_overrides`) writes rows but nothing reads them for decisions; the screen is read-only and says "not enforced". | `supabase/migrations/*`; `lib/actions/admin/permissions.ts`; `tests/unit/permission-matrix-not-enforced.test.tsx:1-12`; `docs/SYSTEM-AUDIT-2026-09-09.md` §1 | B |
| Rules for who may work on the system and the servers (AI-assistant and developer rules): test locally only, explicit user OK before every push/deploy, touch only Citykart Desk's own folders/services/database/NAS folder on shared servers, never ask for or repeat passwords, superuser database steps run by the user. | `CLAUDE.md`; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1, §9 | D |
| Production topology, owners of servers, ports, services and scheduled tasks are described in one runbook. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1-§2, §7 | D |
| Named business roles for the WhatsApp pilot ("pilot monitoring owner", "IT Support owner / HR Support owner", "technical escalation owner") are referred to by title; the documents say no one is named yet ("once named"). | `PILOT_MONITORING_SCORECARD.md:5-29` | D |
| An earlier UAT process defined severity levels, fix time targets (Critical before next cycle; High 24 h; Medium before go-live), a triage matrix, a go-live checklist with owner/sign-off table and an "Engineering Lead / UAT Lead / Product Owner" sign-off block. Sign-off cells are empty. | `.claude/uat/severity-matrix.md`, `golive-checklist.md`, `production-readiness.md` (all dated 2026-06-14) | D |
| Information security policy, acceptable use policy, ISMS scope, risk register/assessment, statement of applicability, asset register, data-protection/privacy notice, DPO or security-officer appointment, RACI, management-review minutes, internal-audit programme | - | **E** (searched for these terms; no hit except unrelated word fragments) |

**Evidence gaps (what an assessor would ask for that the repo cannot show):** approved information security policy set and its review dates; ISMS scope statement; named security owner and role descriptions (the repo has software roles, not job roles); risk assessment and treatment plan; asset inventory beyond the server list; management review and internal audit records; competence/awareness records; legal and regulatory register; who approves production changes other than "the user" named in `CLAUDE.md`.

---

## 2. User lifecycle: provisioning, deprovisioning, role changes, reviews, passwords, MFA/SSO

### 2.1 Provisioning

| Fact | Where | Class |
|---|---|---|
| No public sign-up: production auth template sets `GOTRUE_DISABLE_SIGNUP="true"`. (The local `supabase/config.toml` has `enable_signup = true` at lines 176 and 221 - development stack only.) | `deploy/windows/config/auth.env.example:51`; `supabase/config.toml:176,221` | B |
| Accounts are created by an admin: `inviteUser` (admin/platform_owner; generates an invite link, e-mails it through the app's own mailbox; limit 10 invites/min per admin) and `bulkCreateUsers` (CSV import, admin/platform_owner). | `lib/actions/admin/users.ts:335-497`, `:538-764` | B |
| Who may grant which role: only a `platform_owner` can assign `admin` or `platform_owner`; the same rule is applied to bulk import rows. | `lib/actions/admin/users.ts:64-69,357,648` | B |
| Bulk import creates the account with a password immediately and marks `must_reset_password = true`. When a row has no password, a hard-coded default initial password constant (value not repeated here) is used; minimum 8 characters otherwise. The forced-reset gate is in the app layout. The earlier audit recorded this as D-011 "Requires user approval" and it is not changed. | `lib/actions/admin/users.ts:522,699-700,718`; `app/(app)/layout.tsx:37`; `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md` (D-011); `docs/POST-AUDIT-BATCH-2.md` "Deliberately not changed" | B |
| `adminSetPassword` and `resetPasswordsBatch` set a temporary password typed by an admin, mark `must_reset_password = true`, and are audited (bulk batch is audited by count only). Bulk reset excludes admins/platform owners and the caller. | `lib/actions/admin/users.ts:864-892,983-1039` | B |
| Seed file creates one `platform_owner` account (the project owner's address) with a fixed password for local development; `docs/WINDOWS-DEPLOYMENT.md` step 6 says the seed password is "known to anyone who has seen this repo" and must be changed after first login on a real deployment. | `supabase/seed.sql:14-30`; `docs/WINDOWS-DEPLOYMENT.md` (Deployment steps, 6) | B / D |
| Seat limit check exists (`organizations.seat_limit`). | `lib/actions/admin/users.ts:407-426` | B |
| A user directory sync (Google Workspace / HR system) | - | **E** (mentioned only as a deferred idea outside the repo) |
| Approval workflow for granting access (ticket/approval before an account or role is created) | - | **E** |

### 2.2 Deactivation / deprovisioning

| Fact | Where | Class |
|---|---|---|
| Deactivation sets `profiles.is_active=false` **and** bans the sign-in account (`ban_duration: '876000h'`); reactivation lifts the ban. Sign-in code also refuses a profile with `is_active=false`. RLS helper functions treat inactive users as not signed in (migration 157). Audit rows `user.deactivated` / `user.reactivated` / `auth.login_blocked_deactivated`. | `lib/actions/admin/users.ts:99-127`; `lib/actions/auth.ts:38-44`; `supabase/migrations/20240101000157_post_audit_high_security.sql` | B |
| Only a platform owner may deactivate an admin or platform owner; nobody may change their own role or deactivate themselves. | `lib/admin/target-guard.ts:1-25`; `tests/unit/target-guard.test.ts` | B |
| There is no user-delete action (only `undoInvite` removes a half-created invite). Deactivated accounts and their history stay. | `lib/actions/admin/users.ts:331-333`; grep for `deleteUser` | B (absence of delete) |
| Documented leaver (offboarding) procedure; trigger from HR; timing target | - | **E** |
| Signed e-mail links (approval, CSAT) work without a login for their lifetime (approval: 7 days; links sent earlier: until the approval is 14 days old); whether a deactivated person's outstanding link is also refused is not stated in a document. | `docs/POST-AUDIT-BATCH-2.md` (D-029); `proxy.ts:84-91` | D / B |

### 2.3 Role changes

| Fact | Where | Class |
|---|---|---|
| `updateUserRole` (admin/platform_owner) is audited as a `security` record with before/after role. Direct database writes to `profiles.role`, `is_active`, `org_id`, manager and other listed columns are also captured by a database trigger (`profiles` is attached with category `security`). | `lib/actions/admin/users.ts:71-97`; `supabase/migrations/20240101000160_system_log.sql:309` | B |
| Migration 156 limits a signed-in user's self-update of their profile to name, avatar and clearing their own reset flag (previously a user could change their own role/org: audit D-003). | `supabase/migrations/20240101000156_post_audit_critical_security.sql` (D-003 section) | B |
| Current population (as of 2026-09-24 snapshot, from the admin screens): 527 users - 482 requesters, 41 technicians, 2 managers, 0 admins, 2 platform owners. | `main-server-configuration/09-teams-and-users-structure.md` | D |

### 2.4 Access reviews

| Fact | Where | Class |
|---|---|---|
| Periodic access review / recertification of roles, admins or platform owners; list of privileged users on a schedule; review records | - | **E** |
| The Users screen can export all users with role/active/team (CSV, audited as `user.export_csv`), which is the raw material for a review. | `lib/actions/admin/users.ts:899-952` | B |

### 2.5 Password policy and MFA/SSO

| Fact | Where | Class |
|---|---|---|
| App-side minimum is 8 characters at reset, own change, admin set and bulk reset. No complexity, history, expiry or breach-list check in code. | `lib/actions/auth.ts:87,121`; `lib/actions/admin/users.ts:700,868,990` | B |
| Auth-service side: the committed template `auth.env.example` sets no password minimum or reauthentication setting; the local dev config sets `minimum_password_length = 6` and empty `password_requirements`. The earlier audit recorded the service-level policy as open (D-036) and `POST-AUDIT-BATCH-2.md` says it is an `CkDeskAuth` service setting, "not code", with a suggested value. The production `services\auth\.env` is not in the repo. | `supabase/config.toml:182,185,228`; `deploy/windows/config/auth.env.example`; `docs/POST-AUDIT-BATCH-2.md` ("Deliberately not changed") | B / D |
| `GOTRUE_MAILER_AUTOCONFIRM="true"` in the production template. | `deploy/windows/config/auth.env.example:54` | B |
| Password reset / invitation e-mails are sent by the app's own Gmail mailbox, not by GoTrue; the link opens `/auth/confirm` with a Continue button so mail scanners do not use up the token; "forgot password" does not reveal whether an account exists. | `lib/email/auth-mail.ts:1-50` | B |
| MFA: disabled in the local config (`[auth.mfa.totp] enroll_enabled=false`); no MFA or step-up code in the app. SSO/SAML/OIDC: no external provider enabled (`[auth.external.*]` disabled) and no SSO code. | `supabase/config.toml:302-308`; grep `mfa|totp|saml|oidc` in `app` and `lib` (no code hit) | B (absence) |
| Account lockout: none beyond the in-process rate limiter (10 sign-in attempts per account per 60 s; 3 reset e-mails per address per hour; per-IP limits only if `TRUSTED_PROXY_HOPS` is set). The limiter is a process-memory map, lost on restart. | `lib/actions/auth.ts:22-23,69-70`; `lib/rate-limit.ts:1-30` | B |

**Evidence gaps:** joiner/mover/leaver procedure and its approvals; access review records; the actual production `GOTRUE_*` password/session settings; whether the seed/default passwords were changed on production (the repo cannot show); any MFA plan; privileged-user list with justification.

---

## 3. Authentication and session settings (where configured, values)

| Setting | Value | Where | Class |
|---|---|---|---|
| Access-token lifetime (production template) | `GOTRUE_JWT_EXP=3600` (1 hour) | `deploy/windows/config/auth.env.example:7`; `docs/WINDOWS-DEPLOYMENT.md` | B |
| Local dev: `jwt_expiry=3600`, refresh-token rotation on, reuse interval 10 s, e-mail confirmations off, OTP expiry 3600 s, secure password change off | | `supabase/config.toml:165-171,226-234` | B |
| Session cookie flags / lifetime | Not set in the app: the Supabase SSR library's defaults are used (`proxy.ts` and `lib/supabase/server.ts` pass the library's options through). Earlier audit: cookies not `Secure`, 400-day lifetime (D-037, open, tied to HTTPS D-018). | `proxy.ts:96-115`; `lib/supabase/server.ts:11-25`; `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md` (D-018, D-037) | B / D |
| Idle timeout / absolute session limit enforced by the app | not found in repository | - | **E** |
| Session check on every request: `proxy.ts` calls `getClaims()` and redirects unauthenticated users to `/login`; an exact allow-list of paths bypasses the session check (health, version, cron, webhooks, system-log ingest/archive, approval reminders, CSP report, `/csat/*`, `/approve/*`). | `proxy.ts:53-91,121-135` | B |
| Signed "verified user" header: the proxy deletes any client copy of `x-verified-user-id` and re-sets it with an HMAC; the HMAC key is `SUPABASE_SERVICE_ROLE_KEY` (else `CRON_SECRET`). | `lib/auth/verified-user.ts:13-27`; `proxy.ts:28-35,153-165` | B |
| Redirect after sign-in restricted to in-site paths | `safeNextPath` | `lib/auth/safe-next.ts` | B |
| Cron and ingest endpoints: shared secret, constant-time compare (`x-cron-secret` or Bearer); 503 if `CRON_SECRET` unset | `lib/cron-auth.ts:20-30`; `app/api/system-log/ingest/route.ts:15-21` (secret 16+ chars) | B |
| WhatsApp webhook: Meta HMAC-SHA256 signature check on the raw body | `lib/whatsapp/signature.ts:14-26` | B |
| API keys: anon and service-role JWTs are minted with a 10-year expiry (`exp = iat + 10 years`), signed with the shared JWT secret (HS256). Rotation of those keys: described only as "do not change without rebuilding and re-issuing keys". An ES256 signing key (JWKS) was added alongside; a rotation procedure for that key is written. | `deploy/windows/mint-keys.js:11-18`; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §3; `docs/WINDOWS-DEPLOYMENT.md` ("Rotating the key later") | B / D |
| Transport: the app is served over plain `http://` (public `http://182.72.84.10:3210`, router NAT to the app server). No TLS terminator, certificate or HSTS in the repo; HSTS deliberately not set; HTTPS listed as a "later option". | `CLAUDE.md`; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1, §10; `next.config.ts:71-74` | D |
| Response headers set on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a **report-only** Content-Security-Policy (blocks nothing; violations go to the System Log). | `next.config.ts:78-86`; `lib/http/csp.ts`; `app/api/csp-report/route.ts` | B |
| Size cap on public form posts (256 KB) | `proxy.ts:49-52`; `lib/http/public-body-limit.ts` | B |

**Evidence gaps:** production `auth.env` (service settings actually in force); whether production cookies are `Secure`; session timeout policy; evidence of TLS plan/approval; key and secret rotation schedule and records.

---

## 4. Privileged access (platform_owner / admin, service-role key, DB roles, ssh/admin)

| Fact | Where | Class |
|---|---|---|
| `platform_owner` and `admin` can reach `/admin/*` (also `manager`); admin actions each re-check role server-side. Admins cannot change platform owners or other admins (target guard). Platform owner can grant admin/platform_owner. | `app/(app)/admin/layout.tsx:7`; `lib/admin/target-guard.ts`; `lib/actions/admin/users.ts:64-69` | B |
| The server uses a service-role client (`createAdminClient`) that bypasses RLS; 104 source files under `app` and `lib` import it. Inside a request it forwards the signed-in person's id as `x-actor-id` so database audit triggers can attribute writes; the trigger trusts that header only for the service role. | `lib/supabase/admin.ts:6-48`; `supabase/migrations/20240101000160_system_log.sql:279-283`; grep count | B |
| Service-role key is read from `SUPABASE_SERVICE_ROLE_KEY` in the app's `.env.local` on the app server; also used as the HMAC key for the verified-user header. The same JWT secret is shared by Auth, PostgREST, Storage and the proxy. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §3; `lib/auth/verified-user.ts:14` | D / B |
| Database roles named in the repo: `citykart_desk_app` (login, not superuser; used by Auth, PostgREST and Storage), `anon`, `authenticated`, `service_role` (BYPASSRLS), `ck_backup` (BYPASSRLS, backup only), and `postgres` (owner of tables; password typed by the user for DDL). `bootstrap-roles.sql` grants `anon`, `authenticated`, `service_role` **to** `citykart_desk_app`; the runbook says to "SET ROLE service_role" for diagnostics. | `deploy/windows/postgres-extensions/bootstrap-roles.sql:20-36`; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2, §5, §6 | B / D |
| Shared servers: 10.0.1.98 also hosts another application ("Citykart Spinwheel"); 10.0.0.205 hosts other applications' databases. Scope rules say touch only Citykart Desk resources. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1 | D |
| Administrative access to servers is by ssh as the Windows `Administrator` account using a key on the admin PC (`~/.ssh/citykart_newservers`) to 10.0.1.98 and 10.0.0.205. A shared built-in account, not named individuals; key custody and who holds the key are not described. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2 (row "SSH") | D |
| Windows services run under NSSM; the storage service runs as the local Windows user `ckappuser` (same name as the NAS user). The install scripts in the repo do not set a service account for the app/auth/postgrest/proxy services (NSSM default applies; not stated). Scheduled tasks run as SYSTEM with highest privileges. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2-§3; `deploy/windows/services/install-*.ps1`; `scripts/windows/install-cron-tasks.ps1:12` | D / B |
| Secrets live in files on the app server (`.env.local`, `services\auth\.env`, `postgrest.conf`, `storage-src\.env`). Mailbox password and DeskTime/Intake credentials are stored in the database vault (encrypted). | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §3 | D |
| Repo tracks `.claude/settings.local.json` (3 commits touched it) although `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4 says it "must never be committed". No `.env*` files, dumps, keys or JWT-looking strings are tracked (`git ls-files` and `git grep` found none besides `.env.example` and the three `deploy/windows/config/*.example` files). | `git ls-files`; `.gitignore:25-26` | B |
| Developer database dumps and a file archive from the data are present in the repo folder on the dev PC (`local_data_dump.sql` ~5 MB, `local-backup-before-main-mirror-20260922.dump` ~1.7 MB, `local_storage_files.tar.gz`); they are git-ignored (`.gitignore:54-57`) and untracked. Their content was not opened. | working tree listing | B |
| Privileged-action logging: role change, deactivation, password set by admin, user export, mailbox/settings tables, `permission_overrides`, `organizations`, `license_keys`, `email_smtp_settings` are audited through app calls and/or DB triggers into the System Log. | `lib/actions/admin/users.ts` (recordAudit calls); migration 160 trigger list | B |
| Privileged access management: approval/just-in-time for admin or server access; separate admin accounts; break-glass procedure; server login logs review | - | **E** |

**Evidence gaps:** list of people with ssh keys, Windows admin, `postgres` password custody, NAS admin; how many platform owners exist now (2 per the 2026-09-24 snapshot, `main-server-configuration/09-teams-and-users-structure.md`, D); key custody and rotation; separation of duties between developer, deployer and approver (all 271 commits share one author identity, see 5).

---

## 5. Change management

| Fact | Where | Class |
|---|---|---|
| Git repository `github.com/kumarsuraj84/Citykartdesk`; only `origin/main` exists as a remote branch; 31 local branches (feature/fix/local/remediation/security) are not pushed. 271 commits, 2026-08-06 to 2026-10-15; **all 271 have the single author identity "Local Setup <local@citykart.org>"**; 2 merge commits; no signed commits shown; no tags. | `git remote -v`, `git branch -a`, `git log` | B |
| Workflow as written: develop and test on the dev PC (10.0.0.47); run `npx tsc --noEmit` and relevant tests; get the user's explicit OK; commit and `git push origin main`; build; copy zip to 10.0.1.98; swap folders; verify `/api/health` and `/api/version`. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4; `CLAUDE.md` | D |
| Approval described: one person's "explicit OK" before every push/deploy (the project owner). No second reviewer, pull request, or change record format. | `CLAUDE.md`; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §9 | D |
| Some commit messages on `main` read "LOCAL TRIAL (not merged)" or "LOCAL (not merged)" although they are on `main` and equal to `origin/main` (e.g. `717e5c6`, `05e165e`, `3b5e473`). | `git log main` | B |
| Build script `scripts/windows/build-for-deploy.ps1`: separate `.next-deploy`, production URLs baked in, webpack build, stamps `CK_BUILD_ID` (timestamp), fails if local URLs are baked in, checks every static asset referenced by the login page exists, zips the standalone output. Does **not** run tests, lint or type check itself. | `scripts/windows/build-for-deploy.ps1` | B |
| Type errors fail the production build (`ignoreBuildErrors` no longer set). ESLint is a separate script and is not part of the build. | `next.config.ts:92-96`; `package.json` scripts | B |
| Deploy procedure: stop `CkDeskApp`; rename `app\standalone` to `standalone-bak-<timestamp>`; expand zip; copy `.env.local` back; start; keep the latest backup folder. Verification by `/api/health` and `/api/version`. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4 | D |
| Rollback (application): stop service, rename folders back, start. Rollback never reverses a database change. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4 | D |
| Migration procedure: files in `supabase/migrations` (164 files, `…000163` highest); history in `auth.schema_migrations`; run by the user on 205 as `postgres` with `psql -v ON_ERROR_STOP=1 --single-transaction`; back up first; deploy migration **before** the code that needs it (but see release order in batch notes where the app goes first); restart `CkDeskPostgrest` afterwards. `deploy-bundle-migrations-156-163/run-migrations.ps1` automates this (skips recorded versions, one transaction per file, stops at the first failure; password via `$env:PGPASSWORD` typed by the user). `supabase/production/run-ckdesk-migration-155.ps1` takes a `pg_dump -Fc`, verifies it with `pg_restore --list`, then applies. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §5; `deploy-bundle-migrations-156-163/run-migrations.ps1`; `supabase/production/run-ckdesk-migration-155.ps1` | B / D |
| Migration rollbacks exist for 156-163 (`supabase/rollback/*`, copy in the bundle). The change plan records which were executed in a rolled-back transaction and which were applied for real on the disposable database; the rollbacks "re-open the audited weaknesses". Rollback files for migrations before 156: not found in repository. | `supabase/rollback/`; `audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md` §2 | B / D |
| Release order for the post-audit batch (app first, then 160-163 on 205, restart PostgREST, re-run cron-task installer, smoke test) is written down; "behaviour changes people may notice" listed. | `docs/POST-AUDIT-BATCH-2.md` "Release order", "Behaviour changes" | D |
| Records of what was released and when to production (change log, release tickets, who approved): git history on `main`; no release register, no tag, no deployment log in the repo. Production backup-folder naming (`standalone-bak-<timestamp>`) exists only on the server. | - | **E** (beyond git log) |
| Branch protection, required reviews, signed commits, CODEOWNERS, pull-request templates | - | **E** (GitHub-side settings are not in the repo; no `CODEOWNERS` file) |
| Emergency change procedure; separation of dev/test/prod credentials; test environment on a staging server | - | **E** (a local dev stack and a disposable audit stack exist; no staging server) |

**Evidence gaps:** GitHub branch-protection/PR settings; named approver(s) and delegation; per-release records (build id, who, when, tested how); evidence that rollback was ever rehearsed; evidence of migration runs on 205 (`auth.schema_migrations` contents); change-risk classification.

---

## 6. Secure development

| Fact | Where | Class |
|---|---|---|
| Automated tests: Vitest; 268 test files (152 unit, 83 integration, 33 remediation; `tests/vapt` exists). Integration tests run against a local Supabase (real RLS and triggers); remediation tests run only through `vitest.remediation.config.ts`, which refuses anything but the isolated audit stack. Latest recorded results (not re-run now): tsc 0 errors, lint 6 (baseline), unit 1090/1090, integration 401 pass / 0 fail / 18 skipped, remediation 83/83, build OK, gate 21/21. | `vitest.config.ts`; `vitest.remediation.config.ts`; `tests/`; `audit-2026-10/AUDIT-STATE.md` | B / D |
| Scripts: `npm run lint` (eslint over `app lib components types proxy.ts`), `npm run typecheck` (tsc `--noEmit`), `npm test` (`vitest run`). | `package.json:5-12` | B |
| Security-relevant tests exist for: target-role guard, approval link/codes, CSP report, inbound sender authentication, OAuth state, rate-limit client IP, scheduled-report security, system-log writer/shape, plus integration tests named `d03-authorization`, `d04-project-authorization`, `d16-task-creation-authorization`, `item6-assignment-rbac`. | `tests/unit/*`, `tests/integration/*` | B |
| **No CI/CD**: no `.github/`, GitLab, Azure, Jenkins, CircleCI files; no git hooks beyond samples; no pre-commit tooling (no husky/lint-staged). Tests, lint and type check run only when someone runs them by hand. | repo root listing; `.git/hooks` | B (absence) / **E** (automation) |
| Static analysis / secret scanning / SBOM / SAST / dependency bots (Dependabot, Renovate, Snyk, CodeQL, gitleaks, semgrep): none configured or referenced. | grep across repo | **E** |
| Dependency management: `package.json` with caret ranges, `package-lock.json` committed; `next` pinned exact (`16.2.9` committed). Docker image uses Node 22; `.nvmrc` says 20; production Node version on 98 is not in the repo ("Check the Node version installed on 10.0.1.98"). | `package.json`; `.nvmrc`; `Dockerfile:5`; `docs/POST-AUDIT-BATCH-2.md` (D-038) | B / D |
| Next.js specifics: the repo instructs developers (and AI assistants) to read `node_modules/next/dist/docs/` before coding because this Next.js version has breaking changes; edge logic lives in `proxy.ts`, not `middleware.ts`. | `AGENTS.md`; `docs/ARCHITECTURE.md` §0 | D |
| Input/upload controls in code: attachment MIME allow-list (SVG excluded), 25 MB cap, magic-byte check; no malware scanning (`// VIRUS_SCAN_HOOK` placeholder comment). | `lib/attachments/validate.ts:1-40`; `lib/actions/attachments.ts:133` | B |
| Secure-coding standard, code review checklist, threat model, security requirements document, developer security training | - | **E** |
| Separate development, test and production environments: dev PC + local Supabase (Docker), a disposable audit stack (ports 553xx, egress-guard and isolation gate, 21 checks), and production. | `audit-2026-10/guard/*`; `security-assessment-2026-10/01-BASELINE/02-LOCAL-ISOLATION-CERTIFICATION.md` | B / D |

**Evidence gaps:** CI evidence; peer review evidence (one author identity in git); results of the build gate on each release; a written SDLC; dependency update cadence; lint baseline justification (6 findings).

---

## 7. Vulnerability management

| Fact | Where | Class |
|---|---|---|
| Past security reviews kept in the repo: `docs/AUDIT-2026-08-08.md` (six-track read-only audit, ~90 findings, repeated authorization gap); `docs/SYSTEM-AUDIT-2026-09-09.md` (203 KB audit and knowledge transfer); `docs/D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md` (reproduced and fixed an authorization defect); `CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md` and `audit-2026-10/` (full local audit; 4 Critical, 27 High, 38 Medium, ~45 Low/Info); `audit-2026-10/remediation/*` (fixes verified on the isolated stack). | files named | B |
| Status of the 2026-10-13 audit register at last update: Critical 4/4 fixed; High 22 of 27 fixed, 5 open/need decision (D-005 confidentiality tier, D-011 default import password, D-018 HTTP/cookies, D-040/D-041 caching); Medium 14 fixed, 4 partial, 20 open. `POST-AUDIT-BATCH-2.md` records later fixes (D-023, D-026, D-028, D-029, D-030, D-031, D-033 partial, D-038, D-039, D-040, D-044, D-045, D-047, D-048, D-049, D-050, D-055, D-060) and the items left unchanged by decision. | `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`; `docs/POST-AUDIT-BATCH-2.md` | D |
| Dependency vulnerability scanning: no `npm audit` step, schedule, or result recorded in any script or document before today. Two `npm audit` output files exist from this assessment, produced 2026-10-15 15:42: all dependencies 31 findings (1 low, 9 moderate, 17 high, 4 critical); production dependencies 9 findings (3 moderate, 5 high, 1 critical). They are a one-off result of this VAPT, not a standing control, and were not generated by this inventory. | `vapt-2026-10/work/npm-audit.json`, `npm-audit-prod.json` (metadata) | B (one-off) / **E** (standing process) |
| External penetration test, vulnerability scan of servers/network, or third-party report | - | **E** |
| Patch process for operating systems, PostgreSQL, Node, NSSM, GoTrue/PostgREST/Storage binaries: the runbook records versions at install time (PostgreSQL 18, PostgREST 16.x, GoTrue built from source, Node on server unknown) and a rule that the JWT secret must not be changed; no patch schedule, no inventory of versions in use. The auth service is built from source with a Windows patch (`patch-auth-windows.ps1`) and pinned by whoever builds it. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2; `docs/WINDOWS-DEPLOYMENT.md`; `deploy/windows/services/patch-auth-windows.ps1` | D / B |
| Browser-side detection: report-only CSP reports are stored in the System Log. | `app/api/csp-report/route.ts` | B |
| Vulnerability disclosure channel / triage SLA for security findings: `.claude/uat/severity-matrix.md` defines severities for UAT defects (security = Critical); no disclosure policy. | `.claude/uat/severity-matrix.md` | D |

**Evidence gaps:** scan results over time; remediation SLAs actually met; OS/DB/Node patch levels and dates on 98/205/NAS; external test report; risk acceptance records for the open items (D-005, D-011, D-018, D-036/D-037).

---

## 8. Logging and monitoring

| Fact | Where | Class |
|---|---|---|
| **System Log** (migration 160): one append-only table for `audit`, `security`, `error`, `event` records. Update/delete/truncate refused by trigger (only the archive function may move old rows); readable (SELECT) only by `admin` and `platform_owner` of the same organization; written by the server. | `supabase/migrations/20240101000160_system_log.sql:12-86,199-210` | B |
| Hash chain over audit and security rows (`prev_hash`, `row_hash`, `chain_seq`, locked head row); `system_log_verify_chain()` re-checks including the archive; "Verify integrity" button on the Logs screen. | migration 160 `:88-171`; `lib/actions/admin/system-log.ts:201-205` | B |
| 45 business tables carry an audit trigger recording insert/update/delete with before/after (profiles, roles, organizations, mailbox settings, teams, services, SLA and business rules, approvals workflows, requests status/assignment/priority changes, attachments, and others). Sign-in success/failure/block, logout, password changes/resets, role change, deactivation, user export, log export are written by the application. | migration 160 `:306-337`; `lib/actions/auth.ts`; `lib/actions/admin/users.ts` | B |
| Error capture: browser errors (with preceding click), server action / route / cron failures, failed database/auth/storage/outside calls, process crashes; redaction of tokens, keys, e-mail addresses and phone numbers in error text; a flood limiter; a local spool file (5 MB cap) while the database is down. | `docs/SYSTEM-LOG.md`; `lib/syslog/shape.ts:57-67`; `lib/syslog/spool.ts`; `instrumentation.ts` | B / D |
| Log shipper: `scripts/log-shipper.mjs` reads problem lines of PostgREST, Auth, Storage (and parsers for PostgreSQL and the nightly `backup.log`) and posts them to `/api/system-log/ingest` (shared secret, can add only `error`/`event`). Scheduled task `CitykartDesk-LogShipper` every 2 minutes on 98 via `run-log-shipper.ps1`, which reads only the three service logs on 98. A failed backup becomes a `critical` row **only if** the shipper is also run on 205 against `backup.log`; no script in the repo does that, and the PostgreSQL log on 205 has the same status ("To capture it, run the same script on 205"). | `scripts/log-shipper.mjs`; `scripts/lib/log-parsers.mjs:164-171`; `scripts/windows/run-log-shipper.ps1:22-31`; `docs/SYSTEM-LOG.md` ("Log shipper") | B / D |
| Retention settings: System Log errors/events 180 days by default (30-3650 settable in Platform Settings > Retention), then **moved to an archive table, never dropped**; audit and security rows 7 years (`SYSTEM_LOG_AUDIT_YEARS`), then archived; Event Log (page views/clicks) 90 days (7-3650), then deleted. Archiving runs every 6 hours (`CitykartDesk-Cron-SystemLogArchive`). | `lib/syslog/retention.ts:1-12`; `app/api/system-log/archive/route.ts`; `app/api/alerts/run/route.ts:36-41`; `scripts/windows/install-cron-tasks.ps1:6` | B |
| The older `retention_policies` table (request/task 5 years, audit log 7 years, notifications 90 days, attachments 5 years) is editable in Platform Settings but **no job in the repo reads it to archive or purge** (only the System Log and Event Log have working retention). | `supabase/migrations/20240101000027_data_retention.sql`; grep of `retention_policies` in `app`/`lib` (only the settings screen and its action) | B (absence of enforcement) |
| Scheduled-job failures are written to the System Log by `cron-tick.mjs` (best effort; if the app itself is down nothing is recorded except task exit code). | `scripts/cron-tick.mjs:55-67` | B |
| Source IP and user agent are stored in the log; the IP is known only if `TRUSTED_PROXY_HOPS` is configured (otherwise null). | `lib/rate-limit.ts:44-58`; `lib/syslog/process.ts:27` | B |
| Event Log records page views and clicks for every signed-in user (user, path, target, session id, user agent). | `lib/events/record.ts` | B |
| Who reviews the logs, how often, and what triggers action: **not defined for the System Log**. A daily-check procedure exists only for the WhatsApp channel (Audit Log filters). | `docs/SYSTEM-LOG.md` (no reviewer section); `WHATSAPP_PILOT_RUNBOOK.md` "Daily Checks" | **E** (general) / D (WhatsApp) |
| Alerting: no e-mail/push/SMS alert on `critical`/`error` System Log rows, failed backup, failed login bursts, or service down found in the repo. `lib/monitoring.ts` is a console-only stub with a TODO for Sentry. `/admin/monitoring` page exists (counts). Go-live checklist items "Error tracking" and "Uptime monitoring" are unticked (2026-06-14 template). | `lib/monitoring.ts:1-30`; `.claude/uat/golive-checklist.md` §9 | B (absence) |
| Log protection from the database owner: the append-only trigger can be disabled by a superuser/owner; nothing in the repo copies the log off the database server. | migration 160; `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` | B / **E** (off-server copy) |
| Time synchronisation (NTP) for servers; Windows event/security log collection; database server (PostgreSQL) logging settings; firewall logs | - | **E** |
| Windows service logs: NSSM `logs\<Service>.out.log/.err.log`, 10 MB rotation (per runbook). | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2 | D |

**Evidence gaps:** reviewer, cadence and sign-off of log reviews; alert routing and on-call; proof the System Log/migration 160 is live and the shipper task registered; log volume and retention actually applied; off-server/immutable copy of audit records; Windows/DB/network device logs.

---

## 9. Backups and recovery

| Fact | Where | Class |
|---|---|---|
| Nightly full dump of database `ckdesk` at 02:30: scheduled task `CK_Backup_CKDESK` on 10.0.0.205 runs a generic script `C:\ProgramData\CKBackup\backup-db.ps1` (`pg_dump -Fc`, integrity check with `pg_restore --list`), writes to `E:\DB BACKUP\CK_CKDESK_DBBACKUP`, keeps 30 days, logs OK/FAILED in `backup.log`, uses backup role `ck_backup` (BYPASSRLS). **The script itself is not in the repo**; only this description is. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §2, §6 | D |
| Manual backups before migrations are built into the repo's migration scripts (full `pg_dump -Fc` to the same folder, verified with `pg_restore --list`, abort if bad). A pre-cutover dump of the retired server is kept on 205 (`main_final_precutover_20261007.dump`). | `supabase/production/run-ckdesk-migration-155.ps1`; `deploy-bundle-migrations-156-163/run-migrations.ps1` (instructions); runbook §8 | B / D |
| Attachments are on the NAS 10.0.0.25 (`CKAPPLICATIONS_DATA\CKDESK_DATA`, one sidecar `.xattrs.json` per file); "RAID/snapshots are the NAS's job". No NAS snapshot/backup configuration is described. | runbook §1, §6 | D |
| **Second copy outside 10.0.0.205: "Not done yet"** (proposal: separate NAS share, backup-only NAS user, 03:15 copy, ~90 days, snapshots, monthly restore test); recorded as an open item "deferred by the user". | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §6, §10 | D |
| The dump does not contain the database settings `app.vault_key` / `search_path` nor the `vault.secrets` rows; a restore needs these re-created and the mailbox password re-entered. "Recommended improvement: extend the backup to also export the DB settings and the vault row" - not done. | runbook §6 | D |
| Restore procedure written: create database with owner `citykart_desk_app` and the roles; `pg_restore -U postgres -d ckdesk`; set `search_path` and a new `app.vault_key`; re-enter the mailbox password; restart the five `CkDesk*` services. | runbook §6 | D |
| Restore **test**: no dated record of a restore test of a nightly backup into a scratch database exists in the repo. What exists: (a) the 2026-10-07 migration from the old server was rehearsed with a copy of data restored on the new servers (runbook §8, narrative, no log); (b) a pg_restore `--list` readability check inside the scripts; (c) the audit stack restored synthetic data. Not claimed as a backup restore test. | runbook §8; scripts | **E** |
| Backup monitoring: the shipper has a `backup.log` parser raising `backup.failed` (critical), but it is not wired on 205 by any repo script (see 8). Runbook says "Check the log after changes to the DB" (manual). | `scripts/lib/log-parsers.mjs:164-171`; runbook §6 | B / D |
| Backup of application configuration/secrets (`.env.local`, `auth\.env`, `postgrest.conf`, `storage-src\.env`) and of the app folder, scheduled-task definitions, NSSM settings; backup encryption; backup access control list | - | **E** |
| Business continuity / disaster recovery plan, RTO/RPO targets, DR site, tabletop or failover test | - | **E** |
| Pilot-level rollback for the WhatsApp channel ("pause-and-preserve", never delete) | `WHATSAPP_PILOT_RUNBOOK.md` "Rollback Plan" | D |

**Evidence gaps:** backup script itself and its last N logs; evidence of a successful restore with date, person and result; off-site/offline copy; backup of vault key and secrets; RTO/RPO; NAS snapshot policy; DR plan.

---

## 10. Availability

| Fact | Where | Class |
|---|---|---|
| Single points of failure as documented: one app server (10.0.1.98) running five services and the cron tasks, one database server (10.0.0.205, shared with other apps), one NAS (10.0.0.25), one router NAT for public access, one shared Gmail mailbox for outbound and inbound mail. No replicas, standby, load balancer or failover in the repo. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1 | D |
| Health: `GET /api/health` (service-role read of `profiles`; 200 `{status:ok,db:ok}` or 503) and `/api/version` (build stamp). Both are public by design. Used by the deploy verification. | `app/api/health/route.ts`; `app/api/version/route.ts`; `proxy.ts:57-58` | B |
| Restart behaviour: services installed `SERVICE_AUTO_START` through NSSM; after-reboot checklist (all five `CkDesk*` services running, health OK, three cron tasks Ready, an old attachment opens, public URL answers). Reboot test of 10.0.1.98 is an open item ("the user will do it and report"). | `deploy/windows/services/install-*.ps1`; runbook §7, §10 | B / D |
| Cron tasks use `-StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit 10 min`: Alerts 30 min, BusinessRules 15 min, EmailReplySync 1 min, Csat 30 min, SystemLogArchive 6 h, ApprovalReminders daily 10:00, LogShipper 2 min. | `scripts/windows/install-cron-tasks.ps1`; `add-approval-reminder-task.ps1` | B |
| Client-side resilience: fast-fail breaker and retry rules for calls to the API services (REL-1); proxy reuses keep-alive connections with one retry on stale sockets. | `docs/POST-AUDIT-BATCH-2.md` (REL-1); `deploy/windows/proxy/server.js` | B / D |
| Capacity evidence: load tests with synthetic data; a 2026-09-17 acceptance report records that target-scale capacity (220 requesters / 60 technicians) was **not verified** (55.4% failure rate at that load at the time); later performance work on the audit stack (100k and 500k tickets) is in `audit-2026-10/`. | `docs/CITYKART-DESK-FINAL-GO-LIVE-ACCEPTANCE-2026-09-17.md` §1; `CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md` Part 14 | D |
| Uptime monitoring / external probe, capacity monitoring, paging; documented service-level targets; maintenance windows | - | **E** (`perf-sampler.ps1` is an investigation tool, not monitoring) |
| In-process rate limiter, in-process caches (mailbox 30 s, dashboard 60 s) are per-process; no shared cache (single instance assumed). | `lib/rate-limit.ts`; `lib/email/mailbox.ts:8-9` | B |
| The old Docker/Railway path (`Dockerfile`, `railway.toml` with `healthcheckPath=/api/health`, restart ON_FAILURE x3) is not the live deployment ("the live server does not use Docker"). | `Dockerfile`; `railway.toml`; `docs/POST-AUDIT-BATCH-2.md` (D-038) | B / D |

**Evidence gaps:** uptime history, incident/outage records, capacity monitoring, reboot-test result, tested failover or restore time, UPS/power/network redundancy details, vendor support contracts.

---

## 11. Data protection

| Fact | Where | Class |
|---|---|---|
| **Classification**: no data classification scheme or labels. The earlier audit found no confidentiality tier for HR/Finance-style teams (any manager-level user sees every team's requests): D-005 "Requires user approval". | `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md` (D-005) | E (scheme) / D (finding) |
| **Encryption in transit**: public URL `http://182.72.84.10:3210` is plain HTTP; Supabase URL `http://10.0.1.98:8443` is plain HTTP; reverse proxy is a small Node `http` server with no TLS; cookies not marked Secure (D-018/D-037). Application to database link (98 to 205, TCP 5432): the committed config templates are for loopback with `sslmode=disable`; the production connection settings (TLS or not) are in files not in the repo. SMB to the NAS: encryption not stated. Outbound SMTP uses STARTTLS (`requireTLS` when authenticating on a non-465 port); IMAP uses TLS (port 993); calls to Meta, DeskTime and the LLM use `https://`. | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1; `deploy/windows/proxy/server.js:6-12`; `deploy/windows/config/*.example`; `lib/email/send.ts:35-38`; `lib/email/inbound.ts:120-124` | D / B |
| **Encryption at rest**: stored secrets (mailbox password, Intake/WhatsApp credentials, DeskTime key) are encrypted with pgcrypto `pgp_sym_encrypt` through a shim of `supabase_vault`. Disk or database-volume encryption on 205, the NAS volume or backups: not stated. Attachment files on the NAS are plain files plus a sidecar. | `docs/WINDOWS-DEPLOYMENT.md` ("supabase_vault"); `deploy/windows/postgres-extensions/supabase_vault--1.0.sql`; runbook §3 | B / D |
| **Key management**: the vault key is a database setting `app.vault_key` (generated once, "never in a file, never in git"); not included in database dumps; a restore needs a new key and re-entry of secrets; no rotation procedure, no escrow. JWT secret shared by all services; anon/service-role keys 10-year; ES256 key rotation procedure written. Secrets in server `.env` files. | `deploy/windows/postgres-extensions/set-vault-key.sql`; runbook §3, §6; `deploy/windows/mint-keys.js` | B / D |
| **Personal data held** (from schema/code): employee name, e-mail (sign-in), employee id, job title, manager, department, location, store, cost centre, designation, one or more mobile numbers per profile, avatar, WhatsApp opt-in; ticket text and attachments, internal notes; e-mail conversation bodies and participant addresses (Intake); WhatsApp conversation events; Web Push subscription endpoints and keys; CSAT ratings; DeskTime time and application-usage logs matched to people by e-mail; page-view/click event log; source IP and user agent in the System Log. | `docs/DATABASE.md`; `lib/actions/admin/users.ts`; `supabase/migrations/20240101000140_*`, `…079_desktime_sync.sql`, `…143_app_event_log.sql`; `lib/push/send.ts` | B |
| User base is staff of the organization: 527 accounts (2026-09-24 snapshot): roughly 308 head office, 214 stores. The `main-server-configuration` snapshot deliberately holds no individual records. | `main-server-configuration/README.md`, `09-*.md` | D |
| Sensitive content risk: a planning document states that some old ticket notes contain a default password and must be cleaned before any indexing; a rule now requires resolution notes of at least 10 characters with "no password". | `docs/CKDESK-BOT-COMBINED-PLAN.md:10,53-54` | D |
| **Retention/deletion**: System Log and Event Log retention is enforced (see 8). The general `retention_policies` (5-year requests/tasks/attachments etc.) are not enforced by any job found. No user/ticket anonymisation or deletion function exists in the app (only deactivation). `owner_delete_org()` deletes a whole organization's rows (service-role only after migration 156; skips the log tables after migration 160). | `supabase/migrations/20240101000027_*.sql`; `…156_*.sql`; `…160_*.sql:394-432` | B |
| **Export**: CSV/PDF/Excel exports of tickets, reports, users, system log; user export, log export and scheduled-report changes are audited; scheduled reports can be created only by admins and recipients must be organization addresses. | `lib/actions/admin/users.ts:950`; `lib/actions/admin/system-log.ts:177`; `docs/POST-AUDIT-BATCH-2.md`; `audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md` §4 | B / D |
| Attachments: private storage with RLS and policy hardening in migration 157; downloads served through the app with `nosniff`; no malware scanning (placeholder only). | `supabase/migrations/20240101000157_post_audit_high_security.sql`; `lib/attachments/serve.ts`; `lib/actions/attachments.ts:133` | B |
| Data processing agreements, data-subject request procedure, cross-border transfer register, privacy notice to staff, data inventory / record of processing, DPIA, breach notification procedure | - | **E** |
| Multi-tenant leftovers: organization table and `org_id` on nearly all tables remain although one organization exists; tables added later (`business_hours`, `holidays`, `app_settings`, `retention_policies`...) have no `org_id` (a documented single-tenant simplification). | `docs/SYSTEM-AUDIT-2026-09-09.md` §1 | D |

**Evidence gaps:** data inventory/classification; encryption status of disks, DB link, SMB, backups; TLS plan; vault-key custody and rotation; legal basis, retention schedule actually applied to tickets/attachments/e-mail copies; subject-access and deletion procedures; DPA/contracts with suppliers; the DeskTime monitoring notice to staff.

---

## 12. Suppliers and third-party services (what data goes where)

| Service | What the repo shows | Data sent | Where | Class |
|---|---|---|---|---|
| **Google Workspace / Gmail (SMTP + IMAP)** | Outbound mail `smtp.gmail.com:587` signed in with a Google Workspace mailbox and an App Password (mailbox address documented as an organization address); inbound reply sync reads the same mailbox over IMAP `imap.gmail.com:993` once a minute (3-day look-back), accepts only Gmail hosts. Mailbox password stored in the database vault. Replies from senders failing DMARC/SPF/DKIM per Google's header are not attributed. | Ticket notifications, approval and CSAT links, password-reset and invitation links, OEM vendor mails, scheduled reports; incoming replies (full message read). | `main-server-configuration/07-email-and-alert-configuration.md`; `lib/email/*`; `lib/email/inbound.ts:100-124`; `lib/email/inbound-auth.ts` | B / D |
| **Gmail API / Google Pub/Sub, Microsoft Graph (Outlook)** | Intake channels can connect a mailbox by OAuth; webhooks `/api/intake/webhook/gmail` and `/outlook`; OAuth state signed with a secret. Whether any such channel is active in production is not in the repo. | Mailbox content for intake to tickets | `lib/intake/gmail-api.ts`, `graph-api.ts`, `oauth.ts`; `.env.example`; `proxy.ts:66-68` | B |
| **Meta WhatsApp Cloud API** | Webhook `/api/intake/webhook/whatsapp` verified by HMAC; outbound via `graph.facebook.com`; channel credentials in the vault; a controlled pilot (IT and HR support) was planned; the repo's reports say real-Meta validation was not done in those stages. | Staff mobile numbers, message text and media, ticket details | `lib/whatsapp/*`; `META_OPERATOR_HANDOFF.md`; `WHATSAPP_PILOT_RUNBOOK.md`; `STAGE_8_*` reports | B / D |
| **LLM provider (Groq by default)** | `generateEmailBrief` calls `https://api.groq.com/openai/v1` (model `llama-3.3-70b-versatile`) only when `INTAKE_LLM_API_KEY` is set; callable by intake reviewers only. Not configured by default. | Email subject, From address and first 2,000 characters of the body | `lib/actions/intake/brief.ts:7-60`; `.env.example` (INTAKE_LLM_*) | B (code) / E (whether enabled) |
| **DeskTime** (desktime.com API v2) | API key stored in the vault; scheduled sync `/api/desktime/sync` (the cron-tick job exists; the installer script does not create a task for it); the API key is sent as a URL query parameter `apiKey` to `https://desktime.com/api/v2/json`. | Employee list, per-person project time and application usage, matched to people by e-mail | `lib/desktime/api.ts:1-50`; `scripts/cron-tick.mjs:30`; `scripts/windows/install-cron-tasks.ps1` | B |
| **Browser push services** (Web Push, VAPID) | Subscriptions stored per user; push sent to the browser vendor's endpoint (endpoint allow-list: public https hosts only). Off unless VAPID keys are set. | Notification title/body/link | `lib/push/send.ts`; audit D-025 | B |
| **Resend** (e-mail API) | Optional fallback when no SMTP is configured. | As for e-mail | `lib/email/config.ts` | B |
| **Hosting/infrastructure vendors**: Windows Server 2022 hosts, PostgreSQL 18, Synology NAS (RS1221+), router/ISP for the public IP, GitHub (source). Supabase's open components (GoTrue, PostgREST, Storage) self-hosted; no Supabase cloud in production. | | Source code (GitHub); all data stays on-premises | runbook §1; `docs/ARCHITECTURE.md` | D |
| Google Fonts and gstatic (styles/fonts allowed in the CSP report-only policy) | | Visitor IP to Google when fonts load | `lib/http/csp.ts` | B |
| "Catch me up" ticket summary: built only from the ticket's own history; no outside service. A later AI version is mentioned as possible. | | none | `lib/requests/ticket-summary.ts:1-4` | B |
| Planned (not built): "CK Desk Bot" with an optional outside model provider; open question whether question text and matched chunks may go to an outside provider. | | | `docs/CKDESK-BOT-COMBINED-PLAN.md` §4-§6 | D |
| Supplier register, due-diligence/SOC 2 or ISO certificates of suppliers, contracts/DPAs, supplier monitoring, exit plans | - | | | **E** |

**Evidence gaps:** which integrations are actually enabled in production (settings are in the database/.env); contracts and data-processing terms for Google, Meta, Groq (if enabled), DeskTime; supplier risk review; data location statements.

---

## 13. Incident response

| Fact | Where | Class |
|---|---|---|
| General security incident response plan, severity/classification for incidents, contact tree, on-call roster, communication/notification templates, evidence handling, post-incident review template | - | **E** |
| Operational runbooks that touch incident handling: server operations checklists (after reboot; service control and start order; known gotchas; where logs are) | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §7 | D |
| WhatsApp pilot runbook: daily checks, common failures table, safe actions, and a pause-and-preserve rollback; says to treat repeated `whatsapp_invalid_signature` rows as a possible probing attempt and "note it for the technical escalation owner" (no named person). | `WHATSAPP_PILOT_RUNBOOK.md` | D |
| Detection building blocks: failed sign-ins, rate-limit hits, deactivated-login attempts and role changes are recorded as `security` rows; CSP violations recorded; webhooks log invalid signatures. No alert rule routes them to a person (see 8). | `lib/actions/auth.ts`; `app/api/csp-report/route.ts` | B |
| Evidence of use: past defect-handling is documented (audit reports, fix reports such as `docs/DESK-UAT-001-FIX-REPORT-2026-09-10.md`, `docs/DESK-ALERTRULE-001-FIX-REPORT-2026-09-17.md`; an outage on 2026-09-22 caused by a build/asset-path error is recorded in the comments of `scripts/windows/build-for-deploy.ps1`; a role-attribute fault on first deployment in `docs/WINDOWS-DEPLOYMENT.md`). These are engineering fault reports, not security incident records. A security incident register: none. | files named | D |
| Contact points in the repo: support mailbox address `noreply@citykart.org` used as the default sender, `mailto:support@citykart.org` as the push VAPID subject default. No escalation contact list. | `lib/email/config.ts:92`; `lib/push/send.ts:11` | B |
| Breach notification duties (regulator, customers, staff), legal contacts, cyber-insurance, forensic retainer | - | **E** |

**Evidence gaps:** an incident response plan and its approval; roster; test/exercise records; the security incident register (even if empty); regulator/notification obligations.

---

## 14. Physical and environmental (only what the repo says)

| Fact | Where | Class |
|---|---|---|
| Servers: app server 10.0.1.98 (Windows Server 2022), database server 10.0.0.205 (PostgreSQL 18, data on `D:\POSTGRESQL DB`, backups to `E:\DB BACKUP\...`), NAS 10.0.0.25 (Synology RS1221+, share `CKAPPLICATIONS_DATA`), dev PC 10.0.0.47. Retired: 10.0.1.12 ("Main", hostname `CK-SNOOKER-SRV`, kept disabled; its old database kept as an archive; a final dump kept on 205). | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1-§2, §8; `docs/PERFORMANCE-MAIN-SERVER.md` | D |
| Physical location, room, access control, CCTV, power/UPS, cooling, fire protection, cabling, visitor logs, equipment disposal of the servers/NAS/dev PC; where the NAS and backup disks sit relative to the servers | - | **E** (the repo names IP addresses only) |
| Public exposure: router NAT forwards TCP 3210 to 10.0.1.98; firewall rule "Citykart Desk web app (3210)" on 98. Whether the database port 5432 or the NAS are reachable from outside the LAN is not stated. | runbook §1, §2 | D |
| Dev PC holds a copy of production-like data (local mirror dumps; `main-server-configuration` captured from the live app screens) and signed-in developer tooling; endpoint protection, disk encryption, screen lock: not stated. | working tree; `main-server-configuration/README.md` | B / **E** |

**Evidence gaps:** facility description and access records; environmental controls; media disposal; endpoint security for the dev PC and admin PC holding the ssh key; network diagram with segmentation.

---

## 15. HR / people controls

Nothing is expected in the repository and nothing was found: **not found in repository** - screening, employment terms with security clauses, confidentiality/NDA, disciplinary process, security awareness and training records, role-specific onboarding/offboarding checklists, remote-working rules, contractor and third-party personnel terms. The only people-related items are: software roles (section 1), a deferred idea to sync users from Google Workspace (outside the repo), the user export from the Users screen, and the DeskTime integration that collects staff activity data (section 12).

**Evidence gaps:** all of the above must come from HR and management outside the repository.

---

## Cross-cutting observations (facts only)

1. Most operational controls for production (backups, restore, network, patching, server access, TLS, cookie flags, auth-service settings) are known to the repo only as prose in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`; the live configuration files and scripts (`backup-db.ps1`, `services\auth\.env`, `postgrest.conf`, `storage-src\.env`, scheduled-task registrations, firewall rules) are on the servers and not in the repo.
2. The repository has substantial code-level controls (RLS, audit trail with hash chain, target-role guards, rate limits, signed headers, upload checks, redaction) and a large body of tests, all run manually. There is no automation around them (no CI, no scanner, no alerts).
3. The prose procedures name the project owner as the sole approver and, in git, one author identity for all 271 commits; the repo contains no second-person review record.
4. Several repo documents are explicitly stale (see "Reliability of the documents" above); a few still describe the retired server and old service names.
5. Open items recorded in the repo by the owner, still open at the time of reading: second backup copy (deferred), reboot test of 98, HTTPS with a DNS name ("later option"), D-005 confidentiality tier, D-011 default import password, D-018/D-037 HTTP and cookies, D-036 auth-service password policy, drop of the archived `citykart_desk` database on Main.

## Files read for this inventory

`CLAUDE.md`, `AGENTS.md`, `README.md`, `HANDOVER.md`, `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, `docs/POST-AUDIT-BATCH-2.md`, `docs/SYSTEM-LOG.md`, `docs/ARCHITECTURE.md`, `docs/WINDOWS-DEPLOYMENT.md`, `docs/RAILWAY-DEPLOYMENT.md` (header), `docs/DATABASE.md` (retention and field sections), headers of `docs/AUDIT-2026-08-08.md`, `docs/SYSTEM-AUDIT-2026-09-09.md`, `docs/D-03-SECURITY-VALIDATION-REPORT-2026-09-10.md`, `docs/CITYKART-DESK-FINAL-GO-LIVE-ACCEPTANCE-2026-09-17.md`, `docs/CKDESK-BOT-COMBINED-PLAN.md` (selected lines), `docs/superpowers/specs/2026-10-14-system-log-design.md`; `deploy/windows/*` (configs, services, proxy, roles, vault, key scripts, validation); `scripts/*` and `scripts/windows/*`; `Dockerfile`, `railway.toml`, `next.config.ts`, `package.json`, `.gitignore`, `.nvmrc`, `.env.example` (names only); `proxy.ts`, `instrumentation.ts`, `lib/auth/*`, `lib/rate-limit.ts`, `lib/cron-auth.ts`, `lib/admin/target-guard.ts`, `lib/actions/auth.ts`, `lib/actions/admin/users.ts`, `lib/actions/admin/permissions.ts`, `lib/actions/admin/audit.ts`, `lib/syslog/*` (audit, retention, shape, spool, failure-reporter, process), `lib/email/*` (config, mailbox, auth-mail, inbound, inbound-auth), `lib/supabase/*`, `lib/desktime/api.ts`, `lib/push/send.ts`, `lib/actions/intake/brief.ts`, `lib/attachments/validate.ts`, `lib/http/csp.ts`; `supabase/migrations/20240101000027`, `000155`, `000156`, `000160` (and listing of all 164), `supabase/config.toml`, `supabase/seed.sql` (structure only, secret not repeated), `supabase/production/*`, `supabase/rollback/*`; `deploy-bundle-migrations-156-163/run-migrations.ps1`; `.claude/uat/*`; `audit-2026-10/AUDIT-STATE.md` and `remediation/10`, `11`; `main-server-configuration/README.md`, `07`, `09`; `WHATSAPP_PILOT_RUNBOOK.md`, `PILOT_MONITORING_SCORECARD.md`, `META_OPERATOR_HANDOFF.md`; read-only `git` listings (remote, branches, authors, tracked files, secret-pattern search); `vapt-2026-10/work/npm-audit*.json` metadata only. `.env.local` was not read.
