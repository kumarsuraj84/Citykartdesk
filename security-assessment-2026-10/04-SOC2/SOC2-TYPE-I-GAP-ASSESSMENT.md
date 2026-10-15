# SOC 2 Type I Readiness - Design Gap Assessment (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is the prioritised list of **design gaps** found while mapping CKDesk to the SOC 2 criteria (`SOC2-TYPE-I-CONTROL-DESIGN-MATRIX.md`). Each gap has a plain-language explanation, a severity, a **type**, the criteria it affects, links to VAPT / earlier audit findings, and a recommended fix. A "gap" here means a place where a reviewer would say the control's *design* is missing, weak or unproven. It is not a verdict on the people.

**Types used (exactly five):**
1. **Missing technical control** — software/configuration that should exist and does not.
2. **Missing documented process** — a procedure, policy or decision that is not written down.
3. **Control exists but is not proven** — something is in place on paper or in code, but nothing shows it works or is live.
4. **Missing organisational evidence** — a control that probably sits outside the repository (HR, premises, board); evidence class C is needed to judge it.
5. **Actual control failure** — a control that should stop a problem and, as far as we can show, does not (reproduced on the isolated stack and not fixed in production).

**Severity:** Critical (could allow serious compromise now) · High (a reviewer would almost certainly raise it) · Medium · Low · Info. Severity is for readiness, not a CVSS score.

**Important:** nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`). Where a fix exists in the local branch `security/vapt-iso27001-soc2-local`, it is **not** in production and is shown as "LOCAL only". Under the project rules, nothing is released without the owner's explicit OK.

Evidence classes: **A** local test · **B** repository · **C** management evidence (none supplied) · **D** documentation · **E** missing.

Finding IDs: `VAPT-DEP-01`, `VA-…` from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`; `D-nnn`, `R-n` from `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`.

---

## Part 1. Summary table

