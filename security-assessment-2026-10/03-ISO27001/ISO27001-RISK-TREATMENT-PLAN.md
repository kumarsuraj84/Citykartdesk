# ISO/IEC 27001 Risk Treatment Plan for Citykart Desk (CKDesk)

Date: 2026-10-15

Status: **DRAFT for management review - internal readiness assessment, not an audit report or attestation**

## How to read this

This plan says what to do about each risk that scored **10 or more** in `ISO27001-RISK-ASSESSMENT.md` (28 of 49 risks). For each one it gives the treatment, the concrete actions, the Annex A controls it relates to, a suggested owner role, effort, a relative target, the expected score after treatment, and the evidence that will prove the work is done.

Everything here is a **proposal for management**. Owner roles are placeholders (tba = to be assigned by management). Nothing has been approved, started or deployed by this document. Residual scores are the assessor's estimate and must be re-scored after the work and the evidence are seen.

**Effort:** S = a few days or less · M = a few weeks of part-time work · L = more than a month or needs a project.

**Targets are relative:** *Before production release* = done and tested before the assessment's fixes go to production (or as part of that release) · *30 days* · *90 days*, all counted from the day management approves this plan. A target of 30 or 90 days is a suggestion; management sets the real dates.

**Evidence rule:** a risk is only treated when the evidence named under "Evidence that will prove it" exists. A written plan, a script or a draft document is not evidence that the risk went down.

## 1. Overview

| Risk id | Risk | Current score | Rating | Treatment | Effort | Target | Residual score (proposed) | Owner role |
|---|---|---|---|---|---|---|---|---|
| RISK-01 | Production runs a web framework with a published critical flaw | 20 | Critical | Reduce | S | Before production release | 8 (Medium) | Application owner (tba) |
| RISK-02 | Users sign in over plain HTTP; cookies are not Secure | 16 | High | Reduce | M | 30 days | 6 (Medium) | IT head (tba); Network administrator (tba) |
| RISK-03 | Known default password for bulk-imported accounts | 16 | High | Reduce | S | 30 days | 6 (Medium) | Application owner (tba); Database administrator (tba) |
| RISK-17 | Passwords can be guessed or stuffed; no multi-factor sign-in | 16 | High | Reduce | M | 90 days (password settings and TRUSTED_PROXY_HOPS in 30 days) | 9 (Medium) | Application owner (tba); IT head (tba) |
| RISK-04 | No backup copy outside the database server | 15 | High | Reduce | M | 30 days | 8 (Medium) | Database administrator (tba); IT head (tba) |
| RISK-07 | One shared Administrator account and key for server access | 15 | High | Reduce | M | 30 days | 8 (Medium) | IT head (tba); Server administrator (tba) |
| RISK-08 | Long-lived shared keys and secrets stored in files | 15 | High | Reduce | L | 90 days | 8 (Medium) | Application owner (tba) |
| RISK-05 | Backups never proved by a restore; script and secrets not in the repo | 12 | High | Reduce | M | 30 days | 6 (Medium) | Database administrator (tba) |
| RISK-06 | Attachments on the NAS have no described backup | 12 | High | Reduce | M | 30 days | 6 (Medium) | Server administrator (tba) |
| RISK-09 | All changes made and approved by one person; no CI or second review | 12 | High | Reduce | M | 90 days | 6 (Medium) | Application owner (tba); IT head (tba) |
| RISK-10 | Only one person can maintain, deploy and restore the system | 12 | High | Reduce | M | 90 days | 6 (Medium) | Top management (tba); IT head (tba) |
| RISK-11 | No alerts when services, backups or security events fail | 12 | High | Reduce | M | 30 days | 6 (Medium) | IT head (tba); Application owner (tba) |
| RISK-12 | Nobody is assigned to read the System Log | 12 | High | Reduce | S | 30 days | 6 (Medium) | ISMS owner (tba) |
| RISK-13 | No incident response plan, roster or contact list | 12 | High | Reduce | M | 90 days | 6 (Medium) | ISMS owner (tba) |
| RISK-14 | Technicians or managers can change priority, deadlines and assignee directly | 12 | High | Reduce | M | Before production release (M164); 90 days (remaining columns) | 6 (Medium) | Application owner (tba); Database administrator (tba) |
| RISK-15 | Staff mobile numbers and internal-note files reachable by ordinary users | 12 | High | Reduce | S | Before production release | 4 (Low) | Application owner (tba) |
| RISK-18 | Leavers and unused accounts stay active | 12 | High | Reduce | M | 30 days | 6 (Medium) | HR head (tba); IT head (tba) |
| RISK-31 | Vulnerable software is not tracked on a regular basis | 12 | High | Reduce | S | 30 days | 6 (Medium) | Application owner (tba) |
| RISK-32 | Server, database and runtime patch levels are unknown | 12 | High | Reduce | M | 30 days (inventory); 90 days (schedule) | 6 (Medium) | Server administrator (tba); Database administrator (tba) |
| RISK-33 | Developer and admin PCs hold production-like data and keys | 12 | High | Reduce | S | 30 days | 6 (Medium) | IT head (tba) |
| RISK-36 | Personal data is not governed | 12 | High | Reduce | L | 90 days | 6 (Medium) | Legal / compliance contact (tba); Application owner (tba); HR head (tba) |
| RISK-37 | Single points of failure and unproven capacity | 12 | High | Reduce | M | 90 days | 9 (Medium) | IT head (tba) |
| RISK-38 | No recovery targets or continuity plan | 12 | High | Reduce | M | 90 days | 6 (Medium) | Top management (tba); IT head (tba) |
| RISK-40 | Shared servers: other applications run beside CKDesk | 12 | High | Reduce | M | 90 days | 6 (Medium) | Server administrator (tba); Database administrator (tba) |
| RISK-44 | No management system around security (policy, owner, review, internal audit) | 12 | High | Reduce | M | 90 days | 6 (Medium) | Top management (tba) |
| RISK-45 | Staff and technicians are not trained in security | 12 | High | Reduce | M | 90 days | 6 (Medium) | HR head (tba); ISMS owner (tba) |
| RISK-49 | Service-role access is used in 104 source files | 12 | High | Reduce | L | 90 days | 8 (Medium) | Application owner (tba) |
| RISK-39 | Physical protection of servers and NAS not known | 10 | High | Verify then reduce | S | 30 days | 6 (Medium) | Facilities / admin head (tba); IT head (tba) |

