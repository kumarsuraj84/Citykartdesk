# SOC 2 Type II Readiness Summary - CKDesk

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is the short, plain-language summary of the SOC 2 Type II preparation pack for Citykart Desk (CKDesk). It says what a Type II needs, where CKDesk stands today with real counts from the evidence register, who and what is missing, and what to start now. The detail is in the other files of this folder:

- SOC2-TYPE-II-CONTROL-OPERATION-PLAN.md (16 controls, how to run each)
- SOC2-EVIDENCE-REGISTER.md (131 evidence items and their status)
- SOC2-EVIDENCE-COLLECTION-CALENDAR.md (daily to yearly tasks, readiness checklist, proposed period)
- SOC2-OPERATING-EFFECTIVENESS-TEST-PLAN.md (how an auditor would test, and a monthly self-test)
- SOC2-EXCEPTION-REGISTER.md (28 known exceptions)
- SOC2-CONTROL-OWNER-MATRIX.md (33 control areas and who owns them)

## The honest statement first

**No SOC 2 Type I or Type II attestation is claimed, and none exists.** Only an independent CPA firm can issue a SOC 2 report. This pack is an internal preparation. Nothing here shows that any control has operated over any period, no organisational evidence (approved policies, access reviews, restore tests, training records, management approvals) has been supplied to this assessment, and no history is claimed or may be created after the fact. Production today runs build 20261015-145217 (main 717e5c6); the fixes from this assessment exist only in a LOCAL branch and are **not deployed**.

## 1. What a Type II needs, in simple words

SOC 2 is a report by an outside auditor about how well a company protects its customers' or users' data. There are two kinds.

- **Type I** looks at whether the controls are *designed* properly on one day.
- **Type II** looks at whether the controls *really worked, again and again, over a period* (often 3 to 12 months). It is much harder, because the auditor picks sample dates and asks for proof for each.

To pass a Type II you need five things:
1. **Written rules approved by management** (policies and procedures) and **named people** responsible for each control.
2. **Controls that actually run** on a schedule (access reviews, restore tests, log reviews, approvals for changes, and so on).
3. **Proof for each run**, dated at the time it happened, kept safely.
4. **Someone checking the checkers** (a second person reviews, management reviews).
5. **Honest handling of failures**: every missed control is written down as an exception with a plan.

## 2. Where CKDesk stands today

**The software is stronger than the organisation around it.** CKDesk has real technical controls: sign-in checks, roles, row-level database rules, a System Log with a tamper-check chain, 268 test files, a deploy runbook and a rollback method. But a Type II is mostly about habits and records, and those do not exist yet.

### Evidence coverage counts (from SOC2-EVIDENCE-REGISTER.md)

| Status | Meaning | Count | Share of 131 |
|---|---|---|---|
| Exists in repo | A written procedure or tool exists (design only, not proof it runs) | 3 | 2% |
| Partly exists | Something relevant exists but incomplete or unverified in production | 24 | 18% |
| Not collected | Could be produced today, but nobody does | 59 | 45% |
| Cannot exist yet | Needs a process, approval, tool or owner that does not exist | 45 | 34% |
| **Total evidence items** | | **131** | |

- **Evidence of operation over any period: 0 of 131.**
- Items with any usable starting point: 27 of 131 (21%). The three "exists" items are the restore procedure in the runbook, the after-reboot checklist, and the VAPT exploit-test suite (which is still uncommitted in the working tree).
- Items that only need someone to begin collecting: 59.
- Items that need a decision, process or build first: 45. Examples: an approval step for creating accounts, an off-server backup copy, alert routing, a release register, a restore test result that can only exist after the test is performed.

By control (items / exists / partly / not collected / cannot exist yet):

| Control | Items | Exists | Partly | Not collected | Cannot exist yet |
|---|---|---|---|---|---|
| C01 Access provisioning and deprovisioning | 9 | 0 | 4 | 3 | 2 |
| C02 Quarterly access review | 6 | 0 | 1 | 2 | 3 |
| C03 Privileged access review | 7 | 0 | 1 | 4 | 2 |
| C04 Change management | 12 | 0 | 3 | 6 | 3 |
| C05 Vulnerability scanning and remediation | 8 | 0 | 3 | 2 | 3 |
| C06 Patching | 8 | 0 | 1 | 5 | 2 |
| C07 Backups and restore tests | 12 | 1 | 0 | 8 | 3 |
| C08 Incident response | 9 | 0 | 2 | 4 | 3 |
| C09 Security monitoring and log review | 12 | 0 | 1 | 7 | 4 |
| C10 Vendor reviews | 7 | 0 | 1 | 4 | 2 |
| C11 Business continuity test | 6 | 1 | 0 | 3 | 2 |
| C12 Security awareness | 5 | 0 | 0 | 1 | 4 |
| C13 Risk assessment refresh | 6 | 0 | 1 | 2 | 3 |
| C14 Policy review | 5 | 0 | 0 | 2 | 3 |
| C15 Key and secret rotation | 7 | 0 | 3 | 2 | 2 |
| C16 Penetration test | 7 | 1 | 2 | 2 | 2 |
| Cross-cutting (system description, owners, engagement) | 5 | 0 | 1 | 2 | 2 |

