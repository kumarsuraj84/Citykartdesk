# SOC 2 Type II Control Operation Plan - CKDesk

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

A SOC 2 **Type II** examination checks whether a control was **actually carried out, on time, by the right person, over a period of time** (an "examination period"). A written policy is not enough, and neither is a feature that exists in the software. The auditor asks for proof that it happened, for a sample of dates inside the period. This plan says, for each control a Type II would test, who should do it (as a role, not a name), how often, the steps, what proof to keep, and how to keep it.

Ground rules used throughout:

- **Nothing here has been done yet.** No control in this plan has operated and no evidence has been collected. Nothing may be created later and dated earlier, and no history is claimed.
- Owner roles are placeholders: **Owner: to be assigned by management** (see SOC2-CONTROL-OWNER-MATRIX.md). Frequencies, retention and time targets are **PROVISIONAL** proposals for management and the auditor to confirm.
- Mapping of controls to SOC 2 Trust Services Criteria (CC1-CC9, A1, C1, PI1, P1-P8) is **PROVISIONAL — confirm against the licensed standard**. Only the independent CPA firm can issue a Type I or Type II report; this document is not one and claims none.
- Facts about CKDesk come from the repository (class B/D). "Production runs build 20261015-145217 (main 717e5c6)". Fixes made during this assessment are **LOCAL and not deployed**.
- Evidence IDs (EV-Cnn-nn) refer to SOC2-EVIDENCE-REGISTER.md. Test methods are in SOC2-OPERATING-EFFECTIVENESS-TEST-PLAN.md. Dates are in SOC2-EVIDENCE-COLLECTION-CALENDAR.md. Exceptions are in SOC2-EXCEPTION-REGISTER.md.
- "Build work" notes are **recommendations only**. No code is written or changed by this document.

## Common rules for every control

| Topic | Rule (PROVISIONAL) |
|---|---|
| Evidence store | One read-only, access-controlled folder (for example a restricted share) with one sub-folder per control (C01 to C16) and per month. Only the Compliance Coordinator and the Independent Reviewer can add or delete. Folder access list is itself evidence. |
| File naming | \<control\>_\<what\>_\<YYYY-MM-DD of real collection\>_\<collector initials\>. The date is the real day of collection. |
| What counts as a record | A dated export, screenshot, log extract or signed form that shows who, what, when. Screenshots need the visible date/time and the screen title. No secrets, passwords or keys in evidence (write "value hidden"). No personal data beyond what the control needs (user names and roles are needed for access reviews; ticket text is not). |
| Second-person check | Each periodic control has a reviewer who is not the person who performed it. One person doing and checking is recorded as an exception. |
| Missed run | If a periodic control is not done on time, do not do it late and pretend; record an exception (EX-nnn) with the real dates, then do it. |
| Retention | Examination period plus 3 years (RET-A) unless stated. |
| Escalation | Two missed runs of any control, or any High exception open more than 30 days, go to the Executive Sponsor (PROVISIONAL). |

## Control index

| ID | Control | Likely criteria (PROVISIONAL) | Frequency | Owner role (placeholder) | Automation level today |
|---|---|---|---|---|---|
| C01 | Access provisioning and deprovisioning | CC6.2, CC6.3 | Per event; monthly reconciliation | IT Operations Lead | Partly from app (System Log rows); approval record needs process/build |
| C02 | Quarterly access review | CC6.2, CC6.3 | Quarterly | Application Owner | Raw data from app (Users export); review pack needs build |
| C03 | Privileged access review | CC6.1, CC6.3 | Quarterly; monthly log check | Information Security Lead | Partly from app; server access outside app |
| C04 | Change management with approvals | CC8.1 | Per release; monthly reconciliation | Development Lead | Git only; release register and CI need build |
| C05 | Vulnerability scanning and remediation | CC7.1 | Monthly; per finding | Information Security Lead | Manual (npm audit); tracker and scanner need build |
| C06 | Patching | CC7.1, CC8.1 | Monthly; per advisory | IT Operations Lead | Manual |
| C07 | Backups and restore tests | A1.2, A1.3 | Daily job; monthly check; quarterly restore | Database Administrator | Backup task exists on server; restore test and alerts need build/process |
| C08 | Incident response | CC7.3, CC7.4, CC7.5 | Per incident; monthly review; annual exercise | Information Security Lead | Detection rows from app; alerting needs build |
| C09 | Security monitoring and log review | CC7.2 | Weekly; monthly | Information Security Lead | System Log from app; review record and alerts need build |
| C10 | Vendor reviews | CC9.2 | Annual; on new supplier | Vendor Relationship Owner | Manual |
| C11 | Business continuity test | A1.3, CC9.1 | Annual | Executive Sponsor / IT Operations Lead | Manual |
| C12 | Security awareness | CC1.4, CC2.2 | Annual; per joiner | HR Lead | Manual |
| C13 | Risk assessment refresh | CC3.1 to CC3.4 | Annual; on significant change | Information Security Lead | Manual |
| C14 | Policy review | CC1.x, CC2.x, CC5.3 (PROVISIONAL) | Annual | Executive Sponsor | Manual |
| C15 | Key and secret rotation | CC6.1, CC6.7 | At least annual; on staff change | IT Operations Lead | Manual |
| C16 | Penetration test | CC4.1, CC7.1 | Annual; after major change | Information Security Lead | VAPT suite is repeatable; independent test is external |

