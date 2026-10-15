# SOC 2 Type I Readiness - Control Design Matrix (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

A SOC 2 **Type I** report is about **design at one date**: "are the controls described suitably designed to meet the criteria?" (A Type II report adds whether they *operated* over a period; that is not assessed here.) This matrix goes criterion by criterion. For each it records the risk, what CKDesk actually has (with file references), who should own it, what a good design would achieve, the evidence class, any test performed, a result, the gap and the recommended correction.

**The criterion wording is a paraphrase.** The AICPA Trust Services Criteria text is licensed; every paraphrase here is **PROVISIONAL — confirm against the licensed standard**. Criterion numbers (CC1.1-CC9.2, A1.1-A1.3, C1.1-C1.2) are as commonly cited.

**Nothing from this assessment is deployed.** Production runs build 20261015-145217 (main `717e5c6`). Where a fix exists only in the local assessment branch, the row says "LOCAL only" and the result is judged on what production has.

### Evidence classes
**A** verified LOCAL technical test (our tests on the isolated stack) · **B** repository (source, migrations, scripts) · **C** authorised organisational evidence (approved policies, access-review records, backup / restore records, training records, management approvals — **none supplied**) · **D** documentation only · **E** missing / not verified. A script or document existing is **not** proof it operates.

### Result definitions (used consistently)
- **Suitably designed** — a design is in place that, on its face, meets the criterion's objective, with no known deficiency. (Operation still needs class C evidence.)
- **Design gap** — a design exists but is deficient, **or** repository / documents positively show the control absent, deferred or open, **or** it is a control the CKDesk team would own and nothing is documented.
- **Not verified — evidence class C required** — the control would be held by people or sites outside the repository (HR, board, premises) and nothing in the repository shows it absent; it cannot be judged without management evidence.

