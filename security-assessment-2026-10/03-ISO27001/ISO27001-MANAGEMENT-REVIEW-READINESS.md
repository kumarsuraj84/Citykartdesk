# ISO/IEC 27001:2022 - Management Review Readiness Pack (Clause 9.3) for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

Clause 9.3 of ISO 27001 requires top management to review the ISMS at planned intervals, using defined inputs, and to record decisions and actions. This pack helps management prepare: it lists the inputs the standard expects, proposes an agenda, supplies a **blank** minutes template, and summarises the headline facts available today and the decisions management is being asked to take.

**No management review of information security has been held. Nothing in this file is a record of a review, a decision or an approval.** The minutes template is intentionally blank. The headline inputs in section 4 are facts gathered by the assessment team on 2026-10-15; they are not management's conclusions. No dates, attendees or signatures are filled in and none must be added until a real meeting takes place.

- Evidence classes: A verified local technical test evidence · B repository evidence · C authorised organisational evidence (approved policies, signed records; **none supplied so far**) · D documentation-only · E missing / not verified.
- The list of required inputs reflects the 2022 edition as I understand it. It is PROVISIONAL — confirm against the licensed standard.
- Nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`), which does not contain the assessment's LOCAL fixes. Every "fixed" in this pack means fixed on the isolated local stack only.

---

## 1. Clause 9.3 inputs list and what is available today

| # | Input required (own words) | Available today? | Where | Class |
|---|---|---|---|---|
| 1 | Status of actions from earlier management reviews | No earlier review exists. Record "none" at the first review. | — | E |
| 2 | Changes in external and internal issues relevant to the ISMS | Draft context list | `ISO27001-SCOPE-AND-CONTEXT.md` §2 | D (draft) |
| 3 | Changes in the needs and expectations of interested parties relevant to the ISMS (added in 2022; PROVISIONAL) | Draft inferred list; not confirmed | `ISO27001-SCOPE-AND-CONTEXT.md` §3 | D (draft) |
| 4 | Nonconformities and corrective actions | No register. Defect registers exist. | `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`; `05-REMEDIATION/00-FINDING-STATUS-TABLE.md` | B/D |
| 5 | Results of monitoring and measurement | System Log exists; no metrics or review records | `docs/SYSTEM-LOG.md`; Inv. 8 | B/E |
| 6 | Internal audit results | None; no internal audit held | `ISO27001-INTERNAL-AUDIT-READINESS.md` (proposal only) | E |
| 7 | Fulfilment of information security objectives | No objectives set | — | E |
| 8 | Feedback from interested parties | None collected | — | E |
| 9 | Results of risk assessment and status of the risk treatment plan | No risk assessment; technical findings only | VAPT status table; reconciliation | B/D |
| 10 | Opportunities for continual improvement | Suggested in this pack | Sections 4-5 | D |

Outputs the review must produce: decisions on continual improvement opportunities, and any need for change to the ISMS; actions with owners and dates; resourcing decisions.

---

## 2. Proposed pre-filled agenda (proposal; not a record of any meeting)

Suggested duration: 2 hours for the first review. Chair: top-management sponsor (to be named by management). Secretary: information security lead (to be named).

| Item | Topic | Lead (role) | Input / paper |
|---|---|---|---|
| 1 | Opening: purpose of review, attendance, declarations of interest | Chair | — |
| 2 | Actions from the previous review | Secretary | "None - first review" (to be confirmed at the meeting) |
| 3 | ISMS scope and context: confirm or change the draft scope; legal register status | Information security lead | `ISO27001-SCOPE-AND-CONTEXT.md` |
| 4 | Policy and roles: approve or amend the top-level policy; appoint named roles | Chair | `ISO27001-POLICY-REGISTER.md` §2.1; scope file §5 |
| 5 | Risk and treatment: the open decisions list (section 5 of this pack); acceptance of residual risk | CKDesk owner | Section 4 and 5 of this pack |
| 6 | Technical assessment results: VAPT status, reconciliation, evidence gaps | CKDesk owner / developer (presents, does not decide alone) | Section 4 of this pack |
| 7 | Monitoring and measurement: what is measured today; proposed metrics; log reviewer | Information security lead | `ISO27001-CLAUSE-GAP-ASSESSMENT.md` 9.1 |
| 8 | Internal audit programme: appoint an independent auditor; approve the cycle | Chair | `ISO27001-INTERNAL-AUDIT-READINESS.md` |
| 9 | Objectives for the next 12 months | Chair | Draft objectives in `ISO27001-CLAUSE-GAP-ASSESSMENT.md` 6.2 |
| 10 | Resources: people, time, budget (HTTPS certificate, backup storage, external test, training) | Chair | Section 5 decisions |
| 11 | Interested-party feedback; suppliers | Information security lead | `ISO27001-SCOPE-AND-CONTEXT.md` §6 |
| 12 | Improvement opportunities | All | Section 6 |
| 13 | Decisions and actions summary read back; date of next review | Secretary | Minutes |

---

## 3. Blank minutes template (to be completed only at a real meeting)

**Do not fill in until a meeting has taken place.**

```
CKDesk ISMS - Management Review - Minutes