CKDesk screens and artefacts used in the procedures below:

- **Logs screen** (`/admin/logs`): tab **System Log** with views *All records* and *Ticket and task activity* (the old Audit Log address `/admin/audit` redirects here); tab **Event Log** (page views and clicks, kept 90 days by default); **Verify integrity** button (hash-chain check, function `system_log_verify_chain()`); admin and platform owner can see all, a manager sees only ticket and task activity.
- **Users screen** (`/admin/users`): invite, bulk CSV import, role change, activate/deactivate, set temporary password, **CSV export** (audited as `user.export_csv`).
- **Platform Settings > Retention**: System Log and Event Log retention values.
- **System Log action names written by the application today** (class B, verified in source): `user.invited`, `user.bulk_imported`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `user.password_set_by_admin`, `bulk_password_reset`, `user.export_csv`, `user.mobile_added`, `user.mobile_removed`, `user.teams_set`, `auth.login_blocked_deactivated`. Whether the System Log (migration 160) is live on 10.0.0.205 is **Not verified**; the `auth.schema_migrations` table on that server must be read to confirm.
- **Scripts in the repo**: `scripts/windows/build-for-deploy.ps1`, `install-cron-tasks.ps1`, `run-cron-tick.ps1`, `run-log-shipper.ps1`, `add-approval-reminder-task.ps1`; `scripts/log-shipper.mjs`; `deploy-bundle-migrations-156-163/run-migrations.ps1`; `supabase/production/run-ckdesk-migration-155.ps1`; `supabase/rollback/*`; `audit-2026-10/guard/run.ps1` (isolated audit stack runner).
- **Production runbook**: `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` section 4 (deploy and rollback), 5 (migrations), 6 (backups and restore), 7 (operations checklists), 10 (open items).
- **VAPT suite**: `tests/vapt/10-confidentiality-exploits.test.ts`, `11-integrity-exploits.test.ts`, `12-email-reply-participant.test.ts` with `vitest.vapt.config.ts` (present in the working tree and not committed at the time of writing; runs only on the isolated audit stack).

---

## C01 Access provisioning and deprovisioning

**Purpose:** Only approved people get accounts; leavers lose access quickly.
**Owner role:** IT Operations Lead (backup: Application Owner). **Frequency:** every account event; reconciliation monthly.

**Procedure steps (CKDesk specific)**
1. HR or the line manager sends a written request (joiner, role change, leaver) that names the person, role, teams and approver. *(No such step exists today; this is a new process.)*
2. An admin or platform owner creates the account in the Users screen (`inviteUser`, or CSV `bulkCreateUsers`). Only a platform owner may grant `admin` or `platform_owner` (enforced in code).
3. For bulk import, do not use the documented default initial password; use invitation e-mails or random one-time passwords once management decides (open decision D-011). Check that `must_reset_password` is set.
4. For leavers: the HR list is received on the agreed schedule; an admin deactivates the user (sets `is_active=false` and bans sign-in). A platform owner is needed for admin or platform-owner accounts.
5. Monthly: the control owner exports System Log rows (`user.invited`, `user.bulk_imported`, `user.role_changed`, `user.deactivated`, `user.reactivated`) and reconciles each one to a request record; and the HR leaver list to deactivation dates (days between last working day and deactivation; proposed target: same working day for leavers, PROVISIONAL).
6. Record every difference as an exception.