| ID | Gap (short) | Severity | Type | Criteria | VAPT / audit links |
|---|---|---|---|---|---|
| G-02 | Production runs a framework version with a published critical advisory | **Critical** | Actual control failure | CC6.6, CC7.1, CC8.1 | VAPT-DEP-01 |
| G-01 | No HTTPS, non-secure cookies, CSP not enforced | High | Missing technical control | CC6.1, CC6.6, CC6.7, C1.1 | VA-API-01, D-018, D-037, D-033 |
| G-03 | Other assessment fixes are LOCAL only (database and app hardening) | High | Actual control failure | CC6.1, CC6.3, CC6.6, CC8.1 | VA-DB-01/02/03/04/05/06/07, VA-TKT-01/03/04/08, VA-INT-01/03/13, VA-API-02/04/07/08 |
| G-04 | No second backup copy; backup script, vault key and config not backed up | High | Missing technical control | A1.2, CC9.1, CC7.5 | (runbook §6) |
| G-05 | No restore test; no RTO / RPO | High | Control exists but not proven | A1.3, CC7.5 | - |
| G-06 | No business continuity / disaster recovery plan; single points of failure | High | Missing documented process | CC9.1, A1.2, CC7.5 | - |
| G-07 | No incident response plan, register or breach-notification duty | High | Missing documented process | CC7.3, CC7.4, CC7.5, CC2.3 | - |
| G-08 | Nobody is alerted: no alerting, no uptime monitoring, shipper not on 205 | High | Missing technical control | CC7.2, A1.1 | - |
| G-10 | No approved security policies, objectives or named security owner | High | Missing documented process | CC1.3, CC2.2, CC3.1, CC5.1, CC5.3 | - |
| G-11 | No risk assessment, risk register or risk-acceptance records | High | Missing documented process | CC3.1-CC3.4, CC4.2 | D-005, D-011, D-018 open |
| G-12 | Change management: one approver, one author, no CI, no staging | High | Missing technical control | CC8.1, CC4.1, CC5.2 | R-12 |
| G-13 | Authentication: no MFA, weak password rules, default import password | High | Missing technical control | CC6.1, CC6.2 | D-011, D-036, VA-API-02, VA-API-03, VA-ADM-02 |
| G-14 | No access request / leaver process and no access reviews | High | Missing documented process | CC6.2, CC6.3 | R-3, VA-API-09 |
| G-15 | Privileged access: shared admin account, key custody, service-role key everywhere | High | Missing technical control | CC6.1, CC1.5 | - |
| G-16 | No data classification; no confidential tier for HR / finance tickets | High | Missing documented process | C1.1, CC6.3 | D-005 |
| G-18 | No vendor risk management | High | Missing documented process | CC9.2 | VA-API-05 |
| G-19 | No standing vulnerability management or patching | High | Missing technical control | CC7.1, CC6.8 | VAPT-DEP-01, D-038 |
| G-21 | Production configuration unverified (login service, proxy hops, secrets, migrations live) | High | Control exists but not proven | CC7.1, CC6.1, CC5.2 | VA-DB-08, R-11, D-036, D-029, D-017, D-061 |
| G-09 | Nobody is assigned to review logs | Medium | Missing documented process | CC7.2, CC7.3, CC2.1 | - |
| G-17 | Least-privilege residuals at the database | Medium | Missing technical control | CC6.3, CC3.3 | VA-TKT-01 (rest), R-1, VA-DB-03 (rest), VA-ADM-03, R-2, VA-DB-06/07/10, R-4, VA-TKT-02, VA-TKT-09 |
| G-20 | No malware scanning for uploads | Medium | Missing technical control | CC6.8 | (VIRUS_SCAN_HOOK) |
| G-22 | Session and abuse controls weak (no idle timeout, in-memory limits, token valid after deactivation) | Medium | Missing technical control | CC6.1, CC6.2, CC6.6 | R-3, VA-API-03, D-017, D-037 |
| G-23 | Retention and disposal not enforced; retired-server and developer copies | Medium | Missing technical control | CC6.5, C1.2 | - |
| G-24 | Physical and environmental security not evidenced | Medium | Missing organisational evidence | CC6.4, A1.2 | - |
| G-25 | HR controls not evidenced (screening, NDA, training, discipline) | Medium | Missing organisational evidence | CC1.4, CC1.5 | - |
| G-26 | Ethics, oversight and structure not evidenced | Medium | Missing organisational evidence | CC1.1-CC1.5 | - |
| G-27 | Capacity not monitored; no availability commitment | Medium | Missing technical control | A1.1 | R-8, D-066 |
| G-28 | System Log not protected from the database owner; audit coverage holes | Medium | Missing technical control | CC7.2, CC2.1 | R-8, D-032 |
| G-29 | No ongoing control evaluation or internal audit | Medium | Missing documented process | CC4.1, CC4.2, CC5.1 | R-12 |
| G-31 | Key and secret management weak | Medium | Missing technical control | CC6.1, C1.1 | VA-API-05, D-029, D-058 |
| G-32 | Communication: no staff awareness, no security contact, no disclosure channel | Medium | Missing documented process | CC2.2, CC2.3 | - |
| G-33 | Encryption at rest and on internal links not evidenced | Medium | Control exists but not proven | CC6.7, C1.1 | - |
| G-34 | Fraud risk and segregation of duties not documented; approval side doors | Medium | Missing documented process | CC3.3, CC6.3 | VA-TKT-07, D-030, VA-TKT-02 |
| G-35 | Dev PC / admin PC endpoint security and production-like copies | Medium | Missing organisational evidence | CC6.8, CC6.4, C1.2 | - |
| G-30 | Stale and conflicting documents | Low | Missing documented process | CC5.3, CC3.4 | - |
| G-36 | Scope decisions for Processing Integrity and Privacy pending | Info | Missing documented process | (PI1, P1-P8 not in matrix) | - |

### Counts (36 gaps, from the table above)

| Severity | Count | | Type | Count |
|---|---|---|---|---|
| Critical | 1 | | Missing technical control | 14 |
| High | 17 | | Missing documented process | 13 |
| Medium | 16 | | Control exists but is not proven | 3 |
| Low | 1 | | Missing organisational evidence | 4 |
| Info | 1 | | Actual control failure | 2 |
| **Total** | **36** | | **Total** | **36** |

No score or percentage is calculated.

---

## Part 2. Detailed gaps (in priority order)