Meeting date: ______________    Time: ______    Location / call: ______________
Review number: ____ of year ______    Previous review date: ______ (or "none - first review")

Chair: ______________________ (role: ______________)
Secretary: ___________________ (role: ______________)
Attendees (name, role): 
  1. ______________________________
  2. ______________________________
  3. ______________________________
  4. ______________________________
Apologies: ______________________________
Declarations of interest: ______________________________

1. Actions from previous review
   Action | Owner | Due | Status | Evidence
   _____________________________________________________________

2. Changes in external and internal issues
   Notes / decision: ________________________________________________

3. Changes in needs of interested parties
   Notes / decision: ________________________________________________

4. Nonconformities and corrective actions
   Summary reviewed (register ref: ______):
   Notes / decision: ________________________________________________

5. Monitoring and measurement results
   Metrics reviewed: ______________________________________________
   Notes / decision: ________________________________________________

6. Internal audit results
   Audit report ref: ______    Findings open: ____    Closed: ____
   Notes / decision: ________________________________________________

7. Fulfilment of information security objectives
   Objective | Target | Result | Comment
   _____________________________________________________________

8. Feedback from interested parties
   Notes / decision: ________________________________________________

9. Risk assessment results and risk treatment plan status
   Risk register ref: ______    Risks accepted: ____    To treat: ____
   Notes / decision: ________________________________________________

10. Opportunities for continual improvement
   Notes / decision: ________________________________________________

11. Decisions taken
   No. | Decision | Reason | Owner | Due date
   _____________________________________________________________

12. Actions assigned
   No. | Action | Owner | Due date | Resource approved (yes / no / amount)
   _____________________________________________________________

13. Changes needed to the ISMS (scope, policy, objectives, processes)
   ________________________________________________________________

14. Conclusion: the ISMS is judged suitable / adequate / effective (tick or comment): ____________