**Required evidence:** EV-C01-01 to EV-C01-09 (procedure, request/approval, System Log rows, HR leaver list, timeliness reconciliation, initial-password report, sign-up switch evidence).
**How to collect:** System Log export filtered by action and date; request e-mails/tickets saved to the evidence folder; reconciliation spreadsheet signed by a reviewer.
**Retention:** RET-A (System Log audit/security rows stay 7 years in the application by configuration).
**Review and approval:** Information Security Lead reviews the monthly reconciliation and signs.
**Exception handling:** Account without request, role without approval, leaver not removed in time, or a default-password account found: exception entry the same day; fix; look for the cause.
**Escalation:** Account of an admin/platform owner without approval, or a leaver with active access for more than 5 working days (PROVISIONAL) goes to the Executive Sponsor.
**Automation:** *From the application today:* the System Log records the events; the Users screen enforces who may grant which role. *Needs build (recommendation only):* an approval step before account creation (request recorded with approver); a report listing users created without an approved request; auto-deactivate on a leaver feed from HR or Google Workspace (a deferred idea outside the repo).

## C02 Quarterly access review

**Purpose:** Every account and role is confirmed as still needed, each quarter.
**Owner role:** Application Owner (backup: Information Security Lead). **Frequency:** quarterly.

**Procedure steps**
1. On the first working day of the quarter, the owner exports all users from the Users screen (CSV: role, active flag, team). The export writes `user.export_csv` to the System Log; keep a screenshot or export of that row as proof of date.
2. Record the number of users shown on screen and the number of rows in the file (completeness check).
3. Split the file by team or manager; send each line manager their people with a Keep / Change / Remove column. Include technicians and managers. Give a deadline (PROVISIONAL: 10 working days).
4. Collect answers; chase non-responders; the Application Owner reviews the overall result.
5. An admin carries out each Change/Remove through the Users screen; save the System Log rows (`user.role_changed`, `user.deactivated`) against each decision.
6. The Independent Reviewer checks that every Change/Remove has a matching log row and signs.

**Required evidence:** EV-C02-01 to EV-C02-06. **Retention:** RET-A.
**Review and approval:** Information Security Lead signs the completed review; Executive Sponsor sees the summary.
**Exception handling:** Late or missing manager answers, users that nobody claims, or changes not done within 10 working days: exception entry; unclaimed accounts are deactivated (never deleted; CKDesk has no delete function) until claimed.
**Escalation:** Review not started within 10 working days of quarter start, or any admin/platform-owner account without a confirmation: Executive Sponsor.
**Automation:** *From the application today:* the full-user CSV export and its audit row. *Needs build (recommendation only):* an "access review" screen that creates a dated snapshot, lets each manager mark Keep/Change/Remove, shows last sign-in date (if available), records the reviewer and date, and prints a signed summary; flags users with no sign-in for a set time.

## C03 Privileged access review

**Purpose:** The few people who can change anything (platform owners, admins, server and database keys) are known, justified and checked.
**Owner role:** Information Security Lead (backup: Executive Sponsor). **Frequency:** quarterly review; monthly check of privileged actions.

**Procedure steps**
1. List all privileged holders: `platform_owner` and `admin` users (Users screen filter), managers who can reach `/admin/*`, holders of the SSH key for the shared Administrator account on 10.0.1.98 and 10.0.0.205, holders of the `postgres` password and the `service_role` key, and NAS administrators. Write a business reason next to each.
2. DBA runs a read-only database role listing on 10.0.0.205 (roles `citykart_desk_app`, `ck_backup`, `service_role`, attributes such as BYPASSRLS) and attaches the result.
3. A person who is not on the list (Executive Sponsor) reviews and signs.
4. Monthly: filter the System Log (security category) for `user.role_changed` to admin/platform_owner, `user.password_set_by_admin`, `bulk_password_reset`, and deactivation of privileged users; confirm each had an approved request.
5. When a privileged person leaves: remove their account; replace the SSH key if they held it; change the shared passwords or tokens they knew; log the rotation (links to C15).

