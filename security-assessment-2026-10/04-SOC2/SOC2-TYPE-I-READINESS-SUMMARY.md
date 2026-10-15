# SOC 2 Type I Readiness Summary - Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is the short version of the SOC 2 Type I readiness work. Read this first; the other five files in this folder hold the detail. A SOC 2 **Type I** report says whether a company's controls are **suitably designed on one date**. It is written by an independent CPA firm, not by the company or by this assessment.

**Honest statement.** No SOC 2 attestation, certification, or "compliance" is claimed here or anywhere in this assessment. **A Type I report can only be issued by a qualified, independent CPA firm.** This document is an internal preparation exercise. The criterion wording used is a paraphrase, **PROVISIONAL — confirm against the licensed AICPA Trust Services Criteria**.

**Nothing from this assessment is deployed.** Production runs build 20261015-145217 (main `717e5c6`). The fixes found by the VAPT exist only in the local branch `security/vapt-iso27001-soc2-local` and need the owner's explicit OK before any release.

Evidence classes: **A** local test · **B** repository · **C** management evidence (**none supplied**) · **D** documents only · **E** missing.

---

## 1. Result in numbers (from our own matrix; no percentage or score is calculated)

Criteria assessed: Security (CC1-CC9, 33), Availability (A1, 3) and Confidentiality (C1, 2) = **38**. Processing Integrity and Privacy are proposed OUT for now (`SOC2-TSC-APPLICABILITY.md`).

| Result | Count |
|---|---|
| Suitably designed | **0** |
| Design gap | **33** |
| Not verified — management evidence (class C) required | **5** (CC1.1, CC1.2, CC1.4, CC1.5, CC6.4) |
| Total | **38** |

Gaps found: **36** (1 Critical, 17 High, 16 Medium, 1 Low, 1 Info). By type: 14 missing technical control, 13 missing documented process, 3 control exists but not proven, 4 missing organisational evidence, 2 actual control failure (`SOC2-TYPE-I-GAP-ASSESSMENT.md`).

---

## 2. What is suitably designed (at the level of single design elements)

No whole criterion can be called "suitably designed" yet, because each is held back by something outside the code (a policy, a record, a decision). But several **design elements are strong** and a CPA would likely credit them once evidence of operation exists:

| Element | Why it is good | Evidence |
|---|---|---|
| Layered access design | Session check at the edge, role check in every action, row-level security in the database (222 policies), column grants and guard triggers | A/B (T10, T11, TU tests; reconciliation catalogue) |
| Tamper-evident System Log | Append-only table, hash chain over audit and security rows, integrity-check function, retention and archiving, redaction of tokens and e-mail addresses; chain verified intact over 24,750 rows in the audit database | A/B |
| Target-role guard and self-approval block | Admins cannot take over platform owners; nobody changes their own role or deactivates themselves; requesters cannot approve their own requests | B (unit tests) |
| Deactivation | Marks the profile inactive **and** bans the login; database treats inactive users as signed out | B |
| Secrets handling in the database | Mailbox, channel and DeskTime credentials encrypted in a vault; secrets redacted in logs | B |
| Approval links | 7-day signed links, one-time code that is hashed, single-use, limited tries (the parallel-guess flaw fixed locally) | A (TB) |
| Upload handling | Type allow-list (no SVG), 25 MB cap, magic-byte check, safe serving headers | B |
| Test culture and isolation | 268 test files; an isolated audit stack with a 21-check gate that stops any test from touching production | A/B |
| Change tooling | Build gate fails on local addresses or missing assets; type errors fail the build; written rollback and migration rollbacks | B/D |
| Written runbooks | Production topology, release, restore, reboot checklists exist | D |

## 3. What is not suitably designed (top reasons)

1. **Production still runs a framework with a published critical advisory** (VAPT-DEP-01). The fix is local only.
2. **Plain HTTP** to the internet-facing site; non-secure, long-lived cookies (VA-API-01, D-018, D-037).
3. **Backups have one copy on the database server, no restore test, no recovery targets, no continuity plan** (A1.2, A1.3, CC9.1).
4. **No alerting and no named log reviewer**: the log is excellent but nobody is told (CC7.2).
5. **No incident response plan or register** (CC7.3-CC7.5).
6. **No governance documents**: no approved policies, risk register, named security owner, vendor management, access reviews, leaver process (CC1-CC3, CC9.2, CC6.2).
7. **Change management rests on one person**: one author identity, one approver, no automated pipeline, no staging (CC8.1).
8. **Authentication is password only**, 8 characters, with a fixed default password for bulk imports (D-011) and an unverified login-service policy (CC6.1).
9. **No data classification or confidential tier** for HR / finance tickets (D-005, C1.1).
10. **No standing vulnerability management or patching process** (CC7.1).
11. **Several VAPT findings are fixed only locally**, so production still has the issues the tests reproduced (e.g. direct changes to ticket priority / SLA, readable mobile numbers) (G-03).

