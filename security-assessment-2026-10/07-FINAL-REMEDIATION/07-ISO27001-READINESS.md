# 07 — ISO/IEC 27001:2022 readiness update (draft — NOT a certification)

LOCAL ONLY. **No certification, attestation or "compliance" is claimed.** Only an accredited certification body can certify against ISO/IEC 27001. This is an internal readiness update after the final remediation. The full matrix, scope, SoA draft, risk register and policy register stay in `../03-ISO27001/` (dated 2026-10-15); this file records **what changed since then** and gives the templates the organisation needs. Control titles remain PROVISIONAL until checked against the licensed standard.

## The five evidence states used from now on

| State | Meaning | Who can produce it |
|---|---|---|
| **1. Code implemented** | The control exists in the repository (class B). | the development team |
| **2. Locally tested** | A test on the isolated audit stack passes, and fails on the old behaviour where applicable (class A). It proves the *code*, not the live system. | the development team |
| **3. Designed only** | A plan, document or template exists; the working element is missing. | the development team |
| **4. Organisational evidence missing** | The control needs records only the organisation can create: signed policy, access-review sheet, backup-restore record, training list, approval minutes (class C). **None has been supplied.** | management |
| **5. Approval pending / operating evidence unavailable** | A management decision is outstanding (see `09-…`), or the control has not yet run long enough to show operation. | management / time |

A control is **never** called "operating" without state-5 evidence collected over time. Nothing is in that state.

## What this remediation changed (technical controls, Annex A themes)

| Annex A control (2022) | Before (2026-10-15) | Now | State |
|---|---|---|---|
| A.5.15 / A.5.18 Access control; access rights | Table rights and role checks partly in screens only | Server-only writes on ~45 tables; role/organisation checks in every server action; six owner policy switches; second-organisation isolation proven on every table that carries an organisation id (test v29: all `org_id` tables, read, write, create, storage, functions) | 1 + 2; owner review of access: 4 |
| A.5.17 Authentication information | Shared default password for bulk import | Random one-time password or invitation; forced change enforced in the server and the database; password reset without the current password only for a recovery session; sessions end on password change | 1 + 2 |
| A.5.14 / A.8.20–8.22 Information transfer, network security | HTTP; no TLS to the mail server worker | Mail worker requires TLS and checks certificates; **public HTTP remains** (decision D-1) | 1 + 2 for SMTP; HTTP = 5 (approval pending) |
| A.8.3 Information access restriction | Requesters could read activity and staff lists | Activity log staff-only plus server-built requester view; people lists scoped; internal-note files hidden | 1 + 2 |
| A.8.5 Secure authentication | Throttling per process only | Failure-based throttle, spray detection, shared database counters for public endpoints, approval-code lock-out | 1 + 2 |
| A.8.7 Protection against malware | Type/size checks only | Macro-bearing files refused; upload quotas; ClamAV connector built (fail closed). **No scanner installed** | 1 + 2 (connector against a protocol stand-in); scanner: 3 + 5 |
| A.8.8 Management of technical vulnerabilities | 9 production advisories (framework) | Production dependency audit **0** on the release branch; Semgrep, Gitleaks, OSV-Scanner and Nuclei run (see `04-VAPT-RETEST-RESULTS.md`); ZAP not run | 1 + 2 (scans ran locally); a vulnerability **process** with owner and dates: 4 |
| A.8.9 Configuration management | no checker | `scripts/check-secrets.mjs`, `check-auth-settings.mjs` | 1 + 2 |
| A.8.11 / A.8.12 Masking, data leakage prevention | partial | Export audit and per-person export limits; mail HTML cleaned; error text sanitised in 87 more places | 1 + 2 |
| A.8.13 Backup | dump scripts existed | Rollback plus pre-migration dump procedure in `11-…`; a **restore test on production data has not been performed** | 3 + 4 |
| A.8.15 Logging; A.8.16 Monitoring | System Log with hash chain | Chain verified intact after 3,000 parallel chained appends (sequence gap 0, broken rows 0) and at 100,000 / 500,000 tickets (`06-…`); exports, name changes, org changes, policy switches audited | 1 + 2; log **review** by a person: 4 |
| A.8.25–8.29 Secure development, testing | tests existed | Default, remediation and VAPT suites run against the isolated stack with a 21-point isolation gate; migrations rehearsed forward/back; release order proven | 1 + 2; **change approval record**: 4 |
| A.8.32 Change management | informal | Release plan and rollback plan (`10`, `11`); change-approval template below | 3 + 4 |
| A.8.34 Protection of information systems during audit testing | n/a | Testing done only on a disposable database with synthetic data; production never contacted | 2 |