### Gap references
`G-nn` refers to the gap list in `SOC2-TYPE-I-GAP-ASSESSMENT.md`. VAPT finding IDs (`VA-…`, `VAPT-DEP-01`) are from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`; `D-nnn` and `R-n` are from `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`. Test labels: T10, T11, T12 (`tests/vapt/…`), TU (`tests/unit/vapt-hardening-units.test.ts`), TB (`tests/unit/approval-code-burst.test.ts`), H (HTTP probes against the rebuilt audit app, logged in `02-VAPT/04-MANUAL-PENETRATION-TESTING.md`). "Inv. §n" is `01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md`. **Owner** cells are placeholders: *Owner: to be assigned by management*.

---

## Part 1. Summary table (all 38 criteria)

"What exists" is a plain strength rating of the design elements found: **Strong** (well built and tested locally), **Partial**, **Weak**, **None found**.

| Criterion | Short title | What exists | Result | Main gaps |
|---|---|---|---|---|
| CC1.1 | Integrity and ethical values | None found in repo | Not verified | G-26 |
| CC1.2 | Board / oversight of controls | None found in repo | Not verified | G-26 |
| CC1.3 | Structure, reporting lines, authority | Weak | Design gap | G-10, G-26 |
| CC1.4 | Competence | None found in repo | Not verified | G-25, G-26 |
| CC1.5 | Accountability | Partial (actions attributed in System Log) | Not verified | G-25, G-26 |
| CC2.1 | Quality information for control | Partial | Design gap | G-09, G-28 |
| CC2.2 | Internal communication | Weak | Design gap | G-10, G-32 |
| CC2.3 | External communication | None found | Design gap | G-07, G-32 |
| CC3.1 | Objectives specified | None found | Design gap | G-10, G-11 |
| CC3.2 | Risk identification and analysis | Partial (three security reviews, no register) | Design gap | G-11 |
| CC3.3 | Fraud risk | Weak | Design gap | G-34 |
| CC3.4 | Changes affecting control | Weak | Design gap | G-11, G-12 |
| CC4.1 | Ongoing / separate evaluation | Partial (tests, this assessment) | Design gap | G-29 |
| CC4.2 | Deficiency communication | Partial (defect registers) | Design gap | G-11, G-29 |
| CC5.1 | Control activities selected | Partial | Design gap | G-10, G-29 |
| CC5.2 | General technology controls | Partial | Design gap | G-12, G-19, G-21 |
| CC5.3 | Policies and procedures | Weak | Design gap | G-10 |
| CC6.1 | Logical access security | Partial (strong inside, weak at the edge) | Design gap | G-01, G-13, G-15, G-31 |
| CC6.2 | Registration / removal of users | Partial | Design gap | G-13, G-14 |
| CC6.3 | Role-based access, least privilege, SoD | Strong in code, residuals | Design gap | G-16, G-17, G-34 |
| CC6.4 | Physical access | None found in repo | Not verified | G-24 |
| CC6.5 | Disposal / end of protection | Weak | Design gap | G-23 |
| CC6.6 | Threats from outside the boundary | Partial | Design gap | G-01, G-02, G-03, G-22 |
| CC6.7 | Movement / transmission of information | Partial | Design gap | G-01, G-33 |
| CC6.8 | Malicious software | Weak | Design gap | G-19, G-20, G-35 |
| CC7.1 | Detect vulnerabilities / config change | Weak | Design gap | G-02, G-19, G-21 |
| CC7.2 | Monitor for anomalies | Strong logging, no alerting | Design gap | G-08, G-09, G-28 |
| CC7.3 | Evaluate security events | None found | Design gap | G-07, G-09 |
| CC7.4 | Respond to incidents | None found | Design gap | G-07 |
| CC7.5 | Recover from incidents | Weak | Design gap | G-04, G-05, G-06 |
| CC8.1 | Change management | Partial (strong tests, one-person approval) | Design gap | G-12, G-03 |
| CC9.1 | Business disruption mitigation | Weak | Design gap | G-04, G-06 |
| CC9.2 | Vendor and partner risk | None found | Design gap | G-18 |
| A1.1 | Capacity management | Weak | Design gap | G-27 |
| A1.2 | Environmental protection, backup, recovery infrastructure | Partial (nightly dump) | Design gap | G-04, G-05, G-06, G-24 |
| A1.3 | Test recovery procedures | None found | Design gap | G-05 |
| C1.1 | Identify and maintain confidential information | Partial (technical separation) | Design gap | G-16 |
| C1.2 | Dispose of confidential information | Weak | Design gap | G-23 |

### Counts of criteria by result (from the table above — no score is calculated)

| Result | Count | Criteria |
|---|---|---|
| Suitably designed | **0** | none |
| Design gap | **33** | CC1.3, CC2.1-CC2.3, CC3.1-CC3.4, CC4.1-CC4.2, CC5.1-CC5.3, CC6.1-CC6.3, CC6.5-CC6.8, CC7.1-CC7.5, CC8.1, CC9.1-CC9.2, A1.1-A1.3, C1.1-C1.2 |
| Not verified — evidence class C required | **5** | CC1.1, CC1.2, CC1.4, CC1.5, CC6.4 |
| **Total** | **38** | CC: 33, A1: 3, C1: 2 |

**What the zero means.** At criterion level, no criterion can yet be called "suitably designed", mainly because *management-level* design (policies, risk assessment, incident plan, vendor management, backup copy and restore test) is not evidenced, and several access criteria have named residual items. It does **not** mean the technical controls are poor: many individual design elements are strong (see the "What exists" column and Part 3).

---

## Part 2. Criterion-by-criterion matrix

### CC1 — Control Environment

#### CC1.1 — Commitment to integrity and ethical values (paraphrase; PROVISIONAL)
- **Risk addressed:** staff and administrators act without ethical standards; misuse of privileged access goes unchallenged.
- **Control in CKDesk:** none in the repository. Developer rules in `CLAUDE.md` (test locally, explicit OK before push/deploy, never repeat passwords) are conduct rules for the developer and AI assistant, not an organisation code of conduct. (Inv. §1)
- **Control owner:** *Owner: to be assigned by management* (suggested role: HR head / managing director).
- **Design objective:** a written code of conduct and acceptable-use rule, acknowledged by staff, covering use of the help desk and admin rights.
- **Implementation evidence:** E (repo); C needed.
- **Design test performed:** repository search for code of conduct / acceptable use terms; no hit (Inv. §1).
- **Result:** **Not verified — evidence class C required.**
- **Gap:** G-26. A code of conduct may exist in HR; the repository cannot show it.
- **Recommended correction:** supply the HR code of conduct and acknowledgement records; draft an acceptable-use rule covering CKDesk and DeskTime.

#### CC1.2 — Board (or equivalent) independence and oversight of internal control (PROVISIONAL)
- **Risk:** no one independent of management challenges the control environment.
- **Control in CKDesk:** none found. Release approval is by the project owner alone (`CLAUDE.md`). No management-review minutes or internal-audit programme (Inv. §1).
- **Owner:** *to be assigned by management* (suggested: board / owner / audit committee chair).
- **Design objective:** an oversight body that receives security and risk reports on a schedule.
- **Evidence:** E; C needed.
- **Test:** document search only.
- **Result:** **Not verified — evidence class C required.**
- **Gap:** G-26.
- **Correction:** provide board / owner meeting minutes that cover IT risk; set a quarterly review of this assessment's results.

#### CC1.3 — Structures, reporting lines, authorities and responsibilities (PROVISIONAL)
- **Risk:** nobody knows who may approve, who runs what, or who answers for security.
- **Control in CKDesk:** software roles (requester, technician, manager, admin, platform owner) are defined (`lib/constants/roles.ts`); the production runbook assigns tasks by action but names no person; the WhatsApp pilot documents refer to owners "once named" (`PILOT_MONITORING_SCORECARD.md`). No security owner, no RACI (Inv. §1).
- **Owner:** *to be assigned by management* (suggested: managing director).
- **Objective:** named owners for the system, security, data protection, change approval, backups and access review, with deputies.
- **Evidence:** B (software roles), D (runbook), E (job roles).
- **Test:** inventory review.
- **Result:** **Design gap** — the repository itself says no person is named for the pilot owners.
- **Gap:** G-10, G-26.
- **Correction:** appoint and record owners; write a one-page RACI.

#### CC1.4 — Commitment to attract, develop and retain competent people (PROVISIONAL)
- **Risk:** operators and developers lack skill; single-person dependence.
- **Control in CKDesk:** none in repo. All 271 commits carry one author identity (Inv. §5) — a key-person dependency.
- **Owner:** *to be assigned* (HR head).
- **Objective:** role descriptions, training and a succession / cover plan for key IT roles.
- **Evidence:** E; C needed.
- **Test:** document search and git history read.
- **Result:** **Not verified — evidence class C required.**
- **Gap:** G-25, G-26.
- **Correction:** supply role descriptions, training records and cover arrangements; add a second trained deployer.

#### CC1.5 — Holding individuals accountable (PROVISIONAL)
- **Risk:** actions cannot be traced to a person; no consequences for breaches.
- **Control in CKDesk:** technical accountability is **strong in code**: every application action and 45 audited tables write to the append-only System Log with the acting user (`x-actor-id` forwarded), hash chain, verify button (migration 160; Inv. §8). **Not in the repository:** disciplinary process, performance objectives for security. Server administrators use a **shared** built-in `Administrator` account, which weakens individual accountability (Inv. §4).
- **Owner:** *to be assigned* (HR head, IT head).
- **Objective:** individual accountability for system actions and a defined response to violations.
- **Evidence:** A/B (log design), E (HR process); C needed.
- **Test:** audit DB chain verification found no broken link over 24,750 rows (reconciliation D-032, class A).
- **Result:** **Not verified — evidence class C required.**
- **Gap:** G-15 (shared account), G-25, G-26.
- **Correction:** named administrator accounts; HR disciplinary reference to security rules.

### CC2 — Communication and Information

#### CC2.1 — Obtains or generates and uses relevant, quality information (PROVISIONAL)
- **Risk:** control decisions rely on missing or wrong information.
- **Control in CKDesk:** System Log (audit, security, error, event) with redaction of tokens / keys / e-mails / phones, retention, hash chain; `/api/health` and `/api/version`; `/admin/monitoring` page; log shipper from service logs every 2 minutes on 98 (Inv. §8). **Not defined:** who uses these, when, and what triggers action. The shipper on 205 (database log, `backup.log`) is not wired by any repo script.
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** information that supports control is complete, accurate and reviewed.
- **Evidence:** B (code), A (chain intact in audit DB), D; log review records E.
- **Test:** `system_log_verify_chain()` on audit DB (class A); remediation tests 100/104 read (not re-run).
- **Result:** **Design gap.**
- **Gap:** G-09, G-28.
- **Correction:** define a log-review procedure and report; wire the shipper on 205.

#### CC2.2 — Internally communicates information, including objectives and responsibilities (PROVISIONAL)
- **Risk:** staff do not know security responsibilities or how to report issues.
- **Control in CKDesk:** no policy set, no awareness communications, no reporting channel for security events in the repo. Support mailbox `noreply@citykart.org` is a send-only default (`lib/email/config.ts:92`). UAT severity matrix defines severities for defects (2026-06-14) (Inv. §1, §13).
- **Owner:** *to be assigned* (IT head, HR head).
- **Objective:** documented responsibilities and a known route for reporting.
- **Evidence:** D/E.
- **Test:** inventory review.
- **Result:** **Design gap.**
- **Gap:** G-10, G-32.
- **Correction:** publish the approved policy set and a "report a security issue" contact; use CKDesk itself (a security category) for reports.

#### CC2.3 — Communicates with external parties (PROVISIONAL)
- **Risk:** vendors, regulators, auditors and affected people are not told what they must know; breaches go unreported.
- **Control in CKDesk:** none found: no breach notification procedure, legal contacts, vulnerability disclosure channel, vendor communication plan (Inv. §12, §13).
- **Owner:** *to be assigned* (managing director / legal).
- **Objective:** defined external reporting duties and contacts.
- **Evidence:** E.
- **Test:** document search.
- **Result:** **Design gap.**
- **Gap:** G-07, G-32.
- **Correction:** list external obligations (regulator, customers if any, vendors); give security contact; add to the incident plan.

### CC3 — Risk Assessment

#### CC3.1 — Specifies objectives with sufficient clarity to identify risks (PROVISIONAL)
- **Risk:** risks cannot be judged because "what we protect" is undefined.
- **Control in CKDesk:** none written. Implicit objectives appear in runbooks. No ISMS scope or security objectives (Inv. §1).
- **Owner:** *to be assigned* (security owner).
- **Objective:** written security, availability and confidentiality objectives for CKDesk.
- **Evidence:** E.
- **Test:** document search.
- **Result:** **Design gap.**
- **Gap:** G-10, G-11.
- **Correction:** approve objectives using `SOC2-TSC-APPLICABILITY.md` decisions.

#### CC3.2 — Identifies and analyses risks (PROVISIONAL)
- **Risk:** threats to objectives are not identified or ranked.
- **Control in CKDesk:** strong *technical* risk discovery: three earlier security reviews (`docs/AUDIT-2026-08-08.md`, `docs/SYSTEM-AUDIT-2026-09-09.md`, the 2026-10-13 audit with 4 Critical / 27 High findings), the 75-finding reconciliation, and this VAPT. **No** risk register, risk method, owner per risk, or treatment plan (Inv. §7, §1).
- **Owner:** *to be assigned* (security owner).
- **Objective:** a maintained risk register covering technology, vendors, people, facilities.
- **Evidence:** B/D (reviews), E (register).
- **Test:** reconciliation review.
- **Result:** **Design gap.**
- **Gap:** G-11.
- **Correction:** build a risk register from the findings in `05-REMEDIATION/00-FINDING-STATUS-TABLE.md` and the gap list; assign owners and review dates.

#### CC3.3 — Considers the potential for fraud (PROVISIONAL)
- **Risk:** insiders abuse approvals, privileges or data.
- **Control in CKDesk:** technical anti-fraud elements: self-approval blocked (D-030, `lib/approvals/decision.ts:51-53`); target-role guard stops admins editing platform owners (D-009, `lib/admin/target-guard.ts`); status-transition guard; audit trail. **Gaps:** delegation / ad-hoc approver side doors (VA-TKT-07), technician can still edit `assigned_to`, `description` etc. via the data API (VA-TKT-01 rest, R-1), manager-authored Business Rules (VA-TKT-02). No documented fraud risk assessment.
- **Owner:** *to be assigned* (finance head / internal audit).
- **Objective:** fraud scenarios assessed and linked to controls.
- **Evidence:** A (T11 tests for part), B.
- **Test:** T11 integrity exploit tests (L-before/after) cover priority and SLA edits (LOCAL fix only).
- **Result:** **Design gap.**
- **Gap:** G-34, G-17.
- **Correction:** document fraud scenarios; close side doors; decide on VA-TKT-02.

#### CC3.4 — Identifies and assesses changes that could significantly impact internal control (PROVISIONAL)
- **Risk:** big changes (server move, new channel, new vendor) weaken controls unnoticed.
- **Control in CKDesk:** the 2026-10-07 server migration is recorded in detail (`docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §8) and change plans exist for batches (`audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md`). No standing process that assesses the *control impact* of changes; stale documents still describe the retired server (Inv. top note).
- **Owner:** *to be assigned* (change approver).
- **Objective:** each significant change gets a short control-impact review.
- **Evidence:** D.
- **Test:** document review.
- **Result:** **Design gap.**
- **Gap:** G-11, G-12, G-30.
- **Correction:** add a "control impact" line to the release checklist; retire stale documents.