## 4. What management must supply (evidence class C)

Short list; the full list is at the end of each file.
- Named **owners** (security, system, change approver, DBA, server and NAS administrators, privacy).
- **Approved policies** (or confirmation that none exist).
- **Access review and joiner / mover / leaver** records; list of admins and platform owners.
- **Backup script, backup logs, a restore-test record** (only after a real test), and the second-copy decision.
- **Production settings extracts** (login service, proxy hops, secrets handling, migrations live, scheduled tasks).
- **Incident plan, risk register, risk-acceptance records**, any past incident records.
- **Vendor list, contracts, assurance reports** (Google, Meta, DeskTime, Groq if used, ISP, NAS support).
- **HR and premises evidence** (code of conduct, screening, training, discipline; server room access, power, fire, backup-disk location).
- **Decisions**: D-005 (confidential teams), D-011 (default password), D-018 / D-037 (HTTPS), D-036 (password policy), release of the local fixes, and scope (Availability commitment, Processing Integrity, Privacy).

Management evidence must be **real and dated**. Do not create records for things that have not happened (restore tests, reviews, training, approvals).

## 5. What an independent CPA would likely find today

If a CPA firm looked at CKDesk as of today, it would most likely:
- Say the **description cannot be finalised** until commitments, owners and policies exist.
- Raise **exceptions or "not suitably designed"** conclusions in most Common Criteria, especially risk assessment (CC3), monitoring (CC4, CC7), incident response (CC7.3-7.5), change management (CC8.1), vendor management (CC9.2), and access provisioning / review (CC6.2, CC6.3).
- Ask for evidence that production matches the repository (settings, migrations, scheduled tasks), which the repository cannot show.
- Treat the **absence of HTTPS and the critical framework advisory** as significant security-design deficiencies.
- Treat the **missing second backup copy and missing restore test** as Availability deficiencies if A1 is in scope.
- Note, positively, the access design, the System Log and the test discipline.

This is a prediction for planning, **not a judgement by any CPA**. A real firm may disagree and would also decide on the scope, the reader, and the carve-out versus inclusive treatment of vendors.

## 6. A realistic path (suggested)

| Stage | What | Notes |
|---|---|---|
| 1 | Owner decisions and naming owners | Unblocks everything |
| 2 | Evidence gathering from servers (read-only) and restore test by the DBA | Turns "not proven" into evidence |
| 3 | Release the local fixes with a rollback plan | Needs explicit OK; follows the normal release procedure |
| 4 | Alerting, incident plan, log review, backup second copy | Closes the biggest operational gaps |
| 5 | Governance documents approved by management | Drafts only until signed |
| 6 | Re-run this matrix with real evidence | Then talk to a CPA firm about a readiness review |
| 7 | CPA engagement | Type I is a point in time; a Type II needs months of operating evidence |

## 7. Key limits of this assessment

- Local-only technical testing on the isolated audit stack; no production access; no management evidence.
- The criteria text is paraphrased; mappings are provisional.
- Tests recorded before today's later local changes were read, not re-run (R-12).
- Production behaviour of the login service and other server settings is **not verified**.

---

## Open questions / evidence requests for management

1. Confirm the **purpose and reader** of a SOC 2 style report, and whether an independent CPA firm will be engaged (and when).
2. Appoint **owners** and an **executive sponsor** for the work.
3. Decide the **scope**: Security + Confidentiality now; Availability only with a stated commitment; Processing Integrity and Privacy later.
4. Give **decisions** on D-005, D-011, D-018 / D-037, D-036 and the release of the local fixes (including the framework upgrade).
5. Supply the **evidence items** in section 4, with real dates and names.
6. Approve a **timetable** for the High-severity gaps so progress can be shown.
7. Agree that **no record, policy, test or approval will be created or back-dated** to look compliant; drafts stay "DRAFT — not approved" until signed.