The weakest areas are C12 (security awareness), C14 (policy review), C09 (log review and alerting) and C07 (restore tests and off-server copy), because they have little or nothing in place.

### Known exceptions

28 real exceptions are recorded in SOC2-EXCEPTION-REGISTER.md, all dated 2026-10-15. The ones an auditor would notice first: no restore test recorded, no off-server backup copy, plain HTTP, the default initial password for imported users, no CI, one shared administrator account for server access, no access review ever done, a framework version (Next.js 16.2.9) in production with published serious advisories whose fix exists only locally, no log review or alerting, no incident plan, no approved policies.

## 3. Missing control owners

The owner matrix covers **33 control areas**. Today:

- **26 have no identifiable owner** in the repository.
- **7 have only a de-facto role and no name or backup**: change approval and release (the "project owner" gives the explicit OK to every deploy), development and code quality, database migrations on 10.0.0.205, server operations, dependency updates, account creation by admins, and the WhatsApp pilot monitoring roles (named by title only).
- **0 have a named, accepted owner with a backup.**

Without named owners no control can be said to be operated by someone, so this is the first thing to fix.

## 4. Missing organisational evidence

The following do not exist in the repository, and none has been supplied. Management must provide them if they exist, or create them:

- Information security policy set approved by management, and a statement of who is accountable.
- Risk assessment method and risk register; signed risk acceptances for the open items (HTTP, default password, confidentiality tier, session settings, and others).
- Joiner / mover / leaver procedure and an HR leaver feed.
- Access review records and a privileged access list (including key and password custody).
- Release register with recorded approvals (today approval is an instruction in chat and is not stored); branch protection or a second reviewer.
- Backup script as deployed, backup logs, a restore test record, an off-server copy, RTO and RPO, a business continuity plan and a reboot test result.
- Incident response plan, roster, register, exercise.
- Log review procedure and records; alert route.
- Supplier register, assurance reports and contracts for Google, Meta, DeskTime and others.
- Awareness training programme and completion records.
- Secrets inventory and rotation records.
- An independent penetration test.
- A signed system description and a management assertion for the period.

## 5. Monitoring and review processes to start now

These cost little and create the habits a Type II needs. Each should start with real dates and real names; none can be back-dated.

1. **Name the owners** (matrix) and an independent reviewer.
2. **Weekly log review** of the Logs screen (System Log: security and error rows) with a one-line record each time.
3. **Monthly "Verify integrity"** run and System Log export, saved.
4. **Monthly npm audit**, saved with the commit id.
5. **Release register**: one entry per deploy, with a recorded approval from someone other than the developer.
6. **Do one restore test** into a scratch database, with a witness, and write it down. This is the single most valuable first action.
7. **Run the first access review** from the Users export, with line managers' answers.
8. **Wire the existing log shipper on 10.0.0.205** so backup failures and database errors reach the System Log, and decide who gets alerted.
9. **Start the exception register** habit: every missed or late control gets an entry that day.
10. **Hold a monthly 30-minute security meeting** with minutes.
11. **Decide** about HTTPS, the default import password, and deploying the LOCAL fixes (Next.js upgrade and migration 164); record the decision or a signed, time-limited risk acceptance.
12. Pick the **examination start** only after the readiness checklist is ticked with evidence (a proposal is in the calendar: after readiness, at least 3 months for a first period, auditor decides).

## 6. What this pack does not do

- It does not make CKDesk compliant or attested.
- It does not claim any control works; it records where evidence would come from and what is missing.
- It does not change any code, server or setting. Build items are recommendations only.
- Mapping to the SOC 2 criteria is PROVISIONAL — confirm against the licensed standard and with the auditor.

## Open questions / evidence requests for management

1. Do you want a SOC 2 examination, and which categories (Security always; Availability, Confidentiality, Processing Integrity, Privacy optional)? Who is the customer or reason driving it?
2. Name the Executive Sponsor and all control owners and backups; name an independent reviewer.
3. Supply any existing policies, access reviews, restore tests, training records, supplier contracts, incident records and the backup script and logs (none has been supplied so far).
4. Decide on HTTPS, the default import password, multi-factor authentication for administrators, an off-server backup copy, and deploying the LOCAL assessment fixes.
5. Tell the assessment whether the System Log (migration 160), the log shipper task and the changes of 2026-10-14 are live on the production servers, so the "Partly exists" items can be verified.
6. Choose an auditor (independent CPA firm) and agree the examination period and scope with them.
7. Decide whether to run a one-month dry run of the calendar before the real period.