Total score today across these 28 risks: **363**. If every treatment works as proposed: **182** (a proposal, not a forecast). Risks still at or above 10 after treatment: **0**.

## 2. Suggested order of work

**Before production release (the release that carries the assessment's fixes)**

- RISK-01 - Production runs a web framework with a published critical flaw
- RISK-14 - Technicians or managers can change priority, deadlines and assignee directly
- RISK-15 - Staff mobile numbers and internal-note files reachable by ordinary users

**Within 30 days**

- RISK-02 - Users sign in over plain HTTP; cookies are not Secure
- RISK-03 - Known default password for bulk-imported accounts
- RISK-04 - No backup copy outside the database server
- RISK-05 - Backups never proved by a restore; script and secrets not in the repo
- RISK-06 - Attachments on the NAS have no described backup
- RISK-07 - One shared Administrator account and key for server access
- RISK-11 - No alerts when services, backups or security events fail
- RISK-12 - Nobody is assigned to read the System Log
- RISK-18 - Leavers and unused accounts stay active
- RISK-31 - Vulnerable software is not tracked on a regular basis
- RISK-32 - Server, database and runtime patch levels are unknown
- RISK-33 - Developer and admin PCs hold production-like data and keys
- RISK-39 - Physical protection of servers and NAS not known

**Within 90 days**

- RISK-08 - Long-lived shared keys and secrets stored in files
- RISK-09 - All changes made and approved by one person; no CI or second review
- RISK-10 - Only one person can maintain, deploy and restore the system
- RISK-13 - No incident response plan, roster or contact list
- RISK-17 - Passwords can be guessed or stuffed; no multi-factor sign-in
- RISK-36 - Personal data is not governed
- RISK-37 - Single points of failure and unproven capacity
- RISK-38 - No recovery targets or continuity plan
- RISK-40 - Shared servers: other applications run beside CKDesk
- RISK-44 - No management system around security (policy, owner, review, internal audit)
- RISK-45 - Staff and technicians are not trained in security
- RISK-49 - Service-role access is used in 104 source files

(Risks whose target text contains two dates appear under the first date and are described in full in section 3.)

## 3. Treatment details

### RISK-01 - Production runs a web framework with a published critical flaw

Current: likelihood 4 x impact 5 = **20 (Critical)** · Source: VAPT-DEP-01

- **Treatment:** Reduce
- **Actions:**
  1. Run user acceptance on the branch `security/vapt-iso27001-soc2-local`.
  2. Release the upgraded build through the normal procedure with the owner's explicit OK.
  3. Confirm `/api/version` shows the new build id and re-run `npm audit --omit=dev` and save the output.
  4. If the release must wait, ask management whether to restrict the public port-forward to known addresses in the meantime.
- **Mapped Annex A controls:** A.8.8, A.8.32, A.5.21, A.8.19, A.5.7
- **Suggested owner role:** Application owner (tba)
- **Effort:** S · **Target:** Before production release
- **Residual risk after treatment (proposed):** likelihood 2 x impact 4 = **8 (Medium)**
- **Evidence that will prove it:** New build id in the release record; dated `npm audit` output after deploy; list of advisories closed.
- **Needs a management decision:** Whether to restrict the public address until the release is done.

### RISK-02 - Users sign in over plain HTTP; cookies are not Secure

Current: likelihood 4 x impact 4 = **16 (High)** · Source: VA-API-01; D-018; D-037

- **Treatment:** Reduce
- **Actions:**
  1. Management decides the DNS name, certificate source and who renews it.
  2. Put a TLS reverse proxy in front of port 3210; redirect HTTP to HTTPS.
  3. After HTTPS works: Secure cookies, shorter session life, HSTS, enforce the CSP after reading the reports.
  4. Interim: restrict the public forward to known source addresses or a VPN if HTTPS is delayed.
- **Mapped Annex A controls:** A.8.24, A.8.20, A.5.14, A.8.5, A.8.21
- **Suggested owner role:** IT head (tba); Network administrator (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Certificate details; header and cookie scan output; router/firewall rule export; renewal owner named.
- **Needs a management decision:** Adopt HTTPS (name, certificate, budget) or restrict access to internal/VPN only.

### RISK-03 - Known default password for bulk-imported accounts

Current: likelihood 4 x impact 4 = **16 (High)** · Source: VA-API-02; VA-ADM-02; D-011

- **Treatment:** Reduce
- **Actions:**
  1. Database administrator counts live accounts that still use the default (count only, no passwords) and reports it.
  2. Replace default with random one-time passwords or invitation links; enforce the reset on the server.
  3. Force a reset for any account found.
  4. Set minimum length 8+ in the login service.
- **Mapped Annex A controls:** A.5.17, A.8.5, A.5.16
- **Suggested owner role:** Application owner (tba); Database administrator (tba)
- **Effort:** S · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Count query result with date; test showing server refuses requests until reset; updated import screen.
- **Needs a management decision:** Choose random one-time passwords or invitation e-mails (D-011).

### RISK-17 - Passwords can be guessed or stuffed; no multi-factor sign-in

Current: likelihood 4 x impact 4 = **16 (High)** · Source: D-036; VA-API-03 (rest); VA-API-01

- **Treatment:** Reduce
- **Actions:**
  1. Turn on MFA (TOTP) for platform owners, admins and managers (management decision).
  2. Set auth-service minimum length 8+ and re-authentication on change.
  3. Make lock-out persistent in the database; set TRUSTED_PROXY_HOPS in production.
  4. Shorter session life after HTTPS.
- **Mapped Annex A controls:** A.8.5, A.5.17, A.8.2, A.5.16
- **Suggested owner role:** Application owner (tba); IT head (tba)
- **Effort:** M · **Target:** 90 days (password settings and TRUSTED_PROXY_HOPS in 30 days)
- **Residual risk after treatment (proposed):** likelihood 3 x impact 3 = **9 (Medium)**
- **Evidence that will prove it:** Auth-service settings export; MFA enrolment report; limiter test.
- **Needs a management decision:** Adopt MFA for privileged roles.

### RISK-04 - No backup copy outside the database server

Current: likelihood 3 x impact 5 = **15 (High)** · Source: Control gap (no off-server backup)

- **Treatment:** Reduce
- **Actions:**
  1. Create the second copy per the owner's own proposal: separate NAS share, backup-only user, daily copy about 03:15, about 90 days, NAS snapshots.
  2. Add a monthly offline or immutable copy.
  3. Restrict who can delete backups.
- **Mapped Annex A controls:** A.8.13, A.5.29, A.5.30, A.7.10, A.7.5
- **Suggested owner role:** Database administrator (tba); IT head (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 4 = **8 (Medium)**
- **Evidence that will prove it:** Dated listing of the second copy; job configuration; access list; retention setting.
- **Needs a management decision:** Budget and location for the second copy.

### RISK-07 - One shared Administrator account and key for server access

Current: likelihood 3 x impact 5 = **15 (High)** · Source: Control gap (shared admin)

- **Treatment:** Reduce
- **Actions:**
  1. Create named admin accounts and per-person keys with passphrases.
  2. List who holds any key; remove the rest.
  3. Turn on and keep Windows logon auditing.
  4. Restrict the shared account to break-glass use with a sealed record.
- **Mapped Annex A controls:** A.8.2, A.5.16, A.5.18, A.8.15, A.8.18
- **Suggested owner role:** IT head (tba); Server administrator (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 4 = **8 (Medium)**
- **Evidence that will prove it:** Key holder list; account list; logon audit sample; break-glass procedure.
- **Needs a management decision:** Who may have admin access.

### RISK-08 - Long-lived shared keys and secrets stored in files

Current: likelihood 3 x impact 5 = **15 (High)** · Source: VA-API-05; D-029 fallback; D-058

- **Treatment:** Reduce
- **Actions:**
  1. Secrets inventory (names only) with owners.
  2. Restrict file permissions to the service account.
  3. Set dedicated secrets for cron, approval links, CSAT links and OAuth state.
  4. Plan a key rotation window (rebuild and re-issue keys); separate the HMAC key from the service-role key.
- **Mapped Annex A controls:** A.8.24, A.5.17, A.8.9, A.8.2
- **Suggested owner role:** Application owner (tba)
- **Effort:** L · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 4 = **8 (Medium)**
- **Evidence that will prove it:** Secrets inventory; ACL export; rotation record.
- **Needs a management decision:** Approve a maintenance window for key rotation.

### RISK-05 - Backups never proved by a restore; script and secrets not in the repo

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap (no restore test)

- **Treatment:** Reduce
- **Actions:**
  1. Put `backup-db.ps1` under version control (no secrets).
  2. Do a monthly restore into a scratch database; record date, person, size, row counts, result.
  3. Run the log shipper on 205 so a failed backup becomes a critical row and an alert.
  4. Agree custody of the vault key and database settings (escrow).
- **Mapped Annex A controls:** A.8.13, A.5.37, A.8.16, A.8.24
- **Suggested owner role:** Database administrator (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Restore-test record; alert test; script in repo; vault-key custody note.
- **Needs a management decision:** Who holds the vault key copy.

### RISK-06 - Attachments on the NAS have no described backup

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap

- **Treatment:** Reduce
- **Actions:**
  1. Confirm and record NAS snapshot schedule and retention.
  2. Replicate the share to a second place.
  3. Test restoring a sample of old attachments.
- **Mapped Annex A controls:** A.8.13, A.7.10, A.5.30
- **Suggested owner role:** Server administrator (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** NAS snapshot settings export; replication job; restore sample record.

### RISK-09 - All changes made and approved by one person; no CI or second review

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap (no CI, no review)

- **Treatment:** Reduce
- **Actions:**
  1. Name a second reviewer; use pull requests with branch protection on GitHub.
  2. Add CI that runs type check, lint, unit tests and `npm audit` on each push.
  3. Record every release: build id, approver, tests run.
- **Mapped Annex A controls:** A.8.32, A.5.3, A.8.25, A.8.29, A.8.4
- **Suggested owner role:** Application owner (tba); IT head (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Branch-protection settings; CI run history; release register.
- **Needs a management decision:** Who is the second reviewer.

### RISK-10 - Only one person can maintain, deploy and restore the system

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap (key person)

- **Treatment:** Reduce
- **Actions:**
  1. Appoint a deputy and give them access under the new named-account rules.
  2. Deputy performs a full deploy and a restore on the audit stack, with the record kept.
  3. Keep credentials custody per management policy.
- **Mapped Annex A controls:** A.5.2, A.5.37, A.6.3
- **Suggested owner role:** Top management (tba); IT head (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Deputy named; rehearsal records.
- **Needs a management decision:** Appoint the deputy.

### RISK-11 - No alerts when services, backups or security events fail

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap (no monitoring)

- **Treatment:** Reduce
- **Actions:**
  1. External uptime probe on `/api/health`.
  2. E-mail alert for critical/error System Log rows, failed backup and failed-login bursts.
  3. Run the log shipper on 205.
  4. Name who receives alerts and who covers.
- **Mapped Annex A controls:** A.8.16, A.8.15, A.5.25, A.8.14
- **Suggested owner role:** IT head (tba); Application owner (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Test alert e-mails; probe configuration; roster.

### RISK-12 - Nobody is assigned to read the System Log

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap (no log review)

- **Treatment:** Reduce
- **Actions:**
  1. Name a reviewer and a deputy.
  2. Daily 10-minute look at security and critical rows; weekly signed summary.
  3. Define what turns an event into an incident.
- **Mapped Annex A controls:** A.8.15, A.8.16, A.5.25, A.5.36
- **Suggested owner role:** ISMS owner (tba)
- **Effort:** S · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Review sheet with dates and initials.

### RISK-13 - No incident response plan, roster or contact list

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap (no IR plan)

- **Treatment:** Reduce
- **Actions:**
  1. Write a short plan: severity levels, roles, contact tree, reporting, evidence handling, notification duties, review template.
  2. Open a security incident register.
  3. Hold one tabletop exercise and record it.
- **Mapped Annex A controls:** A.5.24, A.5.25, A.5.26, A.5.27, A.5.28, A.6.8
- **Suggested owner role:** ISMS owner (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Approved plan; register; exercise record.
- **Needs a management decision:** Approve the plan and the notification duties.

### RISK-14 - Technicians or managers can change priority, deadlines and assignee directly

Current: likelihood 4 x impact 3 = **12 (High)** · Source: VA-DB-01; VA-TKT-01; VA-DB-02; R-1

- **Treatment:** Reduce
- **Actions:**
  1. Deploy M164 and app changes after UAT.
  2. Design column-level rights so only the server writes the remaining columns.
  3. Add database-level tests for each protected column.
- **Mapped Annex A controls:** A.8.3, A.8.28, A.5.3, A.8.15
- **Suggested owner role:** Application owner (tba); Database administrator (tba)
- **Effort:** M · **Target:** Before production release (M164); 90 days (remaining columns)
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** T11 re-run on a production copy; trigger present in catalogue; new tests.
- **Needs a management decision:** Whether technicians may keep any direct write.

### RISK-15 - Staff mobile numbers and internal-note files reachable by ordinary users

Current: likelihood 4 x impact 3 = **12 (High)** · Source: VA-INT-01; VA-INT-03; VA-INT-13; VA-DB-07

- **Treatment:** Reduce
- **Actions:**
  1. Deploy M164 and the app changes after UAT (back-fills old internal files).
  2. Confirm with a 20 MB upload test and a notification test in UAT.
  3. Decide how much of the staff list requesters may read (VA-DB-07 rest).
- **Mapped Annex A controls:** A.8.3, A.5.15, A.5.34, A.8.12
- **Suggested owner role:** Application owner (tba)
- **Effort:** S · **Target:** Before production release
- **Residual risk after treatment (proposed):** likelihood 2 x impact 2 = **4 (Low)**
- **Evidence that will prove it:** T10 re-run showing "blocked after"; UAT notes.
- **Needs a management decision:** Who may read the staff list.

### RISK-18 - Leavers and unused accounts stay active

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap; R-3; D-010; VA-API-09

- **Treatment:** Reduce
- **Actions:**
  1. Leaver checklist with same-day deactivation by HR trigger.
  2. Monthly reconciliation of active users (audited CSV export) against HR list.
  3. Quarterly review of admins, managers and technicians.
  4. Check `is_active` in the profile loader (R-3).
- **Mapped Annex A controls:** A.5.16, A.5.18, A.6.5, A.8.2
- **Suggested owner role:** HR head (tba); IT head (tba)
- **Effort:** M · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Reconciliation records; signed reviews; deactivation dates.

### RISK-31 - Vulnerable software is not tracked on a regular basis

Current: likelihood 4 x impact 3 = **12 (High)** · Source: VAPT-DEP-01; npm residual (uuid via exceljs)

- **Treatment:** Reduce
- **Actions:**
  1. Weekly `npm audit --omit=dev` (CI or scheduled).
  2. Dependabot or equivalent for update proposals.
  3. Management signs a short accepted-risk list (for example uuid via exceljs).
  4. Update rule: critical within 7 days, high within 30 (proposal).
- **Mapped Annex A controls:** A.8.8, A.5.21, A.5.7, A.8.25
- **Suggested owner role:** Application owner (tba)
- **Effort:** S · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Scheduled scan history; accepted-risk record.
- **Needs a management decision:** Sign the accepted-risk list.

### RISK-32 - Server, database and runtime patch levels are unknown

Current: likelihood 3 x impact 4 = **12 (High)** · Source: D-038; control gap

- **Treatment:** Reduce
- **Actions:**
  1. Inventory versions and dates on 98, 205 and the NAS.
  2. Patch schedule with a maintenance window; test first on the audit stack.
  3. Record the Node version and update `.nvmrc`.
- **Mapped Annex A controls:** A.8.8, A.8.9, A.8.19, A.7.13
- **Suggested owner role:** Server administrator (tba); Database administrator (tba)
- **Effort:** M · **Target:** 30 days (inventory); 90 days (schedule)
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Inventory sheet; patch records.

### RISK-33 - Developer and admin PCs hold production-like data and keys

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap

- **Treatment:** Reduce
- **Actions:**
  1. Confirm disk encryption, screen lock and endpoint protection on both PCs.
  2. Delete or encrypt real-data dumps; use synthetic data.
  3. Protect the ssh key with a passphrase or hardware token.
- **Mapped Annex A controls:** A.8.1, A.8.33, A.7.9, A.8.24, A.6.7
- **Suggested owner role:** IT head (tba)
- **Effort:** S · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Endpoint compliance report; dump disposal note.
- **Needs a management decision:** Policy: no real data on the dev PC.

### RISK-36 - Personal data is not governed

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap; VA-INT-13

- **Treatment:** Reduce
- **Actions:**
  1. Data inventory (fields, purpose, location, retention).
  2. Decide retention periods and build the job that enforces them.
  3. Add delete/anonymise for leavers and requests.
  4. Privacy notice including DeskTime monitoring; DSAR and breach steps; legal register.
- **Mapped Annex A controls:** A.5.34, A.5.31, A.8.10, A.5.12, A.5.33, A.5.20
- **Suggested owner role:** Legal / compliance contact (tba); Application owner (tba); HR head (tba)
- **Effort:** L · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Inventory; notice; retention job log; procedures.
- **Needs a management decision:** Retention periods; legal basis; notification duties.

### RISK-37 - Single points of failure and unproven capacity

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap; R-8; D-066

- **Treatment:** Reduce
- **Actions:**
  1. Re-run load profile on the current schema; fix what it shows.
  2. Complete and record the reboot test of 10.0.1.98.
  3. List cheap resilience steps (spare image, second backup).
  4. Management accepts what remains in writing.
- **Mapped Annex A controls:** A.8.14, A.8.6, A.5.30
- **Suggested owner role:** IT head (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 3 x impact 3 = **9 (Medium)**
- **Evidence that will prove it:** Load result; reboot test record; signed acceptance.
- **Needs a management decision:** Accept single-instance design or fund redundancy.

### RISK-38 - No recovery targets or continuity plan

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap

- **Treatment:** Reduce
- **Actions:**
  1. Set RTO/RPO with business owners.
  2. Short DR plan: order of restore (database, NAS, services), contacts, manual fallback for stores.
  3. One tabletop and one real restore to a spare server, recorded.
- **Mapped Annex A controls:** A.5.29, A.5.30, A.8.13, A.8.14
- **Suggested owner role:** Top management (tba); IT head (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Approved targets; plan; test records.
- **Needs a management decision:** Approve RTO/RPO.

### RISK-40 - Shared servers: other applications run beside CKDesk

Current: likelihood 3 x impact 4 = **12 (High)** · Source: Control gap

- **Treatment:** Reduce
- **Actions:**
  1. Document CKDesk boundaries on 98 and 205.
  2. Per-application Windows service accounts and file ACLs.
  3. Limit database connections to the app server address (`pg_hba` and firewall).
  4. Agree resource limits with neighbours.
- **Mapped Annex A controls:** A.8.22, A.8.20, A.8.2, A.8.9
- **Suggested owner role:** Server administrator (tba); Database administrator (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** ACL and firewall exports; service account list.

### RISK-44 - No management system around security (policy, owner, review, internal audit)

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap (clauses 4-10)

- **Treatment:** Reduce
- **Actions:**
  1. Approve scope, policy set and risk method (this assessment is the draft).
  2. Appoint the ISMS owner.
  3. Hold the first management review and plan an internal audit.
- **Mapped Annex A controls:** A.5.1, A.5.2, A.5.4, A.5.35, A.5.36
- **Suggested owner role:** Top management (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Signed scope and policy; review minutes; audit plan.
- **Needs a management decision:** Approve scope, appoint owner, set risk appetite.

### RISK-45 - Staff and technicians are not trained in security

Current: likelihood 4 x impact 3 = **12 (High)** · Source: Control gap

- **Treatment:** Reduce
- **Actions:**
  1. Awareness session for all staff (passwords, phishing, reporting).
  2. Role-based session for admins, technicians and the developer.
  3. Keep attendance records; repeat yearly.
- **Mapped Annex A controls:** A.6.3, A.6.8, A.5.10
- **Suggested owner role:** HR head (tba); ISMS owner (tba)
- **Effort:** M · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 3 x impact 2 = **6 (Medium)**
- **Evidence that will prove it:** Attendance lists; content; test results.

### RISK-49 - Service-role access is used in 104 source files

Current: likelihood 3 x impact 4 = **12 (High)** · Source: VA-TKT, VA-ADM and VA-INT finding series

- **Treatment:** Reduce
- **Actions:**
  1. List all service-role call sites by sensitivity.
  2. Move role and ownership checks into one shared helper.
  3. Add a test or lint rule that flags new service-role use.
  4. Add database-level tests for sensitive actions.
- **Mapped Annex A controls:** A.8.28, A.8.3, A.8.27, A.8.29
- **Suggested owner role:** Application owner (tba)
- **Effort:** L · **Target:** 90 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 4 = **8 (Medium)**
- **Evidence that will prove it:** Call-site inventory; helper in use; CI rule.

### RISK-39 - Physical protection of servers and NAS not known

Current: likelihood 2 x impact 5 = **10 (High)** · Source: Control gap (A.7.x not verified)

- **Treatment:** Verify then reduce
- **Actions:**
  1. Walk through the room(s) with a checklist: access, visitor log, CCTV, UPS test, fire, cooling, cabling, disposal.
  2. Write findings with dated photos and sign-off.
  3. Re-score this risk.
- **Mapped Annex A controls:** A.7.1, A.7.2, A.7.3, A.7.4, A.7.5, A.7.6, A.7.7, A.7.8, A.7.9, A.7.10, A.7.11, A.7.12, A.7.13, A.7.14
- **Suggested owner role:** Facilities / admin head (tba); IT head (tba)
- **Effort:** S · **Target:** 30 days
- **Residual risk after treatment (proposed):** likelihood 2 x impact 3 = **6 (Medium)**
- **Evidence that will prove it:** Signed checklist with photos; UPS runtime test.

## 4. Risks below the threshold (score under 10)

These do not need a full plan. The default is **monitor**; management may accept each in writing or apply the cheap fix named in the register.

| Risk id | Risk | Score | Rating | Suggested handling | Mapped controls |
|---|---|---|---|---|---|
| RISK-16 | HR and Finance tickets visible to every manager-level user | 9 | Medium | Accept (until decision) / Reduce | A.5.12, A.5.15, A.8.3 |
| RISK-19 | Excess privileges are not reviewed; the permission screen is not enforced | 9 | Medium | Reduce (cheap) | A.5.18, A.8.2, A.5.15 |
| RISK-20 | Managers can change shared configuration and business rules | 9 | Medium | Reduce after management decision | A.8.3, A.5.3, A.8.2 |
| RISK-23 | Vault key lost or not escrowed | 9 | Medium | Reduce (in RISK-05 plan) | A.8.24, A.8.13 |
| RISK-24 | One shared secret reused for many purposes | 9 | Medium | Reduce (in RISK-08 plan) | A.8.24, A.5.17 |
| RISK-26 | Forged or wrongly attributed e-mail replies | 9 | Medium | Reduce | A.8.3, A.5.14, A.8.28 |
| RISK-27 | Approval workflows can be bypassed through side doors | 9 | Medium | Reduce after policy decision | A.5.3, A.8.3 |
| RISK-28 | Public endpoints abused to slow or fill the system | 9 | Medium | Reduce | A.8.6, A.8.16, A.8.20 |
| RISK-29 | Ordinary users write directly to tables lacking checks | 9 | Medium | Reduce | A.8.3, A.8.28 |
| RISK-30 | Uploaded files are not scanned for malware | 9 | Medium | Reduce | A.8.7 |
| RISK-34 | Source repository integrity and loss | 9 | Medium | Reduce | A.8.4, A.5.15 |
| RISK-35 | Outside suppliers hold company data without recorded terms | 9 | Medium | Reduce | A.5.19, A.5.20, A.5.21, A.5.22, A.5.23 |
| RISK-47 | Secrets typed into tickets and notes | 9 | Medium | Reduce | A.5.10, A.8.11, A.5.12 |
| RISK-48 | Sessions last very long and are not tied to a timeout | 9 | Medium | Reduce (after HTTPS, in RISK-02 plan) | A.8.5 |
| RISK-21 | Stored script in templates and report-only CSP | 8 | Medium | Reduce | A.8.28, A.8.26 |
| RISK-22 | Misuse of the shared mailbox credentials | 8 | Medium | Reduce | A.8.24, A.5.17, A.8.2 |
| RISK-42 | Audit records could be altered by a database owner | 8 | Medium | Reduce | A.8.15, A.5.28, A.5.33 |
| RISK-46 | AI assistant works in the development and operations flow | 8 | Medium | Reduce / decide | A.8.30, A.5.23, A.8.25, A.5.3 |
| RISK-25 | WhatsApp webhook probing or flooding | 6 | Medium | Accept with monitoring | A.8.16, A.8.5 |
| RISK-41 | Old documents lead to action on the wrong server | 6 | Medium | Reduce (cheap) | A.5.37, A.8.9 |
| RISK-43 | Audit locking slows the system under load | 6 | Medium | Reduce (load test, in RISK-37 plan) | A.8.6 |

## 5. Decisions that only management can take

These cannot be made by the developer or the assessor. Several treatments above wait on them.

| Id | Decision needed | Risks affected | Who decides (placeholder) |
|---|---|---|---|
| DEC-01 | Adopt HTTPS (DNS name, certificate source and renewal owner) or restrict the public address to known sources/VPN | RISK-02, RISK-48 | Top management (tba); IT head (tba) |
| DEC-02 | Default initial password: choose random one-time passwords or invitation e-mails (D-011) | RISK-03 | Application owner (tba); IT head (tba) |
| DEC-03 | Require multi-factor sign-in for platform owner, admin and manager roles | RISK-17 | Top management (tba) |
| DEC-04 | Pay for and place the off-server backup copy; choose retention (proposal: about 90 days) | RISK-04, RISK-06 | Top management (tba); IT head (tba) |
| DEC-05 | Key rotation window: approve downtime for re-issuing the 10-year keys | RISK-08 | Top management (tba) |
| DEC-06 | Who may keep direct write rights on tickets and shared configuration (managers, technicians); who may edit global settings | RISK-14, RISK-20 | Top management (tba); Service desk lead (tba) |
| DEC-07 | Confidentiality tier for HR/Finance tickets (D-005) | RISK-16 | Top management (tba); HR head (tba) |
| DEC-08 | Approval policy: may a requester delegate or add approvers on their own ticket (D-030 side doors) | RISK-27 | Service desk lead (tba) |
| DEC-09 | Accept or fund redundancy (single server, NAS, router); set RTO and RPO | RISK-37, RISK-38 | Top management (tba) |
| DEC-10 | Appoint ISMS owner, deputy for the developer and a second reviewer for releases | RISK-09, RISK-10, RISK-44 | Top management (tba) |
| DEC-11 | Approve scope, policy set, risk method, scoring scale and risk appetite (treat at score 10 or more) | All | Top management (tba) |
| DEC-12 | Sign the accepted-risk list (for example uuid via exceljs, Medium risks accepted) | RISK-31, Medium risks | Top management (tba) |
| DEC-13 | Retention periods and legal basis for ticket, attachment, e-mail and DeskTime data; DeskTime monitoring notice | RISK-36 | Legal / compliance contact (tba); HR head (tba) |
| DEC-14 | AI assistant: allowed access to servers and data shared with its provider | RISK-46 | Top management (tba); IT head (tba) |
| DEC-15 | External penetration test and internal audit: yes/no and timing | RISK-44 | Top management (tba) |

Each decision should be recorded with the date, the decision-maker's name and the reason. Until it is, the related risk stays open.

## 6. Annex A coverage of the plan

Controls referenced by at least one treated risk: **71** of 93. Controls that no risk references are still listed in the matrix and in the Statement of Applicability draft; they are included as part of the Annex A baseline pending management's review of the risk assessment.

## Open questions / evidence requests for management

Everything in this list is "Not known from the repository - management to confirm". Do not send secrets, passwords or keys; send the document, screenshot or export with secrets removed.

1. Approve, change or reject each **treatment** in section 3, and set real dates for "30 days" and "90 days".
2. Take or record each **decision** in section 5 (DEC-01 to DEC-15).
3. Name the **owner** for each treatment (placeholders are marked tba).
4. Say what **budget** is available for: a second backup location, a TLS certificate and reverse proxy, MFA, an external penetration test, endpoint protection, training.
5. Confirm which of the **Medium risks** management accepts in writing (section 4) and who signs.
6. Provide the **evidence** named in section 3 as each treatment is finished (dated exports, signed records, test outputs), so residual scores can be re-assessed.
7. State whether the release carrying the assessment's fixes may go to production and when (RISK-01, RISK-14, RISK-15 wait on this); the usual rule is that the project owner gives an explicit OK.
8. Confirm the **user acceptance** testing plan for the local fixes (including a 20 MB upload test, which was not verified dynamically).