### CC4 — Monitoring Activities

#### CC4.1 — Conducts ongoing and/or separate evaluations (PROVISIONAL)
- **Risk:** controls silently stop working.
- **Control in CKDesk:** 268 test files run by hand (unit 1090 / integration 401 pass / remediation 83, last recorded), isolation-gated audit stack. No CI, no scheduled test, no internal-audit programme; no recorded run after the latest LOCAL commits (R-12). This assessment itself is a **one-off** evaluation (Inv. §6, §7).
- **Owner:** *to be assigned* (security owner / internal audit).
- **Objective:** scheduled evaluations with results kept.
- **Evidence:** B; A for the VAPT runs.
- **Test:** inventory review.
- **Result:** **Design gap.**
- **Gap:** G-29, G-12.
- **Correction:** CI to run type check, lint, tests and `npm audit` on every change; quarterly control self-assessment.

#### CC4.2 — Evaluates and communicates deficiencies in a timely manner (PROVISIONAL)
- **Risk:** known weaknesses stay open without anyone responsible deciding.
- **Control in CKDesk:** defect registers with IDs, severities and statuses (`audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`, `00-FINDING-STATUS-TABLE.md`); items awaiting owner decision (D-005, D-011, D-018, D-037, D-036) are listed. No required time to decide, no escalation, no risk-acceptance record (Inv. §7).
- **Owner:** *to be assigned* (risk owner).
- **Objective:** deficiencies reported to responsible management with target dates and recorded acceptance.
- **Evidence:** D.
- **Test:** register review.
- **Result:** **Design gap.**
- **Gap:** G-11, G-29.
- **Correction:** add owner, due date and acceptance record to each open item; report quarterly.