Next review date: ______________
Minutes prepared by: __________________   Date: ________
Approved by (top management): __________________   Date: ________   Signature: __________
Distribution: __________________________   Stored at (document register ref): ____________
```

---

## 4. Headline inputs available today (facts only)

All facts below are from the assessment files named. They are for management to read; they are not conclusions of a review.

### 4.1 VAPT results (status table `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`)

| Group | Count | Meaning |
|---|---|---|
| Section A rows: found by the assessment and fixed in LOCAL | 32 rows (many rows cover several finding IDs) | Fix written and tested on the isolated stack. **Not deployed.** One Critical (VAPT-DEP-01: Next.js 16.2.9 has published advisories including remote code execution on Windows hosts; fixed locally by upgrade to 16.3.8). The rest are High, Medium, Low-Medium, Low or Info; several rows show a range such as "High to Medium" |
| Section B rows: open, partly fixed, needing a decision or not verified | 15 rows | 4 rows Requires Decision; 2 Partially Fixed; 7 Open (including a Low group and an accepted residual npm advisory); 2 Not Verified |
| Dependencies (`npm audit`, 2026-10-15) | All dependencies: 31 findings (1 low, 9 moderate, 17 high, 4 critical). Production dependencies: 9 findings (3 moderate, 5 high, 1 critical) before the local upgrade; after the local upgrade the status table records 2 moderate (exceljs to uuid, no fix without a breaking downgrade) | Local only |
| Evidence of fixes | Class A before/after tests for many rows (examples: priority and SLA tampering, internal-note attachments, mobile numbers, CSP report flooding, login CSRF, approval code guessing 20 accepted before vs at most 4 after) | Synthetic data on the isolated stack |

Open High items, both needing a management decision: VA-API-01 (plain HTTP, non-Secure cookie, report-only CSP) and VA-API-02 / D-011 (default password for bulk-imported accounts; production check of live accounts is needed).

Not Verified: VA-DB-08 (whether the live sign-in service allows self sign-up; the production template disables it); missing scanning tools (Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei, Burp were not installed; replaced by `npm audit`, targeted searches and source reviews).

### 4.2 Reconciliation of the earlier October audit (`01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`)

75 earlier findings were classified against the current code:

| Classification | Count |
|---|---|
| Fixed and independently verified | 53 (11 of them partial; 8 more carry a named residual) |
| Fix present but not retested | 4 (D-027, D-033, D-056, D-066) |
| Still vulnerable | 9 (D-025, D-026, D-036, D-039 and five Low/Info groups) |
| Superseded by newer implementation | 1 (D-032) |
| Requires business decision | 7 (D-005, D-011, D-018, D-022, D-037, D-041, D-061) |
| Cannot verify with available evidence | 1 (D-038, Node version on 10.0.1.98) |
| Total | 75 |

Also: 12 residual items R-1 to R-12 were found while reconciling, for example R-1 (the database still accepts priority and deadline changes by a technician or manager through the data API, which collides with the new rule that nobody may change priority by hand) and R-11 (self sign-up setting unconfirmed in production).

### 4.3 Test evidence

Two documents record different counts of passing unit tests for 2026-10-14 (1186 in the reconciliation, 1090 in the inventory). Neither run has been repeated on the current code, and later LOCAL commits are not covered (reconciliation item R-12). **Management should not rely on a test count until the suites are re-run.**

### 4.4 Evidence gaps (from `ISO27001-CLAUSE-GAP-ASSESSMENT.md`)

- Of 25 clause requirements (4.1 to 10.2), none is shown "Operating with evidence". 15 are Not implemented, 6 Not verified, 3 Designed in part, 1 mixed (9.1: logging implemented, review not).
- No Class C evidence supplied: no approved policy, risk register, access review, restore test record, training record, supplier review, internal audit or earlier management review.
- Backups: nightly dump described; script not in repository; no restore test on record; second copy outside 10.0.0.205 "Not done yet"; the dump does not contain the vault key.
- Logging: strong design; no reviewer defined, no alerting; production activation of the System Log and the log shipper is Not verified from the repository.
- Change: one author identity for all 271 commits; one approver; no release records, tags or independent review.
- Suppliers: no register, contracts or data-processing terms for Google, Meta, DeskTime, optional LLM provider.
- Physical and HR: nothing in the repository (not expected); needs management records.

### 4.5 Production status

Production runs build 20261015-145217 (main `717e5c6`) on 10.0.1.98, database 10.0.0.205, files on NAS 10.0.0.25. None of the VAPT fixes (including the Next.js upgrade and migration `20240101000164_vapt_security_hardening.sql`) is deployed. The public site is plain HTTP at `http://182.72.84.10:3210`.

---

## 5. Decisions management must take

Each row is a decision that the assessment cannot take for management. "Recommended" is the assessment team's suggestion; the decision, owner and date belong to management.