**Required evidence:** EV-C03-01 to EV-C03-07. **Retention:** RET-A.
**Exception handling:** Shared Administrator account (EX-006) stays a standing exception until individual accounts or keys exist. Any privileged change without approval is a new exception.
**Escalation:** Unknown privileged holder found: Executive Sponsor within 1 working day (PROVISIONAL).
**Automation:** *From the application today:* role-change audit rows. *Needs build (recommendation only):* a privileged-user report with last activity; time-limited elevation (admin role with an end date); server-side logon auditing is outside the application (Windows configuration).

## C04 Change management with approvals

**Purpose:** Only tested, approved changes reach production and each can be traced and reversed.
**Owner role:** Development Lead (backup: Application Owner). **Frequency:** every release and migration; monthly reconciliation.

**Procedure steps (follows runbook section 4 and 5, with added records)**
1. Open a release entry in the release register (to be created): purpose, git commit, risk, rollback plan, planned time.
2. Run `npx tsc --noEmit`, `npm run lint`, `npm test`; save the console output to the evidence folder with the commit id. For security-relevant changes, also run the VAPT suite on the isolated audit stack (`audit-2026-10/guard/run.ps1`) and save the summary.
3. Obtain the recorded approval from the Application Owner (or deputy) who is not the developer. Today the approval is the project owner's explicit OK given in conversation; it must be put in writing (e-mail or ticket) and linked to the entry.
4. Commit and push `origin main`; build with `scripts\windows\build-for-deploy.ps1` (stamps the build id); copy to 10.0.1.98; stop `CkDeskApp`; rename `app\standalone` to `app\standalone-bak-<timestamp>`; expand the new build; restore `.env.local`; start the service.
5. Verify `/api/health` returns `{"status":"ok","db":"ok"}` and `/api/version` shows the new build id; paste both results into the entry with the time.
6. Database changes: take a backup first (`CK_Backup_CKDESK` or manual `pg_dump -Fc`), run the migration on 10.0.0.205 with `run-migrations.ps1` or `psql --single-transaction`, save the output and the `auth.schema_migrations` extract, restart `CkDeskPostgrest`.
7. Rollback is done by folder swap for the application; it never reverses a database change (use the matching file in `supabase/rollback/` only where one exists; none exist for migrations before 156).
8. Monthly: compare the build id running on 10.0.1.98 with the register and with `git log`; every running release must have an approved entry.

**Required evidence:** EV-C04-01 to EV-C04-12. **Retention:** RET-A (git history is permanent).
**Review and approval:** Application Owner approves each release; Information Security Lead reconciles monthly.
**Exception handling:** Emergency change: allowed with after-the-event approval within 2 working days (PROVISIONAL), marked Emergency in the register. A release with no entry is an exception.
**Escalation:** Unapproved production change or hidden deploy: Executive Sponsor immediately.
**Automation:** *From the application today:* `/api/version` build id; git history. *Needs build (recommendation only):* CI that runs typecheck, lint, tests and `npm audit` for every push and stores logs; branch protection with required review; a release-register table in CKDesk itself fed by the build script; accurate commit messages (some commits on main say "LOCAL TRIAL (not merged)").

## C05 Vulnerability scanning and remediation

**Purpose:** Weaknesses are found regularly and fixed within agreed times, with proof.
**Owner role:** Information Security Lead (backup: Development Lead). **Frequency:** monthly dependency scan; quarterly server scan; per finding tracking.

**Procedure steps**
1. Monthly: run `npm audit --json` and `npm audit --omit=dev --json` on the current commit; save both files with the commit id and date. (A one-off pair from 2026-10-15 exists; it is not a standing record.)
2. Quarterly: scan 10.0.1.98, 10.0.0.205 and the NAS with an approved scanner (to be chosen; none was available in this assessment).
3. Enter every finding in the tracker with severity, owner, due date. Proposed time targets (PROVISIONAL): Critical 7 days, High 30 days, Medium 90 days, Low next planned release.
4. Fix through the change process (C04). Prove closure: re-run the scan or the exploit test (VAPT suite on the audit stack) and save the output.
5. Findings not fixed in time need a signed risk acceptance with an end date.
6. Monthly 30-minute review with minutes.