### CC5 — Control Activities

#### CC5.1 — Selects and develops control activities (PROVISIONAL)
- **Risk:** controls are chosen ad hoc.
- **Control in CKDesk:** controls were chosen mainly through audit findings. No documented control framework before this assessment; this matrix is the first mapping to a standard.
- **Owner:** *to be assigned* (security owner).
- **Objective:** controls selected against risks and mapped to a framework.
- **Evidence:** D.
- **Test:** this mapping.
- **Result:** **Design gap.**
- **Gap:** G-10, G-29.
- **Correction:** adopt the matrix as the control library; approve after management review.

#### CC5.2 — Selects and develops general control activities over technology (PROVISIONAL)
- **Risk:** infrastructure, access and development controls are inconsistent.
- **Control in CKDesk:** layered boundaries (proxy session check, server-side role checks, row-level security, storage rules — baseline §3); build script that fails on local URLs and missing assets; type errors fail the build (`next.config.ts`). Weak: no CI, no scanning, production configuration known only as prose.
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** general IT controls (access, change, operations) defined and automated where possible.
- **Evidence:** A/B/D.
- **Test:** VAPT tests T10/T11/TU and H probes exercise the layers (many LOCAL fixes).
- **Result:** **Design gap.**
- **Gap:** G-12, G-19, G-21.
- **Correction:** CI pipeline; configuration baseline files for services committed (without secrets).

#### CC5.3 — Deploys control activities through policies and procedures (PROVISIONAL)
- **Risk:** controls depend on individuals' memory.
- **Control in CKDesk:** runbook procedures exist (release, rollback, migration, backup, restore, reboot); **no** approved policies; stale documents (Inv. top note).
- **Owner:** *to be assigned* (security owner).
- **Objective:** approved policies and procedures with owners and review dates.
- **Evidence:** D; policies E.
- **Test:** document review.
- **Result:** **Design gap.**
- **Gap:** G-10, G-30.
- **Correction:** approve the draft policy set (see ISO 27001 folder, if produced) — all labelled DRAFT — not approved until management signs.

### CC6 — Logical and Physical Access Controls

#### CC6.1 — Logical access security over assets (PROVISIONAL)
- **Risk:** unauthorised people reach data or systems.
- **Control in CKDesk:** *Inside:* no public sign-up (template `GOTRUE_DISABLE_SIGNUP="true"`); session check on every request except an exact allow-list (`proxy.ts`); signed "verified user" header (`lib/auth/verified-user.ts`); row-level security everywhere (222 policies in audit DB); sign-in rate limits; deactivation bans the login (`lib/actions/admin/users.ts:99-127`). *Weak:* **plain HTTP** (VA-API-01 / D-018); cookies not `Secure`, 400-day life (D-037); **no MFA**, 8-character password, default import password (D-011 / VA-API-02), no lockout, in-memory limiter (Inv. §2.5, §3); 104 files use the service-role key; shared Windows `Administrator` ssh account; 10-year API keys.
- **Owner:** *to be assigned* (IT head).
- **Objective:** only authenticated, authorised people and services reach resources; credentials and keys protected.
- **Evidence:** A (T10/T11/TU/TB/H), B, D.
- **Test:** T10 and T11 reproduced and closed several direct-API bypasses (LOCAL fix only); H: forged-address flood closed; login CSRF closed (VA-API-08).
- **Result:** **Design gap.**
- **Gap:** G-01, G-13, G-15, G-21, G-22, G-31.
- **Correction:** HTTPS with a certificate; MFA for admins / managers / technicians; stronger password rules in the login service; random one-time import passwords; named admin accounts; shorter-lived keys with a rotation procedure.