| # | Decision | Why it is needed | Evidence / ID | Recommended direction (not a decision) | Owner (to be assigned) |
|---|---|---|---|---|---|
| 1 | **HTTPS:** put TLS in front of the application (certificate, DNS name, reverse proxy), then turn on Secure cookies, HSTS and enforce the CSP | The login and session cookies cross networks unencrypted; internet-exposed | VA-API-01, D-018, D-037, D-033 | Approve a plan with a date; until then record the risk and its owner | Top-management sponsor; infrastructure owner |
| 2 | **Default password:** retire the fixed default initial password used in bulk import (one-time invitation links or random passwords); enforce the forced reset on the server; authorise a check of live accounts | Anyone who knows the default can sign in to any account still using it | VA-API-02, VA-ADM-02, D-011 | Approve the change; authorise a controlled production check | CKDesk owner |
| 3 | **D-005 confidentiality tier:** decide whether HR and Finance-type teams get a restricted tier so that other managers/admins cannot see their tickets | Today every manager, admin and platform owner sees every team's tickets | D-005 | Decide the policy (restricted-team flag and report treatment), then build | Top-management sponsor with HR/Finance heads |
| 4 | **Deploy the LOCAL fixes:** approve release of the Next.js 16.3.8 upgrade and migration 164 and the other fixes, with a release record, backup first and rollback point | Production still has the Critical framework advisory and the High priority/SLA tampering gap | Status table section A | Approve a release window; apply the change procedure | CKDesk owner; independent reviewer |
| 5 | **Second backup copy and monthly restore test:** approve the owner's deferred proposal (separate share, backup-only account, about 90 days, snapshots) and a monthly restore test; back up the vault key and server config files | No off-server copy; no restore ever recorded | Runbook §6, §10 | Approve now; set RTO/RPO | Infrastructure owner |
| 6 | **Verify live production settings** (self sign-up disabled; password policy; Node version; migrations 156-164 present; scheduled tasks) under authorisation | Several findings depend on production values the repository cannot show | VA-DB-08, R-11, D-036, D-038 | Authorise a read-only check by an administrator | Infrastructure owner |
| 7 | **Who may change shared settings and author Business Rules** (managers vs admins vs platform owners); who may change assignee/description/form data through the data API | Database says one thing, screens another; conflicts with the "nobody changes priority by hand" rule | VA-TKT-02, VA-ADM-03/06/09, R-1, R-2 | Decide the intended rule; then fix | CKDesk owner |
| 8 | **Appoint ISMS roles**: sponsor, information security lead, risk owners, release approver independent of the developer, log reviewer, internal auditor | No named roles; one person approves all change | Clause 5.3 | Appoint and record | Top-management sponsor |
| 9 | **Approve scope and top-level policy** (or amend) | No approved scope or policy | Scope file; policy register | Approve CKDesk-only scope first | Top-management sponsor |
| 10 | **Risk method and risk acceptance level;** accept or treat each open risk in writing | No risk process | Clause 6.1.2/6.1.3 | Adopt simple 1-5 x 1-5 scoring | Top-management sponsor |
| 11 | **Set `TRUSTED_PROXY_HOPS`** and dedicated secrets (`CRON_SECRET`, approval link secret) in production | Per-address rate limits and IP logging do not work without it; one secret serves many uses | D-061, D-017, VA-API-05, VA-API-03 | Approve configuration change via the change procedure | Infrastructure owner |
| 12 | **MFA plan** for administrators and platform owners; auth-service password policy | No MFA; policy not set | D-036; Inv. 2 | Decide plan and date | CKDesk owner |
| 13 | **Supplier and data decisions:** which integrations are live; contracts/DPAs; whether an outside model provider may receive ticket or mail text; DeskTime staff notice | No supplier management; planned bot raises the question | Inv. 12 | Build supplier register; no new outside provider without review | Legal; CKDesk owner |
| 14 | **Resourcing** (people, time, budget) for 12 months | Nothing recorded | Clause 7.1 | Decide and record | Top-management sponsor |
| 15 | **Other recorded open decisions:** D-022 (per-organisation ticket numbers), D-041 (home dashboard caching), D-030 side doors on approvals | Listed as needing a decision | Reconciliation §6 | Decide or defer with a note | CKDesk owner |
| 16 | **Independent review** of security-relevant code and of production changes (second person) | Single author and approver | Inv. 5 | Appoint reviewer; set rule | Top-management sponsor |

---

## 6. Suggested improvement opportunities for the first review (for discussion)

1. Build the nonconformity and incident register and seed it with the open VAPT items.
2. Add CI to run type check, lint and tests on every change, and a standing dependency scan with a patch deadline.
3. Wire alerts for critical System Log rows and for backup failure; run the log shipper on 10.0.0.205.
4. Put the backup script and scheduled-task definitions under version control (without secrets).
5. Mark stale documents as history; start a document register.
6. Replace the shared server administrator account and single ssh key with named accounts.
7. Make the retention schedule real for tickets and attachments (a job to enforce it) once Legal sets the periods.

---

## 7. How to use this pack

1. Management reads sections 4 and 5 and brings the decisions to a meeting.
2. After the meeting, the secretary completes section 3 with the real date, attendees and decisions, and the chair signs. Until then no review is on record.
3. Decisions feed the risk treatment plan, the policy register and the audit programme.

---

## Open questions / evidence requests for management

1. Who is the chair (top-management sponsor) and who is the secretary for the first management review? Propose the date.
2. Confirm whether any earlier management discussion of information security was minuted anywhere. If so, supply it (Class C); if not, confirm "none" so the first review records "no previous review".
3. Decisions 1 to 16 in section 5: for each, name an owner and a decision date (or the decision to defer, with reason).
4. Supply feedback from interested parties (staff, HR, Finance, suppliers, customers, regulators) for input 8.
5. Supply any internal or external audit reports and any incident or outage records for inputs 4 and 6.
6. State the information security objectives management wants to track in the next 12 months.
7. Authorise the production fact-checking in decision 6 and name who may perform it.