**Required evidence:** EV-C05-01 to EV-C05-08. **Retention:** RET-A.
**Exception handling:** SLA missed: exception entry; risk acceptance or a revised date approved by the Executive Sponsor.
**Escalation:** Any Critical open beyond 7 days: Executive Sponsor.
**Automation:** *From the application today:* none. *Needs build (recommendation only):* scheduled dependency scan in CI with results stored; a findings tracker (could be a CKDesk request category with SLA).
*Current honest state:* production dependency criticals are present in production today (EX-012); the fix is LOCAL and not deployed.

## C06 Patching

**Purpose:** Operating system, database, runtime and dependencies are kept current.
**Owner role:** IT Operations Lead (backup: Database Administrator). **Frequency:** monthly cycle; urgent advisories as they come.

**Procedure steps**
1. Monthly: record versions in use (Windows build, PostgreSQL 18.x, Node, NSSM, GoTrue, PostgREST, Storage) for 10.0.1.98 and 10.0.0.205; DSM version for the NAS. The runbook only records install-time versions.
2. Export Windows Update history for both servers.
3. Read advisories for Next.js, React, PostgreSQL, Windows and Synology; note which apply.
4. Plan and test each patch (on the audit stack for application dependencies; on a test host where possible); deploy through C04 in a maintenance window; verify health afterwards.
5. If a patch is deferred, log an exception with reason and end date.

**Required evidence:** EV-C06-01 to EV-C06-08. **Retention:** RET-A.
**Review and approval:** Information Security Lead reviews the monthly version table.
**Escalation:** Critical patch not applied within 14 days (PROVISIONAL): Executive Sponsor.
**Automation:** *From the application today:* none (git history shows dependency changes). *Needs build (recommendation only):* automatic version collection script to a dated report; dependency update bot.

## C07 Backups and restore tests

**Purpose:** Data can be recovered after loss; this is proven, not assumed.
**Owner role:** Database Administrator (backup: IT Operations Lead). **Frequency:** nightly job; monthly log check; quarterly restore test (the runbook proposes monthly).

**Procedure steps**
1. Nightly 02:30 the task `CK_Backup_CKDESK` on 10.0.0.205 takes `pg_dump -Fc`, checks with `pg_restore --list`, keeps 30 days, logs OK/FAILED in `backup.log`. The script is not in the repository; copy it (without secrets) and its hash into the evidence folder.
2. Monthly: copy `backup.log` and a listing of the backup folder; the reviewer confirms there is one OK line per night and files for the last 30 days.
3. Quarterly restore test: restore the newest dump into a scratch database (never into production) following runbook section 6, including setting `search_path`, creating a new `app.vault_key`, and re-entering the mailbox password; start the application against it; compare row counts for key tables (requests, profiles, system log) with the source; record the time taken. A witness signs.
4. Attachments: take the NAS snapshot list; pick one old attachment and prove it opens.
5. Second copy outside 10.0.0.205: build per the runbook proposal, then record its daily log and a monthly check.
6. Failed backup alert: wire the log shipper on 10.0.0.205 so `backup.failed` becomes a critical System Log row, then test with a safe simulated failure.

**Required evidence:** EV-C07-01 to EV-C07-12. **Retention:** RET-A.
**Exception handling:** A missed or failed backup: record it, run a manual `pg_dump` the same day, log the cause. A failed restore test is the most important exception to record and fix.
**Escalation:** Two consecutive failed or missing nightly backups, or any failed restore test: Executive Sponsor the same day.
**Automation:** *From the application today:* the shipper has a parser for `backup.log` (needs wiring on 205). *Needs build (recommendation only):* off-server copy job; backup of settings/vault row; a restore-test script that produces a result file; a "backup status" tile in CKDesk monitoring fed by the log.

## C08 Incident response

**Purpose:** Security incidents are detected, handled, communicated and learned from.
**Owner role:** Information Security Lead (backup: Executive Sponsor). **Frequency:** per incident; monthly review; annual exercise.