#### CC6.2 — Registers and authorises new users; removes access when no longer authorised (PROVISIONAL)
- **Risk:** unneeded or unauthorised accounts exist; leavers keep access.
- **Control in CKDesk:** accounts created only by admins (`inviteUser` with invite link e-mail, `bulkCreateUsers` CSV); grants of admin / platform owner only by platform owner (`users.ts:64-69`); seat-limit check; deactivation sets `is_active=false` and bans the login, database treats inactive users as signed out (migration 157; D-010); audit rows. **Missing:** request / approval before account creation, HR-driven leaver trigger, timing target, leaver procedure, user directory sync (Inv. §2). Bulk import uses a fixed default password (D-011 open). A deactivated person's open session may work up to 1 hour for server actions (R-3; LOCAL fix VA-API-09 not live). Signed approval / CSAT links work without login for 7-14 days.
- **Owner:** *to be assigned* (IT head with HR head).
- **Objective:** every account authorised by a manager, removed promptly on leaving, with a record.
- **Evidence:** B; A (target guard unit tests; VA-API-09 CODE only).
- **Test:** target-guard unit test; deactivation covered by remediation 40 (read, not re-run).
- **Result:** **Design gap.**
- **Gap:** G-13, G-14, G-22.
- **Correction:** written joiner / mover / leaver procedure with approval record; HR leaver list within one working day; retire the default password; release VA-API-09.

#### CC6.3 — Role-based access, least privilege and segregation of duties (PROVISIONAL)
- **Risk:** people can do more than their role needs; one person controls a whole process.
- **Control in CKDesk:** five roles; server-side role checks in each action; row-level security; target guard; self-approval refused; column grants and guard triggers (migrations 156-157, 163); VAPT M164 narrows more (mobile numbers, SLA tables, priority, flags) — **LOCAL only**. **Residuals:** any manager / admin / platform owner reads every team's tickets (D-005 open); technician / manager can change assignee, description, form data, resolved dates, category via the data API (VA-TKT-01 rest / R-1); ~20 configuration tables manager-writable and global settings editable by manager / admin in the app (VA-DB-03 rest, VA-ADM-03, R-2); `task-attachments` write open (R-4); requester can read org staff list and workflows (VA-DB-07 rest); the admin "Roles & Permissions" screen is display-only and does not enforce anything (Inv. §1); no access review.
- **Owner:** *to be assigned* (application owner).
- **Objective:** least-privilege roles enforced by the database, reviewed on a schedule.
- **Evidence:** A/B.
- **Test:** T10 and T11 exploit tests (each reproduced before the fix and blocked after it): confidentiality of internal-note attachments, notifications, mobile numbers; integrity of priority, SLA, config tables; M164 fixes verified; residuals documented in the status table.
- **Result:** **Design gap** (largely suitable in design; named residuals and no review).
- **Gap:** G-16, G-17, G-34.
- **Correction:** finish column-level grants; decide D-005; release M164; quarterly access review.

#### CC6.4 — Restricts physical access to facilities and protected information assets (PROVISIONAL)
- **Risk:** theft or tampering with servers, NAS, backup disks and admin PC.
- **Control in CKDesk:** nothing in repo (IP addresses only). Servers 10.0.1.98, 10.0.0.205, NAS 10.0.0.25 and dev PC 10.0.0.47 are named; room, access control, CCTV, visitor records unknown (Inv. §14).
- **Owner:** *to be assigned* (facilities / IT head).
- **Objective:** servers, NAS and backup media in a controlled room with logged access.
- **Evidence:** E; C needed.
- **Test:** none possible from the repository.
- **Result:** **Not verified — evidence class C required.**
- **Gap:** G-24, G-35.
- **Correction:** supply a facility description, access list and visitor / maintenance records; confirm backup disks are in a different location from the servers.

#### CC6.5 — Discontinues logical and physical protections when assets are no longer needed (disposal) (PROVISIONAL)
- **Risk:** retired assets or old data leak.
- **Control in CKDesk:** old server 10.0.1.12 retired and kept disabled; its archive database remains (drop is an open item); final dump kept on 205; developer machine holds dump files (git-ignored). No disposal procedure for media; `retention_policies` not enforced except for the System Log / Event Log; no delete or anonymise function (Inv. §9, §11, §14).
- **Owner:** *to be assigned* (IT head).
- **Objective:** written disposal / decommission steps with records.
- **Evidence:** D/E.
- **Test:** inventory review.
- **Result:** **Design gap.**
- **Gap:** G-23.
- **Correction:** decommission checklist for 10.0.1.12; media disposal rule; enforce retention.