### G-02 — Production runs a web framework with a published critical advisory
- **Plain language:** The web framework Next.js 16.2.9, which runs on the production server, has published security advisories, including one that could let an outsider run code on a **Windows** host (GHSA-p293-qw3h-jr36, CVSS 9.0, fixed in 16.3.3). The production server is Windows and reachable from the internet. Nobody had a routine that would have caught this; it was found by the VAPT.
- **Severity:** Critical. **Type:** Actual control failure (the patching control did not prevent a known-critical component in production).
- **Criteria:** CC6.6, CC7.1, CC8.1. **Links:** VAPT-DEP-01. **Evidence:** A (`npm audit --omit=dev`: before 9 findings incl. 1 critical, after 2 moderate in the local branch); production state is class D (build 20261015-145217, main `717e5c6`).
- **Recommendation:** The upgrade to 16.3.8 is built and tested **locally only**. It needs the owner's explicit OK and the normal release procedure; do not deploy from this assessment. Until released, treat it as an accepted, time-limited risk with a recorded owner (G-11).
- **Effort:** low (already done locally); needs release decision. *Owner: to be assigned by management.*

### G-01 — No HTTPS, non-secure cookies, CSP not enforced
- **Plain language:** Staff open CKDesk at `http://182.72.84.10:3210`. Without HTTPS, passwords, session cookies and tickets can be read or changed by anyone on the network path. The site cookie is not marked `Secure` and lasts 400 days. The browser security policy (CSP) only reports problems; it blocks nothing.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC6.1, CC6.6, CC6.7, C1.1.
- **Links:** VA-API-01, D-018, D-037, D-033. **Evidence:** B/D; status "Requires Decision" (needs a certificate and a reverse proxy; the owner has called HTTPS a "later option").
- **Recommendation:** decide on a DNS name and certificate (internal CA or public); put TLS in front of the proxy; then set `Secure` cookies, HSTS and enforce the CSP after reading its reports. If HTTPS is not possible soon, restrict access to the internal network or a VPN and record the risk acceptance.

### G-03 — Other assessment fixes are LOCAL only
- **Plain language:** The VAPT reproduced several real weaknesses on the isolated copy and fixed them in the local branch (database migration `…164_vapt_security_hardening.sql` and code). Examples: a technician or manager could change a ticket's priority or SLA deadline straight through the data API; any employee could read every colleague's mobile number; a file attached to an internal note was visible to the requester; a signed-in user could switch off their own "must change password" flag; unauthenticated callers could flood the System Log. None of these fixes is in production.
- **Severity:** High. **Type:** Actual control failure (weaknesses were reproduced before the fix; production is assumed to match the audit schema — **management/DBA to confirm on production**).
- **Criteria:** CC6.1, CC6.3, CC6.6, CC8.1. **Links:** VA-DB-01, VA-DB-02, VA-DB-03, VA-DB-04, VA-DB-05, VA-DB-07 (mobile numbers), VA-TKT-01, VA-TKT-03/04/05/08, VA-INT-01/02/03/05/06/13, VA-API-02/04/07/08/09/10, VA-ADM-01/04/05/07 (see the status table, section A). **Evidence:** A (T10, T11, T12, TU, TB, H).
- **Recommendation:** release as one reviewed batch with a rollback script, after the owner's OK, applying migration first or app first as the batch notes say; restart PostgREST after the migration; re-test; record the release.
- **Effort:** medium; needs owner approval and a change window.