**Procedure steps**
1. Approve the plan: what is an incident (examples: repeated `whatsapp_invalid_signature` rows, forged CSP-report floods, unexplained role changes, data sent to wrong person, lost device with keys), severity levels, roles, contact tree, who may switch services off, evidence handling, legal notification duties.
2. Keep the incident register, even when empty.
3. For each incident record: time found, source (System Log row, user report, supplier notice), severity, containment, cause, recovery, communications, closure date, review.
4. Monthly: review System Log security rows (failed sign-ins, blocked logins, invalid signatures, CSP violations, rate-limit hits) and sign the "no incidents / these incidents" statement.
5. Annual exercise: tabletop on a realistic CKDesk scenario (for example, leaked service-role key or lost administration PC). Record actions.

**Required evidence:** EV-C08-01 to EV-C08-09. **Retention:** RET-A.
**Exception handling:** Incident not logged within one working day or review not done: exception entry.
**Escalation:** High severity or any suspected data leak: Executive Sponsor immediately; legal/regulator duties per management's register.
**Automation:** *From the application today:* detection rows in the System Log. *Needs build (recommendation only):* alert routing from critical System Log rows to e-mail or chat; an incident request type in CKDesk with a timeline.

## C09 Security monitoring and log review

**Purpose:** Someone looks at the logs on a schedule and acts on what they see.
**Owner role:** Information Security Lead (backup: Application Owner). **Frequency:** weekly review; monthly integrity check and export.

**Procedure steps**
1. Weekly: open Logs > System Log. Look at filters for category *security* and *error* for the week; check failed sign-ins, blocked logins, role changes, password sets by admin, export events, scheduled-job failures, backup and shipper rows. Record the review (date, filters, findings, actions) in the review log.
2. Monthly: press **Verify integrity**; save the result. Export audit and security rows for the month (the export is itself logged).
3. Monthly: on 10.0.1.98 prove the task `CitykartDesk-LogShipper` is registered and its last result is 0; check that Platform Settings > Retention values match policy (System Log errors 180 days default, audit/security 7 years, Event Log 90 days).
4. Quarterly: export Windows event log samples, firewall log and NTP settings for the servers.
5. Wire the log shipper on 10.0.0.205 for PostgreSQL and `backup.log`; copy audit rows off the database server on a schedule (both are not done today).
6. Second person signs the monthly record.

**Required evidence:** EV-C09-01 to EV-C09-12. **Retention:** RET-A; the log itself per configuration.
**Exception handling:** A week skipped; shipper stopped; integrity check fails (treat as an incident).
**Escalation:** Integrity check failure or sudden gap in log rows: Executive Sponsor and C08 incident process.
**Automation:** *From the application today:* the System Log, hash chain, Verify integrity, export, retention. *Needs build (recommendation only):* alert routing; a "weekly review checklist" screen that stores the reviewer's sign-off; scheduled integrity check with result stored; off-server log copy; uptime probe for `/api/health`.

## C10 Vendor reviews

**Purpose:** Outside services that handle CKDesk data are known, assessed and watched.
**Owner role:** Vendor Relationship Owner (backup: Information Security Lead). **Frequency:** annual review; on every new supplier.

**Procedure steps**
1. Build the supplier register from the assessment inventory: Google Workspace mail (SMTP/IMAP), Gmail API and Microsoft Graph (if channels are enabled), Meta WhatsApp Cloud API, LLM provider (Groq by default, only if an API key is set), DeskTime, browser push services, Resend (fallback), GitHub, NAS vendor, ISP and router, Windows and PostgreSQL vendors.
2. Confirm which integrations are on in production (Platform Settings, Intake Channels, DeskTime screens) and save a dated record.
3. For each supplier holding personal or ticket data: contract and data terms on file; latest assurance report (SOC 2 or ISO certificate) obtained and read; note what the supplier covers and what CKDesk must still do.
4. Rate impact of outage and exit plan.
5. Sign the review.

**Required evidence:** EV-C10-01 to EV-C10-07. **Retention:** RET-A.
**Exception handling:** Supplier without a report, with a lapsed report, or with a significant change: exception and a decision (accept, add controls, replace).
**Escalation:** Supplier incident affecting CKDesk data: C08.
**Automation:** Manual. *Needs build (recommendation only):* a CKDesk register page for suppliers is optional; a spreadsheet is enough.

## C11 Business continuity test

**Purpose:** The organisation can bring CKDesk back within agreed times.
**Owner role:** Executive Sponsor (accountable) and IT Operations Lead (performs). **Frequency:** annual; reboot test first.