#### CC6.6 — Logical access security measures against threats from outside the boundary (PROVISIONAL)
- **Risk:** attacks from the internet.
- **Control in CKDesk:** router NAT plus a Windows firewall rule on 98; request-size caps on public forms; per-account and (if configured) per-address rate limits; CSP report-only; webhook signatures (WhatsApp HMAC); cron secrets; the port forward exposes the app to the internet over **HTTP**. Production runs a framework version with published unauthenticated RCE advisories on Windows hosts (VAPT-DEP-01 **Critical**, fixed LOCAL only). Per-address limits need `TRUSTED_PROXY_HOPS` (unset = off). No WAF, no intrusion detection, no external scan (Inv. §3, §7).
- **Owner:** *to be assigned* (IT head / network owner).
- **Objective:** minimal exposed surface; patched software; encrypted transport; attack attempts limited and seen.
- **Evidence:** A (H probes), B, D.
- **Test:** H probes: path-suffix bypass (VA-API-04), forged-address log flood (120 rows before / 30 after), login CSRF; all LOCAL fixes.
- **Result:** **Design gap.**
- **Gap:** G-01, G-02, G-03, G-22.
- **Correction:** decision on HTTPS / VPN; upgrade framework in production (needs owner's go-ahead); set `TRUSTED_PROXY_HOPS`; external scan.

#### CC6.7 — Restricts transmission, movement and removal of information; protects it in transit (PROVISIONAL)
- **Risk:** data intercepted or taken out.
- **Control in CKDesk:** exports (CSV / PDF / Excel) are audited for user and log exports; scheduled reports admin-only with recipients limited to organisation addresses (D-012); `sampleTo` restricted to company domain (VA-API-10, LOCAL); outbound SMTP uses STARTTLS; IMAP TLS; outside calls use https. **Not protected:** the browser-to-app link is plain HTTP; the Supabase URL `http://10.0.1.98:8443` is plain; app-to-database TLS and SMB-to-NAS encryption are unstated; no data-loss prevention; DeskTime API key goes in a URL query string (Inv. §3, §11, §12).
- **Owner:** *to be assigned* (IT head).
- **Objective:** data protected in transit and exported only by authorised, recorded actions.
- **Evidence:** B/D.
- **Test:** code read; no network test of production permitted.
- **Result:** **Design gap.**
- **Gap:** G-01, G-33.
- **Correction:** HTTPS; confirm or enable TLS to the database and SMB encryption; send the DeskTime key in a header if the API allows.

#### CC6.8 — Prevents or detects and acts upon unauthorised or malicious software (PROVISIONAL)
- **Risk:** malware via uploads or servers; unapproved software.
- **Control in CKDesk:** upload allow-list (SVG excluded), 25 MB cap, magic-byte check, safe serving with `nosniff` (D-053); **no malware scanning** (`VIRUS_SCAN_HOOK` is only a comment); no endpoint-protection statement for servers, dev PC or admin PC; no allow-list of software; dependency risk covered only by a one-off `npm audit` (31 findings incl. 4 critical in all dependencies; production dependencies 9 → 2 moderate after the LOCAL upgrade) (Inv. §6, §7).
- **Owner:** *to be assigned* (IT head).
- **Objective:** uploaded files and hosts checked for malware; software supply chain monitored.
- **Evidence:** B; A (npm audit before / after).
- **Test:** `npm audit` run on 2026-10-15 (class A for the result).
- **Result:** **Design gap.**
- **Gap:** G-19, G-20, G-35.
- **Correction:** add a scanner for uploads; confirm endpoint protection on servers and admin PC; schedule dependency checks.

### CC7 — System Operations

#### CC7.1 — Detects configuration changes that introduce vulnerabilities; monitors for new vulnerabilities (PROVISIONAL)
- **Risk:** new weaknesses go unseen.
- **Control in CKDesk:** audit triggers record changes to roles, settings, SLA and rules (45 tables); report-only CSP records browser-side problems; past audits exist. **No standing vulnerability scan**: `npm audit` and the VAPT were one-offs; no SAST, secret scan, SBOM or dependency bot; no OS / PostgreSQL / Node / GoTrue patch process; Node version on 98 not in the repo (D-038); no external penetration test (Inv. §7). Critical framework advisories were open in production until found by this VAPT.
- **Owner:** *to be assigned* (security owner).
- **Objective:** regular scanning and patching with tracked results.
- **Evidence:** B (one-off), A (VAPT).
- **Test:** `npm audit` (class A); source reviews.
- **Result:** **Design gap.**
- **Gap:** G-02, G-19, G-21.
- **Correction:** monthly dependency and OS patch review with records; CI scanning; yearly external test.

#### CC7.2 — Monitors system components for anomalies indicating malicious acts, disasters, errors (PROVISIONAL)
- **Risk:** attacks and failures go unnoticed.
- **Control in CKDesk:** strongest area: System Log with append-only trigger, hash chain, `system_log_verify_chain()`, security rows (failed sign-ins, deactivated-login attempts, role changes, invalid webhook signatures, CSP violations), error capture with redaction, spool file when database is down, retention 180 days / 7 years, archiving every 6 hours, "Verify integrity" button. **Missing:** any alert (no e-mail / SMS / push on critical rows, failed backups, bursts of failed sign-ins, service down); `lib/monitoring.ts` is a console stub; no uptime probe; shipper not set up on 205; no one is named to review the log; source IP only stored when `TRUSTED_PROXY_HOPS` is set; no NTP / Windows event log / firewall log collection (Inv. §8).
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** automatic detection with someone notified.
- **Evidence:** B; A (chain verification).
- **Test:** remediation tests 100/104 read; chain check on 24,750 audit rows (class A); H: forged flood now limited.
- **Result:** **Design gap.**
- **Gap:** G-08, G-09, G-28.
- **Correction:** alert rules on `critical` rows and failed backups; uptime probe; named reviewer with weekly review; off-server log copy.

#### CC7.3 — Evaluates security events to determine whether they are incidents (PROVISIONAL)
- **Risk:** events are not triaged; incidents not recognised.
- **Control in CKDesk:** none general. WhatsApp pilot runbook says treat repeated `whatsapp_invalid_signature` as possible probing and tell the "technical escalation owner" (no named person). No severity scheme, no triage procedure, no incident register (Inv. §13).
- **Owner:** *to be assigned* (security owner).
- **Objective:** defined criteria and a log of evaluated events.
- **Evidence:** D/E.
- **Test:** document search.
- **Result:** **Design gap.**
- **Gap:** G-07, G-09.
- **Correction:** incident classification table and register (even if empty).

#### CC7.4 — Responds to identified security incidents (PROVISIONAL)
- **Risk:** slow, uncoordinated response.
- **Control in CKDesk:** none general (no plan, roles, contacts, communication templates, evidence handling). Operational runbook checklists exist (Inv. §13). Past engineering fault reports exist (e.g. 2026-09-22 outage from an asset-path error) but are not security incident records.
- **Owner:** *to be assigned* (security owner).
- **Objective:** a tested incident plan with roles and contacts.
- **Evidence:** E.
- **Test:** none.
- **Result:** **Design gap.**
- **Gap:** G-07.
- **Correction:** draft plan (labelled DRAFT — not approved), assign roles, run a tabletop exercise **and record it only when it really happens**.

#### CC7.5 — Identifies, develops and implements activities to recover from incidents (PROVISIONAL)
- **Risk:** cannot restore service or data after an incident.
- **Control in CKDesk:** application rollback (rename folders); database restore steps written; migration rollback scripts for 156-163 exist; nightly dump; second copy not made; restore test not recorded; vault key and database settings not in the dump, so a restore needs a new key and re-entered secrets; no post-incident review process (Inv. §9).
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** recovery steps that are proven and include lessons learned.
- **Evidence:** D.
- **Test:** none (no restore test exists).
- **Result:** **Design gap.**
- **Gap:** G-04, G-05, G-06, G-07.
- **Correction:** restore test into a scratch database; back up vault key and configuration securely.

### CC8 — Change Management

#### CC8.1 — Authorises, designs, develops, configures, documents, tests, approves and implements changes (PROVISIONAL)
- **Risk:** unauthorised or untested changes break or weaken the system.
- **Control in CKDesk:** written flow (test locally, type check, relevant tests, explicit owner OK, push to `origin/main`, build, deploy, verify `/api/health` and `/api/version`); build script fails on local URLs or missing assets; type errors fail the build; 268 test files; separate disposable audit stack with isolation gate; rollback and migration scripts; release-order notes. **Missing / weak:** one approver and one author identity for all 271 commits (no second reviewer, no pull requests); no CI, so tests / lint / type check are manual; no branch protection evidence; no release register or tags; some commits on `main` are labelled "LOCAL TRIAL (not merged)"; no staging server; no emergency-change procedure; rollback of migrations is not rehearsed; no record of test results per release (R-12) (Inv. §5, §6).
- **Owner:** *to be assigned* (change approver; suggested: IT head, with a developer).
- **Objective:** every production change is approved by someone other than the author (or compensated), tested, recorded and reversible.
- **Evidence:** B/D; test runs A (VAPT).
- **Test:** build gate and test suites exist; T10-T12, TU, TB new tests added by this assessment (LOCAL).
- **Result:** **Design gap.**
- **Gap:** G-12, G-03, G-29.
- **Correction:** CI pipeline; second reviewer for production changes; release register with build id, approver, tests; staging copy; rehearsed rollback.

### CC9 — Risk Mitigation

#### CC9.1 — Identifies, selects and develops risk mitigation for business disruptions (PROVISIONAL)
- **Risk:** a loss of server, database, NAS or site stops the service for long.
- **Control in CKDesk:** single server for each tier, shared servers, no replicas, no failover, no DR plan, no RTO / RPO, no insurance information; nightly dump on the same server (205) as the database; NAS has no described backup; reboot test of 98 still open (Inv. §10, §9).
- **Owner:** *to be assigned* (managing director / IT head).
- **Objective:** a business continuity and recovery plan with targets and tests.
- **Evidence:** D/E.
- **Test:** none.
- **Result:** **Design gap.**
- **Gap:** G-04, G-06.
- **Correction:** BC / DR plan; second backup location; reboot and restore tests.

#### CC9.2 — Assesses and manages risks associated with vendors and business partners (PROVISIONAL)
- **Risk:** a supplier's weakness harms Citykart data.
- **Control in CKDesk:** none: no supplier register, contracts, data terms, SOC / ISO certificates, monitoring or exit plans for Google, Meta, DeskTime, Groq, ISP, NAS support (Inv. §12). Technical: secrets in the vault, WhatsApp signature check, OAuth state signing, outside-call timeouts.
- **Owner:** *to be assigned* (procurement / IT head).
- **Objective:** register, due diligence and periodic review of vendors that touch data.
- **Evidence:** E.
- **Test:** document search; `SOC2-SYSTEM-BOUNDARY.md` §8 lists the vendors.
- **Result:** **Design gap.**
- **Gap:** G-18.
- **Correction:** supplier register with data sent, contract, review date and exit plan.

### A1 — Availability

#### A1.1 — Maintains, monitors and evaluates current processing capacity and use of system components (PROVISIONAL)
- **Risk:** the system slows or fails under load.
- **Control in CKDesk:** load tests with synthetic data; capacity at target scale **not verified** in the 2026-09-17 acceptance; performance work on the audit stack (100k / 500k tickets); migration 160's per-row log lock may slow concurrent updates (R-8, untested); in-process rate limit and caches assume one instance; no capacity monitoring (Inv. §10).
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** capacity monitored and growth planned.
- **Evidence:** D/B.
- **Test:** none by this assessment.
- **Result:** **Design gap.**
- **Gap:** G-27, G-08.
- **Correction:** monitor CPU, memory, disk, connections; re-run the load profile on migration 160.

#### A1.2 — Environmental protections, software, data backup processes and recovery infrastructure (PROVISIONAL)
- **Risk:** hardware, power, software faults destroy data.
- **Control in CKDesk:** nightly `pg_dump` with integrity check, 30 days, backup role; manual pre-migration dumps; NAS RAID / snapshots "the NAS's job" (not described); auto-start services; health endpoint. **Not in place:** second copy outside 205 ("Not done yet", deferred by the owner); backup script not in the repo; no backup of configuration and secrets, scheduled-task definitions, vault key or `.env` files; no backup monitoring alert; no environmental detail (power, UPS, fire) (Inv. §9, §10, §14).
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** automated, monitored backups with an off-site / offline copy and protected infrastructure.
- **Evidence:** D.
- **Test:** none possible (script absent; no production access).
- **Result:** **Design gap.**
- **Gap:** G-04, G-05, G-06, G-24.
- **Correction:** second copy to a separate NAS share with a backup-only user; commit the backup script; include the vault key and settings; alert on `backup.failed`.

#### A1.3 — Tests recovery plan procedures (PROVISIONAL)
- **Risk:** the first time recovery is tried is in a real disaster.
- **Control in CKDesk:** restore steps are written; no dated restore test of a nightly backup exists. The 2026-10-07 migration rehearsal and a `pg_restore --list` readability check are not restore tests (Inv. §9).
- **Owner:** *to be assigned* (IT operations lead).
- **Objective:** regular restore tests with recorded results.
- **Evidence:** E.
- **Test:** none.
- **Result:** **Design gap.**
- **Gap:** G-05.
- **Correction:** monthly restore into a scratch database with a signed record; do **not** record one until it has been done.

### C1 — Confidentiality

#### C1.1 — Identifies and maintains confidential information (PROVISIONAL)
- **Risk:** confidential information is not recognised, so is not protected.
- **Control in CKDesk:** technical separation exists: internal notes (D-015), internal flag on attachments (LOCAL), mobile numbers (LOCAL), vault-encrypted credentials, private storage with RLS (migration 157), scheduled-report recipients limited. **Missing:** a classification scheme; confidential-team tier (D-005 open); data inventory; encryption of data in transit (HTTP) and unstated encryption at rest on 205 / NAS / backups; key management (shared JWT secret, 10-year keys, vault key outside backups) (Inv. §11).
- **Owner:** *to be assigned* (data owner / security owner).
- **Objective:** confidential data identified, labelled, access-limited and encrypted.
- **Evidence:** A (T10), B.
- **Test:** T10 confidentiality exploit tests (before / after) for internal-note attachments, notifications, mobile numbers.
- **Result:** **Design gap.**
- **Gap:** G-16, G-01, G-31, G-33.
- **Correction:** classification scheme; decision on D-005; encryption at rest check; key escrow and rotation.

#### C1.2 — Disposes of confidential information to meet objectives (PROVISIONAL)
- **Risk:** old confidential data stays forever, or is deleted wrongly.
- **Control in CKDesk:** System Log and Event Log retention enforced; the general `retention_policies` (5-year requests, tasks, attachments, etc.) are editable but **no job uses them**; no delete or anonymise function; old tickets may hold passwords (planning note); retired server archive still holds data; developer dumps (Inv. §8, §11, §14).
- **Owner:** *to be assigned* (data owner).
- **Objective:** documented retention and deletion enforced and recorded.
- **Evidence:** B.
- **Test:** grep for use of `retention_policies` — only the settings screen.
- **Result:** **Design gap.**
- **Gap:** G-23.
- **Correction:** retention schedule decision; job to archive or anonymise; deletion of retired-server data.

---

## Part 3. Topic index (where each requested topic is covered)

| Topic | Criteria rows | Strength today | Headline |
|---|---|---|---|
| Governance and oversight | CC1.1-CC1.5, CC2.2 | None found / weak | No policies, owners, oversight evidence |
| Risk assessment | CC3.1-CC3.4 | Partial | Findings exist, no register |
| Access control | CC6.1, CC6.3 | Strong in code, weak at edge | HTTP, no MFA, residual least-privilege items |
| Provisioning / deprovisioning | CC6.2 | Partial | Admin-created accounts, ban on deactivation; no HR trigger or review |
| Privileged access | CC6.1, CC6.3, CC1.5 | Weak operationally | Shared `Administrator`, service-role key in 104 files, 10-year keys |
| Authentication | CC6.1 | Weak | Password only, 8 characters, default import password |
| Change management | CC8.1, CC3.4 | Partial | One approver, no CI, no peer review |
| Secure development | CC8.1, CC5.2, CC7.1 | Partial | 268 tests, type-checked build; no scanning, no standard |
| Vulnerability management | CC7.1, CC6.8 | Weak | One-off scans; critical advisory open in production |
| Monitoring | CC7.2, CC4.1, CC2.1 | Strong logging, no alerting | Nobody is told |
| Incident response | CC7.3-CC7.5, CC2.3 | None found | No plan, no register |
| Availability / backup / recovery | A1.1-A1.3, CC9.1, CC7.5 | Weak | One copy, no restore test, no DR |
| Vendor risk | CC9.2 | None found | No register, no terms |
| Data classification | C1.1 | Weak | No scheme; D-005 open |
| Confidentiality | C1.1, C1.2, CC6.7 | Partial | Good separation, no encryption in transit |
| System operations | CC7.1-CC7.5, A1.1 | Weak | Runbooks, no on-call or alerting |
| Logical security | CC6.1-CC6.3, CC6.6-CC6.8 | Partial | See above |
| Physical security | CC6.4, A1.2 | Not known | Needs evidence from premises owner |

---

## Open questions / evidence requests for management

1. **Policies:** supply the approved information security policy set (or confirm none exists), with approval dates and owners. Drafts are not evidence.
2. **Owners:** name the person (not just role) for each *Owner* placeholder in this matrix.
3. **Oversight:** supply board / owner minutes where IT risk was discussed, and any internal audit plan.
4. **HR:** supply code of conduct, acceptable-use acknowledgements, screening and NDA practice, security training records, disciplinary process.
5. **Access:** supply the joiner / mover / leaver procedure, the last access review (if any), and the current list of admins and platform owners with justification.
6. **Production settings:** supply the login-service settings (sign-up disabled, password minimum, session lifetimes), `TRUSTED_PROXY_HOPS`, and the contents of `auth.schema_migrations` to show which migrations are live.
7. **Backups:** supply `backup-db.ps1`, the last 30 `backup.log` entries, evidence of any restore test, and the plan and date for the second copy.
8. **Incident response:** supply any existing incident plan, contact list and past incident records, or confirm none.
9. **Change management:** supply GitHub branch-protection settings, the list of authorised deployers, and a release register if one exists.
10. **Vendors:** supply contracts and any SOC / ISO reports for Google, Meta, DeskTime, Groq (if used), ISP and NAS support.
11. **Premises:** supply a description of server and NAS locations and the access control for them.
12. **Decisions needed from the owner:** D-005 (confidential teams), D-011 (default password), D-018 / D-037 (HTTPS and cookies), D-036 (password policy in the login service), release of the LOCAL assessment fixes and the framework upgrade.
13. **Risk acceptance:** for each decision management chooses not to act on, supply a signed risk-acceptance record with date and expiry.