Organisational (A.5), people (A.6) and physical (A.7) controls are **unchanged**: they were *Not verified* for lack of class-C evidence and still are. The summary counts in the 2026-10-15 matrix (93 controls; 14 designed, 16 implemented, 7 tested, 0 operating, 10 not implemented, 46 not verified) remain the organisation-level baseline; the technical rows above move from *Implemented/Designed* toward *Tested*, which adds locally tested technology controls but changes nothing in the organisational counts.

## Outstanding for ISO 27001 (all need the organisation)

1. Management decision on scope and ownership (D-12); name a person per control family.
2. Approved information-security policy set (drafts in `../03-ISO27001/ISO27001-POLICY-REGISTER.md`).
3. Risk assessment accepted by risk owners; treatment plan dated.
4. Records produced from the templates below, **kept over at least one cycle** (quarterly access review, one restore test, one incident exercise, one change record per release, a vulnerability log).
5. Internal audit and management review (templates in `../03-ISO27001/`).
6. Supplier assessments (Google Workspace, Meta WhatsApp, DeskTime, GitHub, optional LLM provider).

## Templates (copy, fill, sign, store — these are blank forms, not evidence)

### T-1 Access review (quarterly)
| Field | Entry |
|---|---|
| Review period / date | |
| Reviewer (name, role) — not the person whose access is reviewed | |
| System | Citykart Desk — Admin → Users export (never the passwords) |
| Accounts reviewed (count) | |
| Accounts with admin / manager / owner roles listed | |
| For each: name, role, still employed? Y/N, role still needed? Y/N, action | |
| Inactive for 90 days (list) and action | |
| Accounts removed / downgraded (ticket ref) | |
| Leavers since last review checked against HR list | |
| Sign-off (reviewer) / (system owner) / date | |

### T-2 Backup and restore test (at least yearly, and before each migration release)
| Field | Entry |
|---|---|
| Date / performed by / witnessed by | |
| Backup identifier and time taken | |
| Restored into (scratch database name — never production) | |
| Row counts compared (requests, profiles, comments, attachments) | |
| Files on the NAS spot-checked (n files opened) | |
| Time taken to restore (recovery-time evidence) | |
| Data age at restore (recovery-point evidence) | |
| Result: pass / fail / follow-up | |
| Sign-off | |

### T-3 Incident response record
| Field | Entry |
|---|---|
| Incident id / date-time detected / detected by | |
| Description (what, where, which data) | |
| Severity (Critical/High/Medium/Low) and why | |
| Containment actions with times | |
| Was personal or business-confidential data exposed? Y/N/unknown | |
| Who was told, when (management, affected users, authorities if required) | |
| Root cause | |
| Corrective and preventive actions, owner, due date | |
| Lessons learned; closed on (date) / by | |
| User notice template: "Citykart Desk is unavailable from __ to __ while we fix a problem. No action is needed from you. We will tell you when it is back." | |

### T-4 Vulnerability management log
| Field | Entry |
|---|---|
| Date of scan / tool and version / scope | |
| Finding id, severity, affected component | |
| Decision: fix / accept (with owner and expiry) / not applicable (reason) | |
| Owner, target date, ticket reference | |
| Fix released on (build id), verified by | |
| Next scheduled scan | |
Scan cadence proposed: dependency audit on every release and monthly; static scan and secret scan on every release; dynamic scan after every release; external penetration test yearly.

### T-5 Change approval
| Field | Entry |
|---|---|
| Change id / date / requested by | |
| Description and reason; findings or tickets it closes | |
| Components (app / database migrations n–m / configuration / secrets) | |
| Tests run (suite names and results) and where recorded | |
| Impact on users; maintenance window | |
| Rollback plan reference (`11-…`), backup identifier | |
| Approver (not the requester) / decision / date | |
| Post-change verification result and sign-off | |

## Honest summary

The **technical** controls an assessor would examine first (access control, authentication, logging, change/rollback, secure development, malware, cryptographic transport) are now implemented and locally tested, except HTTPS (pending decision) and a malware scanner (not installed). The **organisational evidence** a certification audit needs does not exist yet and cannot be created by code. Estimated readiness for a Stage 1 audit: **not ready** — the missing items are the six listed above.