**Procedure steps**
1. Approve targets (RTO, RPO) and the plan.
2. Run the open reboot test of 10.0.1.98 in an agreed window using the runbook section 7 checklist (five `CkDesk*` services Running, health OK, cron tasks Ready with last result 0, an old attachment opens, public URL answers). Record time and result.
3. Annual recovery test: restore the database dump and attachments to a different host (or a documented tabletop if no spare host); time each step; compare with RTO/RPO.
4. List the single points of failure (one app server, one database server shared with other apps, one NAS, one router) and record management's acceptance or plan.
5. Track fixes.

**Required evidence:** EV-C11-01 to EV-C11-06. **Retention:** RET-A.
**Exception handling and escalation:** Test fails or exceeds RTO: exception; Executive Sponsor decides on remedy and retest date.
**Automation:** Manual. *Needs build:* none required.

## C12 Security awareness

**Purpose:** People who use or run CKDesk know their security duties.
**Owner role:** HR Lead (backup: Information Security Lead). **Frequency:** annual; new joiners within 30 days (PROVISIONAL).

**Procedure steps**
1. Approve a short programme (phishing, passwords, handling of tickets and attachments, reporting incidents) plus extra content for technicians, managers, admins and the developer (secure coding, safe operation of servers).
2. Run it and keep completion records per person.
3. Collect acknowledgement of the acceptable-use / responsibilities statement.
4. Reconcile the completion list with the Users export from C02 (anyone with an account but no record is listed).
5. Report completion rate to the Executive Sponsor.

**Required evidence:** EV-C12-01 to EV-C12-05. **Retention:** RET-A.
**Exception handling and escalation:** Overdue people are reported monthly; privileged roles without training have their elevated access reviewed (C03).
**Automation:** Manual. *Needs build (optional):* a flag on the Users screen for training status.

## C13 Risk assessment refresh

**Purpose:** Risks to CKDesk are identified, rated, treated or accepted by management.
**Owner role:** Information Security Lead (backup: Executive Sponsor). **Frequency:** annual; after significant change.

**Procedure steps**
1. Approve a method (scales, criteria).
2. Build or refresh the risk register using: VAPT finding status table, the earlier audit defect register, control evidence inventory, supplier register, incident register, exception register, and changes in the business (new integration, HTTPS, server move). Include fraud and misuse risks.
3. Meet; decide treat/accept/transfer; record minutes.
4. Executive Sponsor signs acceptances; review dates set.
5. After a significant change (for example HTTPS or a new channel), add a short reassessment to the change entry (C04).

**Required evidence:** EV-C13-01 to EV-C13-06. **Retention:** RET-A.
**Exception handling and escalation:** Refresh not done by its anniversary: exception; Executive Sponsor.
**Automation:** Manual.

## C14 Policy review

**Purpose:** Policies are approved, current and communicated.
**Owner role:** Executive Sponsor (backup: Compliance Coordinator). **Frequency:** annual; on major change.

**Procedure steps**
1. Draft and approve the policy set (marked DRAFT — not approved until management signs): information security, access control, change management, backup and recovery, incident response, acceptable use, supplier management, data handling and retention, monitoring and logging, cryptography and secrets.
2. Give each policy an owner, version, approval date, next review date.
3. Review annually; keep a review log; communicate changes; collect acknowledgements (C12).
4. Hold quarterly management meetings on security and record minutes.
5. Make real retention rules match the stated ones (the `retention_policies` table is not enforced today).

**Required evidence:** EV-C14-01 to EV-C14-05. **Retention:** RET-B for policies; RET-A for minutes and logs.
**Exception handling and escalation:** Overdue review: exception; Executive Sponsor.
**Automation:** Manual.

## C15 Key and secret rotation

**Purpose:** Secrets are limited in life, held by known people, and changed after exposure or staff change.
**Owner role:** IT Operations Lead (backup: Database Administrator). **Frequency:** at least annual for rotatable secrets; immediately after a leaver who knew them or after a suspected leak.