### G-04 — No second backup copy; backup script, vault key and settings not backed up
- **Plain language:** The only backup of the database is on the same database server (drive E:) for 30 days. If that server is lost, burned or encrypted by malware, the backups go with it. The backup script is not in the repository. The backup does not include the key that opens the stored mailbox password, so a restore would need new secrets typed in. Configuration files of the app server are not backed up. The NAS has no described backup either.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** A1.2, CC9.1, CC7.5. **Evidence:** D (runbook §6, §10: "Not done yet", deferred by the owner).
- **Recommendation:** second copy on a separate share with a backup-only account (the owner's own proposal: 03:15, about 90 days, snapshots); add the vault key, DB settings and configuration files to a protected backup; store `backup-db.ps1` in the repo; alert on failure (G-08).

### G-05 — No restore test, no recovery objectives
- **Plain language:** A backup nobody has restored is a hope. The written restore steps have never been recorded as tested, and no target says how fast recovery must be (RTO) or how much data loss is acceptable (RPO).
- **Severity:** High. **Type:** Control exists but is not proven. **Criteria:** A1.3, CC7.5.
- **Recommendation:** restore last night's dump into a scratch database, open the app against it, and write a dated record with the person's name; repeat monthly; set RTO / RPO with the owner. **Do not create a record until the test has really been done.**

### G-06 — No continuity or disaster recovery plan
- **Plain language:** One app server, one database server (shared with other apps), one NAS, one router and one shared mailbox. If any one fails, there is no written plan and no fallback. The reboot test of the app server is still an open item.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC9.1, A1.2, CC7.5.
- **Recommendation:** short BC / DR plan: what matters most, who decides, how to rebuild from the runbook, contact list, alternative mail route; reboot test; decide whether any redundancy is worth the cost.

### G-07 — No incident response plan or register
- **Plain language:** If someone's account is abused or data leaks, there is no written way to decide it is an incident, who is called, what is told to whom, or how lessons are kept. Only the WhatsApp pilot has a small "daily checks" runbook, and it names no person.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC7.3, CC7.4, CC7.5, CC2.3.
- **Recommendation:** a plain two-page plan (severity levels, roles, contacts, evidence handling, notification duties); a security incident register (empty is fine); an exercise that is **recorded only when it actually happens**.

### G-08 — Nobody is alerted
- **Plain language:** The System Log records a lot (failed sign-ins, role changes, invalid webhook signatures, errors), but nothing sends an e-mail or message when something serious happens. A failed backup, a stopped service or a burst of failed logins would sit in a table until someone looks. The log shipper runs on 98 but is not set up on 205, so the database log and `backup.log` are not captured.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC7.2, A1.1.
- **Recommendation:** alert rules for `critical` rows, backup failure, service down (uptime probe on `/api/health`), failed-sign-in bursts; run the shipper on 205; name who receives alerts.

### G-10 — No approved security policies, objectives or named security owner
- **Plain language:** There is no approved information security policy, acceptable-use rule, or statement of what CKDesk must protect. The rules that exist (`CLAUDE.md`) are working rules for the developer. No one is named as security owner.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC1.3, CC2.2, CC3.1, CC5.1, CC5.3.
- **Recommendation:** management appoints an owner, then approves a short policy set (security, access, change, backup, incident, vendor, retention, acceptable use). Any draft remains "DRAFT — not approved" until signed.

### G-11 — No risk assessment, register or acceptance records
- **Plain language:** Several security reviews found many issues, but no list of risks with owners, ratings and decisions exists. Decisions the owner has left open (D-005, D-011, D-018, D-037, D-036) have no recorded acceptance or deadline.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC3.1-CC3.4, CC4.2.
- **Recommendation:** build a risk register from the findings and this gap list; record accepted risks with approver, date and expiry; review quarterly.

### G-12 — Change management depends on one person and manual checks
- **Plain language:** One person writes the code (all 271 commits share one author identity), approves it, builds it and deploys it. Tests and type checks run only when someone runs them. There is no automated pipeline, no second reviewer, no staging server, no release register or tag, and no test result is kept per release. Some `main` commits are labelled "LOCAL TRIAL (not merged)" although they are in `main`. The strengths: strong test suite, build gate, written rollback, disposable audit stack.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC8.1, CC4.1, CC5.2. **Links:** R-12.
- **Recommendation:** CI to run type check, lint, tests and `npm audit` on each change; a second person (or documented compensating review) before production; release register (build id, approver, tests); tags; staging copy; rehearsed rollback.

### G-13 — Authentication is password only and weak at the edges
- **Plain language:** Login is by password alone (no second factor). The app enforces only 8 characters; the login service's own rule is unverified in production (the local config says 6). Bulk-imported users get a fixed default password unless one is typed. There is no account lockout beyond a short in-memory delay.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC6.1, CC6.2. **Links:** D-011, D-036, VA-API-02 (flag fixed LOCAL; default password open), VA-API-03 (partial), VA-ADM-02.
- **Recommendation:** MFA at least for admins, platform owners, managers and technicians; password rules set in the login service (minimum length, re-authentication on change); random one-time passwords or invitation links instead of a default; confirm no live account still uses the default (a **read-only production check by the DBA**, not done here).

### G-14 — No access request / leaver process and no access reviews
- **Plain language:** Accounts are created by admins and deactivated by admins (a good design), but nothing says who must ask first, how fast a leaver must be removed, or that someone checks the list of admins and platform owners regularly. The Users screen can export the list, which is the raw material for a review.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC6.2, CC6.3. **Links:** R-3, VA-API-09 (LOCAL fix).
- **Recommendation:** written joiner / mover / leaver procedure with HR trigger and a one-working-day target; quarterly access review of all non-requester roles with a signed record; ask the CPA which sample they will use.

### G-15 — Privileged access is shared and thinly controlled
- **Plain language:** Server administration is by ssh as the built-in Windows `Administrator` account with one key on one PC. The server code uses an all-powerful database key (service role) in 104 files. Two platform owners can create admins. No break-glass procedure, no log review of server logins, no separate admin accounts.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC6.1, CC1.5.
- **Recommendation:** named administrator accounts; list of key holders; protect the ssh key (passphrase, disk encryption); review use of the service-role key to reduce the number of places; log server logins; record who holds the `postgres` password.

### G-16 — No data classification; no confidential tier for HR / finance tickets
- **Plain language:** Every manager, admin and platform owner can read every team's tickets. HR and finance tickets get the same treatment as a printer request. No labels, no handling rules.
- **Severity:** High. **Type:** Missing documented process (and a pending owner decision). **Criteria:** C1.1, CC6.3. **Links:** D-005.
- **Recommendation:** decide the classification levels; add a "restricted team" setting; decide how reports treat restricted teams.

### G-18 — No vendor risk management
- **Plain language:** Google (mail), Meta (WhatsApp), DeskTime, possibly Groq, the ISP and others receive or carry Citykart data. There is no list of them, no contract review, no check of their security reports, and no exit plan. The DeskTime key is sent in a web address, and one shared secret is reused as a fallback for several purposes.
- **Severity:** High. **Type:** Missing documented process. **Criteria:** CC9.2. **Links:** VA-API-05.
- **Recommendation:** supplier register (see `SOC2-SYSTEM-BOUNDARY.md` §8); contracts; review dates; list of enabled integrations; dedicated secrets.

### G-19 — No standing vulnerability management or patching
- **Plain language:** Vulnerability checks happened as one-off projects. There is no schedule for dependency checks, no code scanning, no secret scanning, no operating-system / PostgreSQL / Node patch cycle, no external penetration test. The Node version on the app server is not recorded.
- **Severity:** High. **Type:** Missing technical control. **Criteria:** CC7.1, CC6.8. **Links:** VAPT-DEP-01, D-038. **Evidence:** A (31 findings in all dependencies on 2026-10-15: 4 critical, 17 high, 9 moderate, 1 low).
- **Recommendation:** monthly patch window with a record; dependency bot and CI scan; secret scan; yearly external test; record software versions per server.

### G-21 — Production configuration is not verified
- **Plain language:** Many decisive settings live only on the servers: whether sign-up is disabled in the login service, the password rules, `TRUSTED_PROXY_HOPS` (without it the per-address login limit is off), `APPROVAL_LINK_SECRET`, cookie flags, whether migrations 156-163 and the unique index of 162 are live. The repository cannot show them.
- **Severity:** High. **Type:** Control exists but is not proven. **Criteria:** CC7.1, CC6.1, CC5.2. **Links:** VA-DB-08 (Not Verified), R-11, D-036, D-029, D-017, D-061, D-045.
- **Recommendation:** the DBA / server owner supplies read-only extracts: service settings with secrets removed, `auth.schema_migrations`, index list, scheduled-task list; store a sanitised baseline in the repo.

### G-09 — Nobody is assigned to review logs
- **Plain language:** Logs exist; no one is required to read them.
- **Severity:** Medium. **Type:** Missing documented process. **Criteria:** CC7.2, CC7.3, CC2.1.
- **Recommendation:** named reviewer, weekly review of `security` and `error` rows, sign-off note, escalation rule.

### G-17 — Least-privilege residuals at the database
- **Plain language:** The screens limit who can do what, but the database still lets some roles do more through direct API calls: a technician or manager can change the assignee, description, resolved dates and category of tickets; managers can write about twenty configuration tables and shared settings; requesters can read the staff list and workflow definitions; any signed-in user can write into the task-attachments store.
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC6.3, CC3.3. **Links:** VA-TKT-01 (rest), R-1, VA-DB-03 (rest), VA-ADM-03, R-2, VA-DB-06/07/10 (rest), R-4, VA-TKT-02, VA-TKT-09. **Evidence:** A/B.
- **Recommendation:** column-level grants and server-only writes for the listed tables; owner decision on who may edit shared settings and author Business Rules.

### G-20 — No malware scanning for uploads
- **Plain language:** Uploaded files are checked by type and size but not scanned. The place for a scanner is only a code comment.
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC6.8.
- **Recommendation:** scan uploads and e-mail attachments (for example ClamAV on the NAS or app server) and quarantine; confirm antivirus on servers.

### G-22 — Sessions and abuse controls are weak
- **Plain language:** No idle timeout; cookies last 400 days; a deactivated person's open login may still work for server actions up to an hour; login and reset limits are held in memory and reset on restart; per-address limits need a setting that is not documented.
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC6.1, CC6.2, CC6.6. **Links:** R-3, VA-API-09 (LOCAL fix), VA-API-03, D-017, D-037.
- **Recommendation:** idle and absolute timeouts; shorter token life for admins; set `TRUSTED_PROXY_HOPS`; decide on lock-out; release VA-API-09.

### G-23 — Retention and disposal are not enforced
- **Plain language:** Retention periods for tickets, attachments and notifications are stored but nothing applies them; there is no delete or anonymise function; the retired server and its archive database still exist; developer PCs hold dump files.
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC6.5, C1.2.
- **Recommendation:** decide retention; build an archive / anonymise job; decommission checklist and deletion date for the old server; control and delete developer dumps.

### G-24 — Physical and environmental security not evidenced
- **Plain language:** Nothing in the repository says where the servers and NAS sit, who can enter, what protects them from fire, power loss or theft, or whether the backup disks share the room.
- **Severity:** Medium. **Type:** Missing organisational evidence. **Criteria:** CC6.4, A1.2.
- **Recommendation:** facility description, access list, visitor and maintenance logs, UPS and fire details; backup disks in a separate place.

### G-25 — HR controls not evidenced
- **Plain language:** Staff screening, confidentiality terms, security training and discipline are HR matters that the repository cannot show.
- **Severity:** Medium. **Type:** Missing organisational evidence. **Criteria:** CC1.4, CC1.5.
- **Recommendation:** HR supplies the records; a short security awareness session for admins and technicians; leaver confidentiality reminder.

### G-26 — Ethics, oversight and structure not evidenced
- **Plain language:** There is no evidence of a code of conduct, board oversight of IT risk, or a documented reporting structure for CKDesk.
- **Severity:** Medium. **Type:** Missing organisational evidence. **Criteria:** CC1.1-CC1.5.
- **Recommendation:** management supplies existing documents; quarterly report of this assessment's results to the owner / board.

### G-27 — Capacity is not monitored; no availability commitment
- **Plain language:** The system was load-tested with synthetic data, but target-scale capacity was "not verified" in the 2026-09-17 acceptance, and no tool watches CPU, memory, disk or connections. No promise on uptime exists. Migration 160's logging lock may slow busy periods (not measured).
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** A1.1. **Links:** R-8, D-066.
- **Recommendation:** monitor key resources; re-run the load profile on the current schema; state an availability target (see `SOC2-TSC-APPLICABILITY.md`).

### G-28 — System Log protection and coverage holes
- **Plain language:** The log is tamper-evident (hash chain), but a database owner can switch the protection off, and no copy is kept elsewhere. Tasks, projects, mobile numbers and SLA deadline columns are not trigger-audited (the deadline hole matters for R-1).
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC7.2, CC2.1. **Links:** D-032 (partial), R-8.
- **Recommendation:** send audit rows to a second location; add missing tables to the audit trigger list; periodic chain verification record.

### G-29 — No ongoing evaluation of controls
- **Plain language:** Nobody regularly checks that the controls still work. Tests are manual and none is recorded after the latest local commits.
- **Severity:** Medium. **Type:** Missing documented process. **Criteria:** CC4.1, CC4.2, CC5.1. **Links:** R-12.
- **Recommendation:** control self-assessment each quarter using the matrix; record test results per release.

### G-31 — Key and secret management is weak
- **Plain language:** One JWT secret is shared across services; anon and service-role keys last 10 years; several features fall back to `CRON_SECRET`; secrets sit in plain files on the server; the vault key is a database setting with no escrow or rotation.
- **Severity:** Medium. **Type:** Missing technical control. **Criteria:** CC6.1, C1.1. **Links:** VA-API-05, D-029, D-058.
- **Recommendation:** dedicated secrets per purpose; rotation procedure and schedule; secure escrow of the vault key; restrict file permissions on the secret files.

### G-32 — Communication gaps
- **Plain language:** Staff are not told their security duties, there is no security contact or "report a problem" route, and no vulnerability disclosure channel.
- **Severity:** Medium. **Type:** Missing documented process. **Criteria:** CC2.2, CC2.3.
- **Recommendation:** short staff notice; security category in CKDesk; a security mailbox.

### G-33 — Encryption at rest and on internal links not evidenced
- **Plain language:** We cannot tell whether the database disk, NAS volume or backups are encrypted, or whether app-to-database and NAS traffic is encrypted. Config templates use plain local connections.
- **Severity:** Medium. **Type:** Control exists but is not proven. **Criteria:** CC6.7, C1.1.
- **Recommendation:** DBA / NAS owner confirm and document; enable TLS and disk encryption where missing.

### G-34 — Fraud risk and separation of duties are not documented
- **Plain language:** Self-approval is blocked, but delegating or adding approvers can still route around it; managers can author Business Rules that change priority and status; the same person develops, approves and deploys.
- **Severity:** Medium. **Type:** Missing documented process. **Criteria:** CC3.3, CC6.3. **Links:** VA-TKT-07, D-030 (partial), VA-TKT-02.
- **Recommendation:** document fraud scenarios; close side doors; add a second approver for sensitive changes.

### G-35 — Developer / admin PC and production-like copies
- **Plain language:** The dev PC builds releases, holds the ssh key and keeps dump files of production-like data. Disk encryption, screen lock and antivirus are not stated.
- **Severity:** Medium. **Type:** Missing organisational evidence. **Criteria:** CC6.8, CC6.4, C1.2.
- **Recommendation:** confirm endpoint controls; delete old dumps; protect the key.

### G-30 — Stale and conflicting documents
- **Plain language:** Several documents still describe the retired server or old setups, so a new person might follow wrong instructions.
- **Severity:** Low. **Type:** Missing documented process. **Criteria:** CC5.3, CC3.4.
- **Recommendation:** mark old documents as history; keep one source of truth with a review date.

### G-36 — Scope decisions pending (Processing Integrity, Privacy)
- **Plain language:** Whether these categories apply depends on management answers (see `SOC2-TSC-APPLICABILITY.md`). Privacy-related gaps (no notice, no subject-access process, no deletion function, DeskTime monitoring notice) exist regardless of the SOC 2 choice.
- **Severity:** Info. **Type:** Missing documented process. **Criteria:** not in the matrix.
- **Recommendation:** decide; start a separate privacy review.

---

## Part 3. Suggested order of work

| Step | Items | Why first |
|---|---|---|
| 0. Owner decisions (no code) | D-005, D-011, D-018/D-037, D-036; release go-ahead for G-02 and G-03; name owners | Everything else waits on these |
| 1. Safe evidence-gathering | G-21, G-05, G-04 (read-only checks and a restore test by the DBA) | Turns "not proven" into evidence |
| 2. Release the LOCAL fixes | G-02, G-03 with rollback | Closes the only Critical item |
| 3. Alerting and incident basics | G-08, G-07, G-09 | Needed before anything can be called monitored |
| 4. Governance documents | G-10, G-11, G-14, G-18, G-06 | Largest share of "Design gap" results |
| 5. Hardening | G-01, G-13, G-15, G-17, G-19, G-22, G-31 | Needs time and sometimes a decision |
| 6. Hygiene | remaining Medium / Low | |

---

## Open questions / evidence requests for management

1. Give the **owner's decision** (accept, schedule or reject, with dates) for each of: G-01 (HTTPS), G-02 and G-03 (release), G-13 (MFA and default password), G-16 (D-005), G-17 (shared settings and Business Rules).
2. Name the **person** for each gap's owner (suggested roles are in the matrix).
3. Provide the **read-only production extracts** for G-21 (login-service settings without secrets, `auth.schema_migrations`, index list for migration 162, scheduled tasks list, Node version, `TRUSTED_PROXY_HOPS` value).
4. Provide the **backup script, 30 days of backup logs**, and permit a **restore test** into a scratch database (G-04, G-05).
5. Provide any **existing incident plan, risk register, policies, vendor contracts** — or confirm none exists (G-07, G-10, G-11, G-18).
6. Provide the **facility** and **HR** evidence (G-24, G-25, G-26).
7. Confirm whether **any live account still uses the default password** (to be checked by the DBA read-only; do not share the password).
8. State the **target dates** you will commit to for the High items, so a CPA can see a plan.
