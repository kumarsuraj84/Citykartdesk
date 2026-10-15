# ISO/IEC 27001:2022 - Internal Audit Readiness and Proposed Programme for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

Clause 9.2 of ISO 27001 requires an organisation to audit its own ISMS at planned intervals, using auditors who are objective and impartial, and to report the results to management. This file is a **proposal** for such a programme, and a forecast of what a first audit would find **today, based only on the repository evidence inventory** (`security-assessment-2026-10/01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md`, cited as "Inv. n", and the VAPT status table `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`).

- **No internal audit has been held. This document is not an audit report.** The 2026-10 assessment was performed by the project's own team with AI assistance; it is input to an audit, not a substitute for one.
- The gradings below (for example "likely major") are my forecast using the usual meaning of "major" (a requirement not met or a system failure) and "minor" (a lapse that does not break the system). They are PROVISIONAL — confirm against the licensed standard and the auditor's judgement.
- Evidence classes: A verified local technical test evidence · B repository evidence · C authorised organisational evidence (approved policies, signed records; **none supplied so far**) · D documentation-only · E missing / not verified.
- Nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`), without the LOCAL fixes.

---

## 1. Proposed audit programme

### 1.1 Objective

To give management objective information on whether the CKDesk ISMS (a) meets the organisation's own requirements, (b) meets the requirements of ISO/IEC 27001:2022, and (c) is effectively implemented and maintained.

### 1.2 Scope (follows the proposed ISMS scope; not yet approved)

The audit scope is the ISMS scope in `ISO27001-SCOPE-AND-CONTEXT.md` section 4: the CKDesk application, production servers 10.0.1.98 (app) and 10.0.0.205 (database `ckdesk` only), NAS folder `CKDESK_DATA` on 10.0.0.25, the developer and admin PCs, the integrations (Google/Microsoft mail, Meta WhatsApp, DeskTime, optional LLM), and the people and processes around them. The other applications on the shared servers are out of scope except where they touch CKDesk.

### 1.3 Audit criteria

1. Clauses 4 to 10 of ISO/IEC 27001:2022.
2. The Annex A controls selected in the (future) Statement of Applicability. Until that exists, the auditor uses all 93 controls (A.5.1-A.5.37, A.6.1-A.6.8, A.7.1-A.7.14, A.8.1-A.8.34) as a checklist and records which are applicable.
3. Citykart's own approved policies and procedures (none exist yet, see `ISO27001-POLICY-REGISTER.md`).
4. Legal and contractual requirements (register not yet built).
5. The management-approved risk treatment decisions.

### 1.4 Proposed cycle (proposal only; nothing is scheduled)

| Round | Focus | Pre-conditions | Proposed timing (management to set) |
|---|---|---|---|
| 0. Readiness check | Confirm that the ISMS basics exist: scope, policy, roles, first risk assessment | Management has approved scope and policy | Before round 1 |
| 1. First full audit | All clauses 4-10 and all applicable Annex A controls, sampling | At least 3 months of operating records for sampled processes | After the ISMS has run long enough to produce records |
| 2. Follow-up | Verify closure of round 1 findings | Corrective actions done | About 3 months after round 1 |
| 3. Yearly cycle | Risk-based: higher-risk areas every cycle (access, change, backup, incident); lower-risk areas on rotation. Every area at least once per cycle of 3 years or as management decides | Programme approved | Yearly |
| Triggered audits | After a serious incident, major change (HTTPS migration, new channel, server move) | — | As needed |

### 1.5 Auditor independence

- **The developer must not audit their own work.** All 271 commits carry one author identity ("Local Setup <local@citykart.org>"), one person approves every push and deploy (`CLAUDE.md`), and the same team wrote the assessment. That person and any AI assistant they use for coding **cannot** audit change management, secure development, release records, access they granted, or the System Log they configured.
- The auditor should be someone outside the CKDesk build-and-run team (for example an auditor from Citykart's finance/internal-audit function, another IT team, a trained colleague, or an external firm). Who will be auditor is **Not known from the repository — management to confirm.**
- The auditor needs training in ISO 27001 auditing (Class C evidence of competence should be kept), read access to evidence, and no authority over the audited controls.
- Audit results go to top management directly, not through the audited team.
- The same person should not audit an area in which they approved a decision or hold a role (for example the release approver cannot audit change management).

### 1.6 Sampling approach

The auditor selects samples from complete populations, not from lists supplied by the audited person. Suggested sample sizes are starting points that the auditor may change (management to approve).

| Population (size known today) | Source of the full population | Suggested sample |
|---|---|---|
| User accounts (about 553; 527 at the 2026-09-24 snapshot) | Users export (audited as `user.export_csv`) | All privileged users (platform owners, admins, managers); 25 other users chosen at random |
| Starters and leavers over the last 12 months | HR list compared with the Users export and `user.deactivated` System Log rows | All leavers in the last 3 months; a random 10 across the year |
| Production releases (builds since go-live; 271 commits since 2026-08-06; build ids) | Server folders `standalone-bak-<timestamp>`, git log, release records (none today) | Every release in the last 3 months; 5 older |
| Database migrations | `auth.schema_migrations` on 10.0.0.205 compared with `supabase/migrations` (164 files) | All migrations since the last audit |
| Nightly backups | `backup.log` and backup folder for 30 days | Every day of the last 30 days checked for OK/FAILED and file presence |
| Restore tests | Restore-test records (none today) | All |
| System Log security rows | System Log screen (`security` and `audit` categories) | Random 2 weeks; every `critical` row |
| Log reviews | Reviewer's signed records (none today) | All in the last 6 months |
| Tickets (278 at last count) with approvals | Approvals module, System Log | 10 tickets covering requests with approval flows, internal notes and attachments |
| VAPT findings closed | Status table and tests | All Critical and High; 5 Medium |
| Vulnerability scans | `npm audit` outputs (one-off today) | All in the audit period |
| Suppliers | Supplier register (none today) | All in the register |
| Training records | HR (none supplied) | All administrators; 20 other staff |

---

## 2. What evidence an auditor will ask for, by area

For each area: the question, what the repository already offers, and what must be supplied. "Supply" items are Class C requests.

### 2.1 Governance (clauses 4, 5, 6.2)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Approved ISMS scope | Draft only (`ISO27001-SCOPE-AND-CONTEXT.md`) | Signed scope |
| Approved information security policy; communication evidence | None (Inv. 1) | Signed policy, staff notice |
| Named roles and responsibilities | Software roles only; titles for WhatsApp pilot without names | Role appointments |
| Security objectives and progress | None | Objectives, last results |
| Legal and regulatory register | None | Register |

### 2.2 Risk (6.1, 8.2, 8.3)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Risk method and criteria | None | Method |
| Asset inventory | Server list in runbook; module inventory in baseline | Asset register with owners |
| Risk register with owners and acceptance | None; VAPT status table and defect register track technical defects | Register, signed acceptance (HTTPS, default password, D-005) |
| Statement of Applicability | None | SoA |
| Treatment plan and its progress | VAPT status table (LOCAL fixes, not deployed) | Plan, approvals, deployment records |

### 2.3 Access and identity (A.5.15-A.5.18, A.8.2, A.8.3, A.8.5)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Joiner/mover/leaver procedure and records | Admin invite/bulk-import code; deactivation code (bans sign-in) and System Log rows; no documented procedure (Inv. 2) | Procedure, HR trigger, sample records |
| Privileged user list and justification | Users export; 2 platform owners, 0 admins at 2026-09-24 | Current list with reasons |
| Access review records | None | Review records |
| Password and session settings in force | App code: minimum 8; auth service production `.env` not in repo; cookies not Secure (D-037) | Screenshot or file of production `services\auth\.env`; proof signup disabled (VA-DB-08 not verified) |
| MFA | None | Plan or risk acceptance |
| Evidence whether any live account still has the default import password | Not checkable from repo | Result of a management-approved check on production |
| Server admin access | Shared `Administrator` account, one ssh key | List of key holders |

### 2.4 Change, release, secure development (A.8.25-A.8.34, A.5.37)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Change procedure | Runbook §4-§5 (D) | Approved procedure |
| Release records, approvals, testing evidence | Git log; build script guards; no tags, no release register | Release records for the audit period |
| Second-person review | None (one author identity) | Review records or accepted risk |
| Test results | 268 test files; last recorded runs dated 2026-10-14 pre-date later commits (R-12 in `03-EXISTING-AUDIT-RECONCILIATION.md`) | Fresh run output on the release candidate |
| Rollback rehearsal | Rollback files exist for 156-163; no rehearsal record | Rehearsal record |
| Separation of environments | Dev PC, disposable audit stack, production (B/D) | Confirmation; data copies policy |
| Dependency scanning | One-off `npm audit` (2026-10-15) | Standing process records |

### 2.5 Vulnerability and patching (A.8.8)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Scan results over time | One-off `npm-audit*.json` | Scan history |
| Patch levels of Windows, PostgreSQL 18, Node, NSSM, GoTrue, PostgREST, NAS firmware | Install-time versions only; Node on 98 unknown | Version inventory with dates |
| External penetration test | None; this was an internal VAPT | Report or plan |
| Risk acceptance for open advisories | None | Signed acceptance |

### 2.6 Logging and monitoring (A.8.15, A.8.16)

| Evidence asked | Repository today | Supply |
|---|---|---|
| What is logged, retention, protection | Strong design: `docs/SYSTEM-LOG.md`, migration 160 (append-only, hash chain), shipper, retention settings | Proof migration 160 and the shipper task are live on production (`auth.schema_migrations`, scheduled tasks) |
| Who reviews and how often | Not defined | Reviewer records |
| Alerts | None; `lib/monitoring.ts` is a stub | Alert configuration |
| Integrity check results | "Verify integrity" button exists | Dated results |
| Time synchronisation, Windows and DB logs | Not in repo | Evidence |

### 2.7 Backup, recovery and continuity (A.8.13, A.5.29, A.5.30)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Backup procedure and script | Prose only; script on 205 not in repo | `backup-db.ps1`, task definition |
| Backup success evidence | None in repo | `backup.log` for the period |
| Restore test record | None | Dated records with result |
| Off-site/second copy | "Not done yet" | Evidence once done |
| Backup of vault key and config files | Not done | Evidence |
| BCP/DR plan, RTO/RPO, exercise | None | Plan, results |
| Reboot test of 98 | Open item | Result |

### 2.8 Data protection and cryptography (A.5.12-A.5.14, A.5.33, A.5.34, A.8.10, A.8.11, A.8.24)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Data inventory, classification | None; D-005 open | Inventory, scheme |
| Privacy notice, DPA, retention schedule | None; `retention_policies` table not enforced | Documents |
| Encryption in transit | Plain HTTP public; internal HTTP (Inv. 3, 11) | TLS plan and approval |
| Encryption at rest | Vault only; disks, NAS and backups not stated | Statements/evidence |
| Key management | Vault key, JWT secret, 10-year service keys; no rotation record | Custody and rotation records |
| Subject access and deletion process | None | Procedure |

### 2.9 Suppliers (A.5.19-A.5.23)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Supplier register | None; the repo lists what each supplier receives (Inv. 12) | Register |
| Contracts/DPAs for Google, Meta, DeskTime, others | None | Contracts |
| Assurance reports/certificates of suppliers | None | Copies |
| Which integrations are live | Not in repo | Production configuration list |

### 2.10 Incident management (A.5.24-A.5.28, A.6.8)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Plan, roles, contacts | None; WhatsApp pilot runbook only | Plan |
| Incident register | None (engineering fault reports only) | Register (even if empty) |
| Exercise | None | Record |
| Breach notification obligations | None | Legal guidance |

### 2.11 People and physical (A.6.x, A.7.x)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Screening, terms, NDAs | None (Inv. 15) | HR records |
| Awareness training records | None | Records |
| Server room, access, power, cooling, fire | None (IP addresses only) | Inspection or facility records (Class C) |
| Equipment disposal (retired server 10.0.1.12) | Kept disabled | Disposal plan/records |
| Endpoint protection on dev and admin PCs | Not stated | Evidence |

### 2.12 ISMS operation (clauses 7, 9, 10)

| Evidence asked | Repository today | Supply |
|---|---|---|
| Competence and awareness records | None | Records |
| Document control | Git only | Document register |
| Previous internal audit and management review | None | Not applicable on first round: auditor records "none" |
| Nonconformity register | Defect registers only | Register |
| Improvement log | Informal | Log |

---

## 3. How the 2026-10 VAPT can serve as audit input

The VAPT is a technical test. For ISO audit it serves as **evidence for the technology controls**, not as an ISMS audit.

| VAPT output | Use in the audit | Limits |
|---|---|---|
| Finding status table (`05-REMEDIATION/00-FINDING-STATUS-TABLE.md`): 32 rows of fixes found and fixed in LOCAL (section A), 15 rows open, partial, decision-needed or not verified (section B); rows group several finding IDs | Input to risk treatment (6.1.3, 8.3), vulnerability management (A.8.8), secure development (A.8.25-A.8.29); the auditor can sample closed items and re-run the named test | Every fix is LOCAL, not deployed. Production is on build 20261015-145217, which does not contain them |
| Class A before/after tests (`tests/vapt/*`, `tests/unit/vapt-hardening-units.test.ts`, `tests/unit/approval-code-burst.test.ts`) on the isolated audit stack | Auditor can re-run to confirm control effectiveness (A.8.3, A.8.5, A.8.26, A.8.29) | Synthetic data; not production configuration (HTTPS, proxy, real mail) |
| Reconciliation of the earlier audit (75 items): 53 fixed and independently verified (11 of them partial), 4 fix present but not retested, 9 still vulnerable, 1 superseded, 7 need a business decision, 1 cannot be verified (`03-EXISTING-AUDIT-RECONCILIATION.md`) | Shows the state of the earlier audit's findings | The reconciliation reads tests but did not run them; no test run since the later commits (R-12) |
| Local isolation certification (21 of 21 gate checks) (`02-LOCAL-ISOLATION-CERTIFICATION.md`) | Evidence that testing did not touch production (A.8.31, A.8.33) | Gate covers Node processes; a human browser is outside it |
| Control evidence inventory (`04-CONTROL-EVIDENCE-INVENTORY.md`) | The auditor's evidence request list starts here | Repo-only; production not inspected |
| `npm audit` results (31 findings in all dependencies; 9 in production dependencies at the time) | Evidence for A.8.8 and a baseline for a standing scan | One-off |
| Items marked Not Verified (for example VA-DB-08 self sign-up in the live login service) | Auditor should verify these on production with management's authorisation | Not checked; production was not contacted |

The auditor should treat the VAPT as evidence prepared by the audited team. They should re-perform a sample of tests (or have an independent party do so) and should not accept it as independent assurance.

---

## 4. What a first audit would likely find today (forecast from the inventory only)

Gradings are provisional. The forecast uses only what the repository shows; some records may exist outside it, in which case the finding could soften.

### 4.1 Likely major findings (requirement not met or no system)

| # | Likely finding | Clause / control (PROVISIONAL) | Basis |
|---|---|---|---|
| 1 | No approved ISMS scope, information security policy, objectives, roles, risk assessment, risk treatment plan or Statement of Applicability | 4.3, 5.2, 5.3, 6.1.2, 6.1.3, 6.2 | Inv. 1: searched, not found |
| 2 | No internal audit programme and no management review ever held | 9.2, 9.3 | No records. (Expected on a first round; auditors treat absence after certification as major.) |
| 3 | No documented and evidenced restore test; no second backup copy; backup script not controlled | A.8.13 | Inv. 9 |
| 4 | Public service over plain HTTP; session cookies not `Secure`; CSP report-only | A.8.20, A.8.24, A.8.26 | Inv. 3; VA-API-01 (Requires Decision) |
| 5 | Known default password for bulk-imported accounts; production state unchecked | A.5.17, A.8.5 | VA-API-02 / D-011 (Requires Decision) |
| 6 | Production runs a framework version with published critical and high advisories; no standing vulnerability and patch process | A.8.8 | Status table VAPT-DEP-01 (fix LOCAL only); Inv. 7 |
| 7 | No access review, no documented joiner/mover/leaver procedure, shared server administrator account | A.5.15, A.5.18, A.8.2 | Inv. 2, 4 |
| 8 | No incident response plan or incident register | A.5.24-A.5.27 | Inv. 13 |
| 9 | No supplier management (no register, contracts or reviews) for Google, Meta, DeskTime and others | A.5.19-A.5.22 | Inv. 12 |
| 10 | Change management has a single approver, no independent review and no release records | A.8.32, A.5.3 | Inv. 5; single author identity |

### 4.2 Likely minor findings

| # | Likely finding | Basis |
|---|---|---|
| 11 | Logs exist but no reviewer, no alerts, no off-server copy; `lib/monitoring.ts` is a stub | Inv. 8 |
| 12 | No data classification; D-005 confidentiality tier open; retention schedule not enforced for tickets and attachments | Inv. 11 |
| 13 | No document control; stale documents about the retired server remain | Inv. "Reliability of the documents" |
| 14 | No security awareness or training records | Inv. 15 |
| 15 | No evidence of physical protection for servers and NAS | Inv. 14 |
| 16 | No BC/DR plan; single points of failure; reboot test of 10.0.1.98 not done | Inv. 10 |
| 17 | Developer copies of data on the dev PC (dumps) with no stated endpoint protection | Inv. 4, 14 |
| 18 | `.claude/settings.local.json` is tracked in git although the runbook says never to commit it | Inv. 4 |
| 19 | Tests and lint run by hand; no CI; no secret or static analysis scanning; 6 known lint findings | Inv. 6 |
| 20 | Auth-service password policy (D-036) and global settings editing rights (R-2) undecided | Reconciliation §6 |

### 4.3 Likely strengths an auditor would note

- A well-built System Log with append-only enforcement and a hash chain (migration 160) and a tested audit trail (Class B; Class A where the isolated stack tests ran).
- Deep code-level access control: row-level security everywhere, role guards, target-role protection, rate limits, signed headers; 268 test files; Class A before/after tests for the VAPT fixes.
- Honest written records of open items (the runbook's "Not done yet" list, defect registers, reconciliation).
- Disposable test stack with an isolation gate.

### 4.4 Overall forecast

If a certification body audited today it would very likely not be able to recommend certification: the management-system clauses (4-10) have little or no organisational evidence. The technical controls are comparatively strong, which shortens the work, but the missing records can only be created by management and by running the processes for a period.

---

## 5. Preparation checklist for round 1

1. Management approves scope, policy and roles; names the auditor.
2. Risk method adopted; first risk assessment done; SoA drafted.
3. Evidence repository (read-only for the auditor) set up: policies, registers, logs, review records.
4. Run the processes long enough to create records: access review, log review, backup checks, monthly restore test, release records, supplier register.
5. Production facts collected for the auditor under management's authorisation (not by the developer experimenting on production): auth-service settings, migration history, scheduled tasks, firewall rules, patch levels.
6. Decide and record the open decisions (HTTPS, default password, D-005 tier, second backup copy).
7. Deploy approved fixes through the change procedure and keep the release records.
8. Auditor training and independence declaration on file.

---

## Open questions / evidence requests for management

1. Who will be the internal auditor, and how do they stay independent of the CKDesk build-and-run team? Supply their competence evidence.
2. Approve the audit programme (cycle, scope, criteria, sample sizes) or say what to change.
3. Supply the production facts listed in section 5 step 5 (to be gathered by an authorised administrator, not experimented on).
4. Supply any earlier audit reports (internal, external, customer, group) on CKDesk or the servers.
5. Confirm the date from which records will be kept so that sampling windows can be set.
6. Confirm whether an external certification body is intended, and the target date, which sets the number of operating months needed before the audit.
7. Supply HR, training, physical-security and supplier records listed in section 2, or confirm that they do not exist.