**Procedure steps**
1. Create the secrets inventory (names, location, owner, interval, last rotated) without values. Secrets in scope: JWT secret and service-role / anon keys (currently valid 10 years), ES256 signing key, `CRON_SECRET`, mailbox App Password, DeskTime key, Meta secrets, vault key, `postgres` password, SSH key, `ck_backup` role password.
2. Write a rotation procedure for each; the signing-key rotation is written; the JWT secret must not be changed without rebuilding and re-issuing keys (test this on the audit stack before production).
3. Rotate on the schedule; two people present; record date, secret name (never the value), services restarted, verification.
4. After rotation, run `/api/health`, sign-in, e-mail send and a cron task as proof.
5. Quarterly: repeat the "no secrets tracked in git" search and save output.
6. Record vault key custody (the key is not in dumps).

**Required evidence:** EV-C15-01 to EV-C15-07. **Retention:** RET-A.
**Exception handling and escalation:** Secret older than its interval: exception; suspected exposure: C08.
**Automation:** Manual. *Needs build (recommendation only):* dedicated secrets instead of one fallback secret; shorter key lifetimes; a startup self-check that warns when a secret is older than its interval.

## C16 Penetration test

**Purpose:** A skilled outsider tries to break in, and findings are fixed.
**Owner role:** Information Security Lead (backup: Executive Sponsor). **Frequency:** annual by an independent firm; internal VAPT suite after each major change.

**Procedure steps**
1. Agree scope and rules of engagement with an independent tester; use production or a production-like copy under agreed rules.
2. Receive the report; enter every finding in the tracker (C05); management responds in writing with dates.
3. After fixes are deployed, retest and keep the retest report.
4. Between external tests, run the VAPT regression suite (`tests/vapt/*`, `vitest.vapt.config.ts`) on the isolated audit stack after each relevant change and keep the output.
5. The internal VAPT of 2026-10 is useful input but is **not independent** (done with AI assistance on the isolated stack); say so to the auditor.

**Required evidence:** EV-C16-01 to EV-C16-07. **Retention:** RET-A.
**Exception handling and escalation:** Test not done within 12 months; Critical/High finding open beyond target: Executive Sponsor.
**Automation:** *From the repo today:* the regression suite can be re-run on demand. *Needs build:* commit the suite and run it in CI (recommendation only).

---

## Which controls can come from the application itself, and which need new build work (recommendations only)

| Control | Available from CKDesk today | Needs new build work (recommendation, nothing built) |
|---|---|---|
| C01 | System Log rows for invite, bulk import, role change, deactivation; role-grant rules in code | Approval step for account creation; report of accounts without approval; leaver feed |
| C02 | Users CSV export (audited) | Access-review screen with manager Keep/Change/Remove, snapshot and sign-off |
| C03 | Role-change and password-set audit rows | Privileged-user report; time-limited admin elevation |
| C04 | Build id at `/api/version`; git history | CI; release register; branch protection; named identities |
| C05 | none | CI dependency scan; findings tracker |
| C06 | none | Version collection script; dependency bot |
| C07 | Backup log parser in shipper | Wiring on 205; off-server copy; restore-test script; status tile |
| C08 | Security rows in the System Log | Alert routing; incident request type |
| C09 | System Log, hash chain check, export, retention settings | Alerts; stored weekly sign-off; scheduled integrity check; off-server copy; uptime probe |
| C10 | none | optional supplier register screen |
| C11 | none | none |
| C12 | none | optional training flag |
| C13 | none | none |
| C14 | none | none |
| C15 | none | dedicated secrets; key age check |
| C16 | Repeatable VAPT suite on the audit stack | CI run; independent test is external |

## Open questions / evidence requests for management

1. Name the owner and backup for each of the 16 controls (see SOC2-CONTROL-OWNER-MATRIX.md). Not known from the repository — management to confirm.
2. Approve (or change) the frequencies, time targets and retention proposed here; they are PROVISIONAL.
3. Confirm which Trust Services Criteria categories are in scope for the first examination (Security always; Availability, Confidentiality, Processing Integrity, Privacy optional) so unnecessary controls are not tested.
4. Decide who approves releases besides the developer (C04), and who is the Independent Reviewer for monthly checks.
5. Provide, if they exist outside the repository: the backup script and logs, any restore test, any access review, any policies, training records, supplier contracts, incident records, and the live auth-service settings.
6. Decide about deploying the LOCAL assessment fixes to production (nothing from this assessment is deployed).
7. Choose the tools for a server vulnerability scanner and for CI, or confirm that manual evidence will be used for the first period.
