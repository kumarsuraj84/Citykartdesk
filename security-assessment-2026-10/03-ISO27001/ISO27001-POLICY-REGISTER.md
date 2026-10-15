# ISO/IEC 27001:2022 - Policy and Procedure Register for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

An ISMS normally rests on a set of written and approved policies and procedures. This register lists the 20 that an ISO 27001 certification body would expect to see, says whether each exists in the repository today, and gives a short **draft outline** specific to CKDesk. Every outline is **DRAFT — not approved**. None has been reviewed, adopted or signed by management. **Owner: to be assigned by management** for all 20.

- "Exists in repo?" means a document in the checked-in files. A written procedure is Class D (documentation-only) unless the thing it describes is also shown operating; no Class C evidence (approved policies, signed records) has been supplied for any item.
- Status uses: Designed · Implemented · Tested · Operating with evidence · Not implemented · Not verified. No item is "Operating with evidence".
- Annex A control numbers in the "Related controls" lines are given as a **PROVISIONAL mapping — confirm against the licensed ISO/IEC 27001:2022 standard**. (Annex A has 93 controls: A.5.1-A.5.37, A.6.1-A.6.8, A.7.1-A.7.14, A.8.1-A.8.34.)
- Draft rules marked "(management to set)" need a number or decision that only management can give. Rules that quote facts (for example "minimum 8 characters") describe how the system behaves today and are not recommendations.
- Nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`), which does not contain the LOCAL fixes.

Sources: `security-assessment-2026-10/01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md` ("Inv. n"), `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` ("Runbook"), `CLAUDE.md`, `docs/SYSTEM-LOG.md`, `security-assessment-2026-10/05-REMEDIATION/00-FINDING-STATUS-TABLE.md`.

---

## 1. Register at a glance

| # | Policy / procedure | Exists in repo? | Status | Closest existing material |
|---|---|---|---|---|
| 1 | Information security policy | Not found | Not implemented | `CLAUDE.md` (developer rules only) |
| 2 | Access control policy | Not found as a policy; controls coded | Designed / Implemented (software only) | `lib/constants/roles.ts`, `lib/admin/target-guard.ts`, RLS migrations |
| 3 | Acceptable use policy | Not found | Not implemented | none |
| 4 | Secure development policy | Partly (rules for developers; tests) | Designed (partial) | `CLAUDE.md`, `AGENTS.md`, `package.json` scripts, `tests/` |
| 5 | Change management procedure | Yes, in prose | Designed (not shown operating) | Runbook §4-§5, `docs/POST-AUDIT-BATCH-2.md`, `audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md` |
| 6 | Backup and recovery procedure | Yes, in prose; script not in repo | Designed (restore never tested on record) | Runbook §6 |
| 7 | Incident management procedure | Not found (WhatsApp pilot runbook only) | Not implemented | `WHATSAPP_PILOT_RUNBOOK.md` |
| 8 | Logging and monitoring procedure | System described; no review procedure | Implemented (log), Not implemented (review) | `docs/SYSTEM-LOG.md` |
| 9 | Vulnerability and patch management procedure | Not found | Not implemented | one-off `npm audit` files only |
| 10 | Supplier management procedure | Not found | Not implemented | none |
| 11 | Data classification and retention policy | Not found; retention partly coded | Not implemented (System Log retention Implemented) | `lib/syslog/retention.ts`, `supabase/migrations/20240101000027_data_retention.sql` |
| 12 | Cryptography and key management policy | Partly in prose | Designed (partial) | Runbook §3, `docs/WINDOWS-DEPLOYMENT.md` |
| 13 | Business continuity plan | Not found | Not implemented | none |
| 14 | HR security procedure | Not found (not expected in repo) | Not verified | none |
| 15 | Physical security policy | Not found (not expected in repo) | Not verified | IP addresses only |
| 16 | Remote work and mobile device policy | Not found | Not implemented | none |
| 17 | Risk management methodology | Not found | Not implemented | none |
| 18 | Internal audit procedure | Not found | Not implemented | proposal in `ISO27001-INTERNAL-AUDIT-READINESS.md` |
| 19 | Management review procedure | Not found | Not implemented | proposal in `ISO27001-MANAGEMENT-REVIEW-READINESS.md` |
| 20 | Document control procedure | Not found | Not implemented | git history only |

Totals: some written procedure or description exists, all partial, for 6 items (4, 5, 6, 7 for WhatsApp only, 8, 12); the control exists only in code, with no policy, for 2 items (2, 11); nothing was found for the other 12. None is approved. None is shown operating.

---

## 2. Individual register entries

### 2.1 Information security policy

- **Exists in repo?** Not found. Searched in the inventory (Inv. 1): no information security policy, no ISMS scope, no policy review dates.
- **Status:** Not implemented. **Evidence class:** E.
- **Related controls (PROVISIONAL):** clause 5.2; A.5.1.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* state management's commitment to protecting the information held in Citykart Desk and the intent to meet legal, contract and business needs and to keep improving.
- *Scope:* CKDesk application, production servers 10.0.1.98 and 10.0.0.205, NAS folder `CKDESK_DATA`, developer and admin PCs, integrations and the people who use or run them (see `ISO27001-SCOPE-AND-CONTEXT.md`).
- *Key rules specific to CKDesk:*
  1. Staff, ticket, attachment and mailbox data are Citykart business information and must be accessed only for work purposes.
  2. Production is changed only through the written change procedure; no one experiments on production.
  3. Every sign-in account belongs to one named person; shared accounts are not allowed for application users.
  4. Secrets (passwords, keys, tokens) are never written in tickets, chat, documents or source control.
  5. Security events and weaknesses are reported to the information security lead.
  6. Security objectives are set yearly and reported to management (management to set).
- *Review:* yearly, and after major changes; approval by the top-management sponsor.

### 2.2 Access control policy

- **Exists in repo?** Not found as a policy. The controls themselves exist in code: five roles (`user`, `agent`, `manager`, `admin`, `platform_owner`), hard-coded role checks plus row-level security (109 `ENABLE ROW LEVEL SECURITY` and 360 `CREATE POLICY` statements across migrations), target-role guard (`lib/admin/target-guard.ts`), deactivation that also bans the sign-in account, only platform owners can grant admin/platform_owner, no public sign-up in the production template (`deploy/windows/config/auth.env.example`). Inv. 2, 4.
- **Status:** Implemented in software; Tested for the target guard (`tests/unit/target-guard.test.ts`) and for database rules (`tests/remediation/*`, `tests/vapt/*`, LOCAL isolated stack, Class A). **Not implemented** as a policy; access reviews, leaver process and MFA absent (E).
- **Related controls (PROVISIONAL):** A.5.15, A.5.16, A.5.17, A.5.18, A.5.3, A.8.2, A.8.3, A.8.5.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* make sure only the right people have the right access, for the right time.
- *Scope:* CKDesk application accounts; database roles; Windows servers; NAS; GitHub; mailbox and channel accounts.
- *Key rules specific to CKDesk:*
  1. Requester, Technician, Manager, Admin and Platform Owner rights follow the role matrix in code; the screen "Roles & Permissions" is read-only and not used for decisions (do not rely on it).
  2. Only a Platform Owner assigns Admin or Platform Owner. Number of Platform Owners and Admins is kept to the minimum management sets (management to set); a named list is kept. At the 2026-09-24 snapshot: 2 platform owners and 0 admins.
  3. Accounts are created by an administrator on a request from HR or the line manager; the request is kept as a ticket.
  4. Leavers: account deactivated within a time set by management (management to set) from the HR notice; deactivation also bans the sign-in account.
  5. Privileged users and all technicians are reviewed at least every quarter (management to set); the Users export (audited as `user.export_csv`) is the raw list; the review is signed and kept.
  6. Initial passwords are one-time and must be changed at first use. The bulk-import default password (D-011) is not to be used once the owner decision is taken.
  7. Server administration uses named individual accounts and keys; the shared `Administrator` account and its single key are to be replaced (management to decide).
  8. MFA for administrators and platform owners: plan required (not available in the app today).
  9. Developers and AI coding assistants follow the rules in `CLAUDE.md` (no production experiments, no password requests).

### 2.3 Acceptable use policy

- **Exists in repo?** Not found (Inv. 1).
- **Status:** Not implemented. **Class:** E.
- **Related controls (PROVISIONAL):** A.5.10, A.5.4, A.6.7, A.8.1.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* tell staff what they may and may not do with CKDesk and company information.
- *Scope:* all users of CKDesk (about 553), technicians, administrators, contractors.
- *Key rules specific to CKDesk:*
  1. Do not put passwords, card numbers, government ID numbers or similar in a ticket or attachment (resolution notes already refuse "password" patterns; this is a user rule too).
  2. Use only your own account; never share sign-in links, approval links, approval codes or CSAT links (they work without a login for a period).
  3. Attach only business files; attachments are stored on the company NAS and are not scanned for malware today.
  4. Internal notes are for staff only; do not copy them to a requester by other means.
  5. Do not forward reset or invitation e-mails.
  6. Report phishing, wrongly shown tickets and lost devices to the service desk or the information security lead.
  7. Staff are told that page-view and click events, sign-in activity and (where DeskTime is used) time and application data are recorded (notice wording to be approved by Legal).
- *Acknowledgement:* yearly and at joining (management to set).

### 2.4 Secure development policy

- **Exists in repo?** Partly. `CLAUDE.md` and `AGENTS.md` give working rules (read the framework docs first; run `tsc` and relevant tests; test only locally; explicit OK before push or deploy). Tools: Vitest (268 test files), `npm run lint`, `npm run typecheck`. No secure-coding standard, code review checklist, threat model, or CI (Inv. 6, class B/D/E).
- **Status:** Designed (partial). Tests exist and run by hand; remediation tests refuse any stack except the isolated audit stack (`vitest.remediation.config.ts`). **Not Operating with evidence**: no peer-review record (single author identity), no automated gate.
- **Related controls (PROVISIONAL):** A.8.25, A.8.26, A.8.27, A.8.28, A.8.29, A.8.31, A.8.33, A.5.8.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* build security into CKDesk code and database changes.
- *Scope:* application code (`app/`, `lib/`, `proxy.ts`), migrations, scripts, deployment bundles, dependencies.
- *Key rules specific to CKDesk:*
  1. Every server action and route handler checks the caller's role and ownership in code; the database repeats the rule with row-level security. Do not rely on screens hiding buttons.
  2. Any new table has row-level security and a policy before use; any new `SECURITY DEFINER` function sets a safe search path and revokes public execute.
  3. Never put client-supplied objects straight into a service-role write (use the field whitelist helper).
  4. Uploads: keep the allow-list, size cap and magic-byte check; add malware scanning (placeholder `VIRUS_SCAN_HOOK` exists).
  5. Every security fix has a test that fails before and passes after (the VAPT used `tests/vapt/*` that way).
  6. Type check, lint and the unit, integration and remediation suites must pass before a release (today by hand; automate in CI).
  7. Dependencies: lock file is committed; run `npm audit` before each release; critical advisories on production dependencies block release (management to set the response time).
  8. A second person reviews security-relevant changes (management to appoint; today none).
  9. Dev, test and production are separate; test data is synthetic; real data is not copied to the developer PC without approval (developer dumps exist there today).
  10. Secrets are never committed (`.env*` ignored; `.claude/settings.local.json` must not be committed).

### 2.5 Change management procedure

- **Exists in repo?** Yes, in prose: Runbook §4 (build, zip, copy, folder swap, verify `/api/health` and `/api/version`, rollback by renaming folders) and §5 (migration procedure with backup, `psql --single-transaction`, restart `CkDeskPostgrest`), `docs/POST-AUDIT-BATCH-2.md` (release order), `audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md`, rollback SQL in `supabase/rollback/` for 156-163, `scripts/windows/build-for-deploy.ps1` (build guards).
- **Status:** Designed. Release steps are scripted in part (B). Not shown operating: no release register, no tags, no named second approver, no emergency-change rule, no evidence a rollback was rehearsed. Application rollback never reverses a database change. (Inv. 5.)
- **Related controls (PROVISIONAL):** A.8.32, A.8.31, A.5.37, A.5.3, clause 6.3/8.1.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* make sure every change to production is approved, tested, recorded and reversible.
- *Scope:* application builds, migrations, service configuration, scheduled tasks, firewall rules, secrets, integrations.
- *Key rules specific to CKDesk:*
  1. Develop and test only on the dev PC or the disposable audit stack; never experiment on production.
  2. Standard change: code merged to `main` after the checks in the secure development policy; owner's explicit written OK; second reviewer for security-relevant changes (management to appoint).
  3. A release record is kept for every deployment: build id (`CK_BUILD_ID`), commit, date, who deployed, who approved, tests run, result, rollback point (name of the `standalone-bak-<timestamp>` folder).
  4. Database changes: backup first and verify it; run the migration in a single transaction; keep the rollback file; restart `CkDeskPostgrest` after; test on a copy first.
  5. Emergency change: allowed with verbal approval but a record is completed within one working day (management to set).
  6. After release verify `/api/health` and `/api/version`, then a manual smoke test; record the outcome.
  7. Touch only CKDesk's own folders/services on 10.0.1.98, the `ckdesk` database on 10.0.0.205 and `CKDESK_DATA` on the NAS.
  8. Never deploy to the retired server 10.0.1.12.

### 2.6 Backup and recovery procedure

- **Exists in repo?** In prose only: Runbook §2, §6 (nightly 02:30 `pg_dump -Fc` of `ckdesk` by task `CK_Backup_CKDESK` using `C:\ProgramData\CKBackup\backup-db.ps1` on 10.0.0.205, to `E:\DB BACKUP\CK_CKDESK_DBBACKUP`, 30 days kept, integrity check with `pg_restore --list`, role `ck_backup`); restore steps written; manual backup built into migration scripts (`supabase/production/run-ckdesk-migration-155.ps1`, `deploy-bundle-migrations-156-163/run-migrations.ps1`).
- **Status:** Designed. **The backup script is not in the repo; no backup log; no restore test on record; second copy outside 10.0.0.205 "Not done yet"; the dump does not contain `app.vault_key` or the vault rows; no backup of server configuration/secret files; NAS snapshot policy unknown.** (Inv. 9, class D/E.)
- **Related controls (PROVISIONAL):** A.8.13, A.5.29, A.5.30, A.8.14, A.7.10.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* be able to bring CKDesk back, with its data, after loss or damage.
- *Scope:* database `ckdesk`; vault key; server config (`.env.local`, `services\auth\.env`, `postgrest.conf`, `storage-src\.env`); NAS attachments; app folder; scheduled-task and NSSM settings.
- *Key rules specific to CKDesk:*
  1. Nightly database backup at 02:30, 30 days kept (as documented today); backup success is checked daily by a named person (until alerts exist).
  2. A second copy goes to a separate location on a separate share/device with a backup-only account (the owner's deferred proposal: 03:15 copy, about 90 days, snapshots).
  3. The vault key and server configuration files are backed up separately and protected (encrypted, restricted access, key escrow decided by management).
  4. Backup files are encrypted or protected by access control (management to decide).
  5. A restore test into a scratch database is done monthly (management to set), by someone other than the person who made the backup if possible; date, result and time taken are recorded.
  6. Recovery targets (RTO/RPO) are set by management; they are not defined today.
  7. Restore steps follow Runbook §6 (create database, `pg_restore`, set search path and a new `app.vault_key`, re-enter the mailbox password, restart the five `CkDesk*` services).

### 2.7 Incident management procedure

- **Exists in repo?** Not found as a general plan (Inv. 13). Partial: `WHATSAPP_PILOT_RUNBOOK.md` (daily checks, failure table, pause-and-preserve rollback, note on repeated `whatsapp_invalid_signature` rows) and Runbook §7 (server checklists). No security incident register.
- **Status:** Not implemented. Detection raw material exists: failed sign-ins, rate-limit hits, deactivated-login attempts, role changes and CSP reports are written to the System Log (B), but no alert routes them to anyone (E).
- **Related controls (PROVISIONAL):** A.5.24, A.5.25, A.5.26, A.5.27, A.5.28, A.6.8, A.5.5, A.5.6.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* detect, report, respond to and learn from security incidents.
- *Scope:* all CKDesk systems, data and users.
- *Key rules specific to CKDesk:*
  1. Report to the information security lead at once: suspected account takeover, a leaked approval link or code, a wrongly visible ticket, malware attachment, lost laptop, strange System Log rows, a server alarm.
  2. Severity levels (management to set; the 2026-06-14 UAT matrix uses Critical/High/Medium and fix times Critical before next cycle, High 24 hours, Medium before go-live, and treats security issues as Critical).
  3. First actions: preserve logs (System Log is append-only and hash-chained; run "Verify integrity"), deactivate affected accounts (which also bans sign-in), rotate any exposed secret (mailbox App Password, `CRON_SECRET`, OAuth and WhatsApp credentials, API keys), pause the affected channel (pause-and-preserve for WhatsApp).
  4. Evidence is copied before cleanup; nothing is deleted.
  5. Notification: who is told and when (staff, management, authorities, Meta/Google) is decided by management and Legal (not known from the repository).
  6. Every incident goes into one register with cause, action and lessons (see 2.20 and clause 10.2).
  7. A yearly exercise is held (none recorded to date).

### 2.8 Logging and monitoring procedure

- **Exists in repo?** The system is described: `docs/SYSTEM-LOG.md`; code and migration 160 (append-only table, hash chain, 45 audited business tables, error capture, shipper, retention 180 days for errors/events and 7 years for audit/security rows, archived not dropped). No procedure for who reviews it (Inv. 8).
- **Status:** Implemented (log writing; Tested at unit/integration level per Inv. 6); Not implemented (review, alerting, off-server copy). Whether migration 160 and the shipper task are live on production is Not verified (the inventory could not establish it from the repository).
- **Related controls (PROVISIONAL):** A.8.15, A.8.16, A.8.17, A.5.28, A.8.20.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* make sure the right events are recorded, protected and actually looked at.
- *Scope:* System Log, Event Log, Windows service logs (`logs\<Service>.out.log/.err.log`), PostgreSQL log, `backup.log`, firewall and server logs.
- *Key rules specific to CKDesk:*
  1. Admins and platform owners read the System Log (`security` and `critical` rows) at a set frequency (management to set; proposal weekly) and sign the review in a short record.
  2. Run "Verify integrity" at least monthly (management to set) and after any suspected tampering; keep the result.
  3. Set `TRUSTED_PROXY_HOPS` so source IP addresses are recorded.
  4. Run the log shipper on 10.0.0.205 so a failed backup becomes an alert row.
  5. Alerts (e-mail or message) for critical rows, failed backup, service down, burst of failed sign-ins (not in the repo today).
  6. Servers keep clocks synchronised (time source not stated in repository).
  7. Copy audit logs outside the database server (not done today).
  8. Staff are told about event monitoring (Legal to approve wording).

### 2.9 Vulnerability and patch management procedure

- **Exists in repo?** Not found. A one-off `npm audit` result was produced by this VAPT on 2026-10-15 (`vapt-2026-10/work/npm-audit*.json`): all dependencies 31 findings (1 low, 9 moderate, 17 high, 4 critical); production dependencies 9 findings (3 moderate, 5 high, 1 critical). The runbook records component versions at install time only (Inv. 7).
- **Status:** Not implemented. The Next.js upgrade 16.2.9 to 16.3.8 is **LOCAL, not deployed**; production still runs the vulnerable version (Class A before/after on production dependencies: 9 findings with 1 critical before, 2 moderate after, per the status table).
- **Related controls (PROVISIONAL):** A.8.8, A.8.9, A.5.7, A.8.19, A.8.29.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* find and fix technical weaknesses before attackers use them.
- *Scope:* Node packages; Next.js; Node.js runtime on 10.0.1.98; Windows Server updates; PostgreSQL 18; PostgREST; GoTrue (built from source with a Windows patch); Storage service; NSSM; NAS firmware; router.
- *Key rules specific to CKDesk:*
  1. `npm audit` before each release and at least monthly (management to set); keep the output.
  2. Production-dependency critical and high advisories are patched within times set by management (proposal: critical 7 days, high 30 days; management to decide).
  3. Keep an inventory of component versions in use on 98, 205 and the NAS (Node version on 98 is unknown from the repository).
  4. Monthly patch window for operating systems; record dates.
  5. An independent vulnerability scan and a penetration test are done yearly or after major change (none exists beyond this internal VAPT).
  6. Subscribe to advisories for Next.js, Node, PostgreSQL, Windows.
  7. A residual advisory without a fix (for example `uuid` via `exceljs`) is accepted in writing with a reason and a review date.

### 2.10 Supplier management procedure

- **Exists in repo?** Not found. The repo shows what each supplier receives (Inv. 12) but not contracts, DPAs, supplier risk review or exit plans.
- **Status:** Not implemented. **Class:** E.
- **Related controls (PROVISIONAL):** A.5.19, A.5.20, A.5.21, A.5.22, A.5.23, A.5.31, A.5.34.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* keep supplier risk under control.
- *Scope:* Google Workspace/Gmail, Microsoft (Outlook/Graph), Meta (WhatsApp Cloud API), DeskTime, optional LLM provider (Groq), optional Resend, GitHub, browser push services, Synology, ISP.
- *Key rules specific to CKDesk:*
  1. A register of suppliers with owner, data sent, contract/terms, DPA, certification status and review date.
  2. No new outside service that receives staff or ticket data (for example a model provider for the planned CK Desk Bot) without a supplier review and management approval.
  3. Credentials per supplier have a named holder and a rotation rule: mailbox App Password, WhatsApp token, DeskTime API key (currently sent as a URL parameter), Groq key if used.
  4. Know where each supplier is allowed to process data (location).
  5. An exit/alternative plan for the mailbox (single shared Gmail mailbox is a single point of failure).
  6. Review yearly (management to set).

### 2.11 Data classification and retention policy

- **Exists in repo?** Not found. No classification labels; confidentiality tier for HR/Finance teams is open decision D-005. Retention: System Log and Event Log retention is coded (`lib/syslog/retention.ts`); the older `retention_policies` table (requests/tasks 5 years, audit log 7 years, notifications 90 days, attachments 5 years) is editable but **no job enforces it**. No anonymisation or deletion function for users or tickets; only deactivation (Inv. 11).
- **Status:** Not implemented (log retention Implemented).
- **Related controls (PROVISIONAL):** A.5.12, A.5.13, A.5.33, A.5.34, A.8.10, A.8.11, A.8.12.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* decide how sensitive information is labelled, protected, kept and deleted.
- *Scope:* tickets, comments, attachments, staff profile data, mailbox and WhatsApp content, DeskTime data, logs, backups.
- *Key rules specific to CKDesk:*
  1. Three tiers proposed: Restricted, Internal, Public (management to adopt or change).
  2. Restricted includes HR and Finance tickets, secrets, backups, audit rows. Decision D-005 (a "restricted team" flag) is the technical route and needs management approval.
  3. Retention schedule per data type (management and Legal to set): tickets and attachments (the table says 5 years, not enforced), e-mail copies, WhatsApp events, DeskTime data, Event Log (90 days today), System Log (errors 180 days, audit 7 years, archived).
  4. Deletion and anonymisation procedure for leavers and for requests under data-protection law (does not exist).
  5. Exports (CSV/PDF/Excel) of Restricted data need approval; they are logged for users and system log.
  6. Staff mobile numbers are visible only to staff and the owner of the number (M164 fix is LOCAL, not deployed).

### 2.12 Cryptography and key management policy

- **Exists in repo?** Partly in prose: Runbook §3 (secrets locations, vault key, JWT secret shared by services), `docs/WINDOWS-DEPLOYMENT.md` ("Rotating the key later"), `deploy/windows/mint-keys.js`, `deploy/windows/postgres-extensions/set-vault-key.sql`.
- **Status:** Designed (partial). Facts: stored secrets are encrypted with pgcrypto through a vault shim; vault key is a database setting not included in dumps, no rotation or escrow procedure; anon and service-role keys have 10-year expiry; one JWT secret is shared by Auth, PostgREST, Storage and the proxy and also used to sign the verified-user header; `CRON_SECRET` is a fallback for several purposes (VA-API-05, open); the app and public site use plain HTTP (VA-API-01, requires decision); encryption of disks, DB link, SMB and backups is not stated (Inv. 3, 11).
- **Related controls (PROVISIONAL):** A.8.24, A.5.17, A.8.5, A.8.20, A.8.21, A.5.14.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* use encryption properly and manage keys over their life.
- *Scope:* TLS, vault, JWT and signing keys, API keys, `.env` secrets, backups, disks, NAS shares, e-mail transport.
- *Key rules specific to CKDesk:*
  1. All user traffic uses HTTPS once a certificate and DNS name are in place; cookies are `Secure`; HSTS and an enforced CSP follow (decision pending).
  2. Database link between 98 and 205, SMB to the NAS, and backups use encryption where supported (to be confirmed).
  3. The vault key is generated once, backed up separately, and rotated on a schedule with a written rotation procedure.
  4. Separate secrets for separate purposes (dedicated `CRON_SECRET`, approval link secret, OAuth state secret).
  5. Key lifetimes: shorter than 10 years for service keys (management to set); rotation after any suspected exposure.
  6. No secret in source control, tickets or chat; secrets live only in the protected files on the servers.
  7. Custody list: who holds the vault key, JWT secret, `postgres` password, mailbox App Password.

### 2.13 Business continuity plan

- **Exists in repo?** Not found. Single points of failure are described (one app server, one database server, one NAS, one router NAT, one shared mailbox; Inv. 10) but no continuity or disaster-recovery plan, RTO/RPO, DR site or exercise.
- **Status:** Not implemented. **Class:** E. Capacity was not verified at target scale in the 2026-09-17 acceptance report (55.4% failure rate at the test load at the time); later performance work exists.
- **Related controls (PROVISIONAL):** A.5.29, A.5.30, A.8.14, A.7.11.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* keep critical service-desk functions going or restore them quickly.
- *Scope:* CKDesk services on 10.0.1.98, database 10.0.0.205, NAS, network, mailbox.
- *Key rules specific to CKDesk:*
  1. Management states how long CKDesk can be down (RTO) and how much data it can lose (RPO).
  2. Manual fallback while CKDesk is down: shared mailbox/phone numbers for urgent IT and HR requests; instructions to staff.
  3. Recovery order after outage: database, auth, PostgREST, storage, proxy, app (Runbook §7 start order); health checks.
  4. Reboot test of 10.0.1.98 (open item) and a full restore exercise at least yearly.
  5. Contact list for server, network, NAS and supplier support.
  6. Review after every major outage.

### 2.14 HR security procedure

- **Exists in repo?** Not found; not expected in a code repository (Inv. 15). Outside the repo only HR can supply it.
- **Status:** Not verified. **Class:** E.
- **Related controls (PROVISIONAL):** A.6.1, A.6.2, A.6.3, A.6.4, A.6.5, A.6.6.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* make sure people are suitable, understand their duties and leave cleanly.
- *Scope:* employees, contractors and developers who use or run CKDesk.
- *Key rules specific to CKDesk:*
  1. Screening before granting administrator, database or server access (management to set depth).
  2. Employment terms and confidentiality agreements include information security duties.
  3. Awareness briefing at joining and yearly; extra briefing for administrators and platform owners.
  4. Disciplinary process for deliberate misuse.
  5. Leaver trigger: HR tells the service desk on the last working day (or earlier); accounts are deactivated, server keys and secrets rotated if the person had them.
  6. Role change triggers an access review.

### 2.15 Physical security policy

- **Exists in repo?** Not found. The repo names IP addresses only; the location and access of the servers, NAS and backup disks are not stated (Inv. 14).
- **Status:** Not verified. **Class:** E.
- **Related controls (PROVISIONAL):** A.7.1, A.7.2, A.7.3, A.7.4, A.7.5, A.7.8, A.7.9, A.7.10, A.7.11, A.7.12, A.7.13, A.7.14.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* protect the equipment and information from physical harm or access.
- *Scope:* room(s) holding 10.0.1.98, 10.0.0.205, NAS 10.0.0.25 and backup disks; dev PC 10.0.0.47; admin PC with the ssh key; retired server 10.0.1.12.
- *Key rules specific to CKDesk:*
  1. Servers and NAS are in a locked room; access list kept; visitor log.
  2. UPS, cooling, fire protection are present and tested (facts to be supplied).
  3. Backup disks are not in the same enclosure as the primary data; a copy is kept elsewhere.
  4. The dev PC and admin PC use disk encryption, screen lock and endpoint protection.
  5. Retired server 10.0.1.12 and old disks are wiped or destroyed before disposal; records kept.

### 2.16 Remote work and mobile device policy

- **Exists in repo?** Not found. The system is reachable from the internet by browser, so staff can use it from outside; the app also sends Web Push notifications to browsers. There is no rule on devices (Inv. 14, 15).
- **Status:** Not implemented. **Class:** E.
- **Related controls (PROVISIONAL):** A.6.7, A.8.1, A.7.9, A.5.10.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* keep information safe when used outside company premises or on mobile devices.
- *Scope:* anyone using CKDesk from home, stores or personal devices; push notification subscribers; WhatsApp users.
- *Key rules specific to CKDesk:*
  1. Use CKDesk only over HTTPS once available; do not use public computers for administrator functions.
  2. Devices used by administrators and technicians are screen-locked, patched and protected; lost devices are reported at once.
  3. Personal devices: management decides whether they are allowed and which data may be on them.
  4. Browser push notifications show titles only (management to confirm).
  5. WhatsApp messages to the helpdesk number must not contain secrets.

### 2.17 Risk management methodology

- **Exists in repo?** Not found (Inv. 1). Defect severity levels from audits are not a risk method.
- **Status:** Not implemented. **Class:** E.
- **Related controls (PROVISIONAL):** clauses 6.1.2, 6.1.3, 8.2, 8.3; A.5.1.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* describe how risks are found, rated, accepted or treated.
- *Scope:* all assets in the ISMS scope.
- *Key rules specific to CKDesk:*
  1. Asset list: application, services, hosts, NAS, data stores, integrations, people roles, with an owner each.
  2. Scoring: likelihood and impact on a 1-5 scale; risk acceptance level set by management (management to set).
  3. Each risk has an owner who decides to treat, accept, avoid or transfer. Open decisions D-005, D-011, D-018/D-037, D-036, the single backup copy and a single approver for change must each be assessed and decided.
  4. Risk assessment: before go-live of new channels or integrations, at major change, and yearly.
  5. Treatment plan feeds the Statement of Applicability for the 93 Annex A controls.

### 2.18 Internal audit procedure

- **Exists in repo?** Not found. A proposal is in `ISO27001-INTERNAL-AUDIT-READINESS.md`.
- **Status:** Not implemented.
- **Related controls (PROVISIONAL):** clause 9.2; A.5.35, A.5.36.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* check regularly and independently that the ISMS works.
- *Scope:* whole ISMS, by area, over a yearly cycle.
- *Key rules specific to CKDesk:*
  1. The auditor is independent: the developer or the person who runs a control does not audit it.
  2. Sampling of records is described in the audit programme; results go to management.
  3. Findings enter the nonconformity register with owner and due date.
  4. Follow-up audits check closure.

### 2.19 Management review procedure

- **Exists in repo?** Not found. A pack is in `ISO27001-MANAGEMENT-REVIEW-READINESS.md`.
- **Status:** Not implemented. **No review has been held.**
- **Related controls (PROVISIONAL):** clause 9.3; A.5.4.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* top management checks the ISMS is suitable, adequate, effective and decides improvements.
- *Scope:* whole ISMS.
- *Key rules specific to CKDesk:*
  1. At least yearly, and after a serious incident or major change (management to set).
  2. Standard inputs as listed in the readiness pack; signed minutes with decisions and owners.
  3. Decisions are tracked to closure in the next review.

### 2.20 Document control procedure

- **Exists in repo?** Not found. Git history gives versions; documents have no owner, approval or review date; stale documents are mixed with current ones (Inv. "Reliability of the documents").
- **Status:** Not implemented.
- **Related controls (PROVISIONAL):** clause 7.5; A.5.37.

**DRAFT — not approved. Owner: to be assigned by management.**
- *Purpose:* make sure people use current, approved documents.
- *Scope:* ISMS policies, procedures, records, runbooks and the `docs/` folder.
- *Key rules specific to CKDesk:*
  1. A register lists each controlled document: name, owner, version, approval date, review date, classification.
  2. `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` is the current operations source of truth; documents about 10.0.1.12 or Railway are marked "history".
  3. Approved policies live in a read-only place visible to all staff; edits require a change note.
  4. Records (reviews, audits, access reviews, restore tests, release records) are kept for a set time (management to set) and cannot be altered afterwards.

---

## 3. Suggested order of writing

1. Information security policy (2.1), risk methodology (2.17), document control (2.20).
2. Access control (2.2), change management (2.5), backup and recovery (2.6), incident management (2.7), because the technical gaps behind them are the largest.
3. Logging (2.8), vulnerability (2.9), cryptography (2.12), supplier (2.10).
4. Classification and retention (2.11), acceptable use (2.3), secure development (2.4).
5. HR, physical, remote work, business continuity (2.13-2.16), then audit and review procedures (2.18, 2.19).

---

## Open questions / evidence requests for management

1. Does Citykart already have group-level policies (information security, acceptable use, HR, physical, business continuity) that CKDesk could adopt? Supply approved copies with dates and approvers (Class C).
2. Name the owner for each of the 20 policies and the approver (top-management sponsor).
3. Supply or confirm the absence of: HR screening and confidentiality terms, leaver procedure, training records.
4. Supply the backup script `backup-db.ps1`, the last 30 days of `backup.log`, and any restore-test record; confirm the off-server copy decision.
5. Supply facility facts (location, access, power, cooling) for the servers and NAS.
6. State recovery targets (RTO/RPO) and acceptable downtime.
7. Decide data classes, retention periods and the D-005 confidentiality approach.
8. Supply supplier contracts and data-processing terms.
9. Supply any incident or outage records outside the repository.
10. Decide who approves production change besides the project owner, and who reviews security-relevant code.
