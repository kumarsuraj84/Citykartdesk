# DRAFT System Description - Citykart Desk (CKDesk) - for a possible SOC 2 Type I report

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

In a SOC 2 report, the **service organisation's management writes the "system description"**; the CPA firm then checks it is fairly presented. This file is a **starting draft** for that description, following the usual structure of the AICPA description criteria (commonly called DC 200; section numbers below are **PROVISIONAL — confirm against the licensed standard**).

Rules followed in this draft:
- It contains **only facts the repository or the written runbooks support** (evidence class B or D).
- It never says a control **operates**. It says what the system is *designed* or *written* to do. Statements about operation, people, dates and contracts are written as **[management to confirm]**.
- Nothing from the assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`); the assessment's local fixes are **not** part of it.
- This is **not approved**. A real description must be reviewed, owned and signed by management. It is **not** a claim of SOC 2 Type I or any attestation.
- Where the draft says "Citykart" it means the company that owns CKDesk. The legal name and the reporting entity are **[management to confirm]**.
- A Type I report is "as of" one date: **[management to choose date, e.g. the date the design is frozen]**.

Evidence classes: **B** repository, **D** documentation; **C** (management evidence) none supplied.

---

## Section 1. Services provided

*(DC: nature of the services — PROVISIONAL)*

Citykart Desk (CKDesk) is an **internal service desk and workflow system** for Citykart's staff at head office and stores. (The working folder name, "ZOHO Alternate", suggests it replaces a hosted help-desk product **[management to confirm]**.) Staff use a web browser to:
- ask for services and report problems through service forms, e-mail or (as a pilot **[management to confirm status]**) WhatsApp;
- have requests routed to technician groups, tracked against service-level times, approved where a workflow requires it, and closed with a resolution note;
- rate the service (satisfaction survey);
- see dashboards and reports, and export data (administrators and managers).

Administrators configure users, teams, services, forms, SLA policies, categories, business rules, approval flows, mailboxes and channels. The system includes an event and audit log ("System Log").

At the last count the system held about 553 user accounts and 278 tickets **[management to confirm current numbers]**. Roles are requester, technician, manager, admin and platform owner.

Sources: `01-BASELINE/01-APPLICATION-AND-SECURITY-BASELINE.md` §2-3; `docs/ARCHITECTURE.md`; Inv. §1-2.

---

## Section 2. Principal service commitments and system requirements

*(DC: principal service commitments and system requirements — PROVISIONAL)*

**The repository contains no written commitment** to users or other parties about security, availability, confidentiality, processing accuracy or privacy. The only service times in CKDesk are SLA times for **tickets**, which are about how fast requests are handled, not about the system. Management must state the commitments it wants the description to reflect. The table lists candidate wording drawn from the system's design, each **[management to confirm / adopt]**.

| # | Candidate commitment | Basis in the repository | Status |
|---|---|---|---|
| 1 | Only authorised, authenticated Citykart staff can use CKDesk; accounts are created by administrators | No public sign-up in the production template; admin invite / import; deactivation bans sign-in (Inv. §2) | [management to confirm] |
| 2 | Users see only the tickets and information their role allows; internal notes are not shown to requesters | Row-level security; internal-note rules (D-015) | [management to confirm]; open decision D-005 (confidential teams) |
| 3 | Changes to users, roles, settings and tickets are recorded in an append-only, tamper-evident log | System Log (migration 160) | [management to confirm that it is live] |
| 4 | Stored credentials for mailboxes and channels are kept encrypted | pgcrypto vault shim | [management to confirm] |
| 5 | Backups of the database are taken nightly and kept 30 days | Runbook §6 | [management to confirm operation]; second copy not made |
| 6 | Availability / recovery targets | **None written** | [management to decide] |
| 7 | Data protection for personal data of staff | **None written** | [management to decide] |

**System requirements** (what the system needs in order to meet commitments) that the repository implies: HTTPS (not in place), named administrators, restricted physical access, patched software, working backups, an up-to-date user list from HR. **[management to confirm each]**.

---

## Section 3. Components of the system

### 3.1 Infrastructure

| Component | Description (from runbook) | Class |
|---|---|---|
| App server 10.0.1.98 | Windows Server 2022; five Windows services under NSSM (app, login service, data API, file storage, reverse proxy); scheduled tasks; log shipper. Shared with another application. | D |
| Database server 10.0.0.205 | PostgreSQL 18, database `ckdesk`, shared with other applications' databases; nightly backup task | D |
| File server (NAS) 10.0.0.25 | Attachments in `CKAPPLICATIONS_DATA\CKDESK_DATA` | D |
| Network | Router NAT forwards TCP 3210 to the app server; Windows firewall rule; public URL over plain HTTP; **[network diagram: management to supply]** | D |
| Developer / admin PC 10.0.0.47 | Builds releases; holds the administrative ssh key | D |
| Source repository | GitHub; branch `main` | B |
| Premises | **Not known from the repository — management to confirm** | E |

### 3.2 Software

- CKDesk web application (Next.js 16, React 19; server actions; edge logic in `proxy.ts`).
- Self-hosted login service (GoTrue), data API (PostgREST) and storage service — open-source components run on Citykart's server.
- Database logic: migrations, row-level security policies, triggers, audit triggers, a vault shim.
- Scheduled jobs: alerts, business rules, e-mail reply sync, satisfaction survey, System Log archive, approval reminders; and the log shipper.
- Security-relevant application features: signed verified-user header, role checks in every action, rate limits, upload checks, webhook signature check, approval links with one-time code, report-only browser security policy, redaction in logs.

### 3.3 People

Requesters, technicians, managers, admins, platform owners; developer / deployer; release approver; server, database and NAS administrators; owners of the IT Support and HR Support channels. **Names, headcount, reporting lines: [management to confirm].**

### 3.4 Data

Ticket data and internal notes; staff personal data (name, e-mail, employee id, job title, department, manager, location, store, mobile numbers); attachments; approval data; e-mail and WhatsApp conversation content; DeskTime time and application usage (if enabled **[management to confirm]**); secrets; logs; backups. See `SOC2-SYSTEM-BOUNDARY.md` §6.

### 3.5 Procedures

Written: release and rollback, database migration and migration rollback, backup and restore steps, after-reboot checklist, WhatsApp pilot daily checks. **Not found:** information security policy, access request and leaver process, access review, incident response, risk assessment, vendor management, business continuity, data classification and retention, log review. **[management to confirm whether any exist outside the repository]**

---

## Section 4. System boundaries

Inside: the items in Section 3 that belong to CKDesk (its folders, services, scheduled tasks, the database `ckdesk`, the `CKDESK_DATA` folder, the dev/admin PC as a supporting component, the repository). Outside: other applications on the shared servers, other NAS shares, end-user devices, the retired server 10.0.1.12 (operationally), test and audit stacks (synthetic data), and the vendors listed in Section 11. The full proposal and open questions are in `SOC2-SYSTEM-BOUNDARY.md`.

---

## Section 5. Relevant aspects of the control environment

*(CC1 — all items are for management to write; the repository supports only the following)*

| Topic | What the repository supports | What management must add |
|---|---|---|
| Integrity and ethics | Developer working rules in `CLAUDE.md` | Code of conduct, acceptable-use rule **[management to confirm]** |
| Oversight | None | Who oversees IT risk (board / owner / committee) **[management to confirm]** |
| Structure and authority | Five software roles; the project owner approves each push and deploy | Organisation chart, named owners, RACI **[management to confirm]** |
| Competence | None | Role descriptions, training **[management to confirm]** |
| Accountability | Actions are attributed to the acting user in the System Log | Disciplinary process, performance objectives **[management to confirm]** |

---

## Section 6. Risk assessment process

*(CC3)* The repository shows technical risk discovery: security reviews in 2026-08, 2026-09, the 2026-10-13 audit (4 Critical, 27 High and later findings), a reconciliation of 75 earlier findings and a VAPT on 2026-10-15. **No formal risk assessment process, register, risk owners or risk acceptance records are documented.** Management must describe how risks are identified, rated, accepted and reviewed, and by whom. **[management to confirm / create]**

---

## Section 7. Monitoring of controls

*(CC4, CC7.2)* Designed elements: an append-only System Log with hash chain and an integrity-check function; error capture; log shipper from service logs on the app server; retention and archiving jobs; a health endpoint; a manually run test suite (268 test files) and an isolated audit stack. Not found: alerting, a named log reviewer, uptime monitoring, internal audit, scheduled control self-assessment. **[management to confirm what is done in practice; no operation is claimed here]**

---

## Section 8. Information and communication

*(CC2)* The system sends notifications to users by e-mail and in-app notices; it records events. There is no written communication to staff of their security responsibilities, no documented security contact, and no external communication plan. Support mailbox address: `noreply@citykart.org` (send-only default). **[management to confirm]**

---

## Section 9. Control activities mapped to criteria

*(CC5-CC9, A1, C1 — "designed" and "written" mean what the repository shows, not that the control operates. The result column comes from the matrix.)*

| Criterion group | Control activities in the design (facts) | Matrix result | Operation |
|---|---|---|---|
| CC6.1 Logical access | No public sign-up in production template; session check on every request except an exact allow-list; signed identity header; row-level security; server-side role checks; deactivation ban; rate limits. **Not yet:** HTTPS, MFA, strong password policy | Design gap | [management to confirm] |
| CC6.2 Register / remove users | Admin invitation and CSV import; role-assignment restrictions; deactivation with sign-in ban | Design gap | [management to confirm] |
| CC6.3 Roles, least privilege | Five roles; target-role guard; self-approval refused; database column grants and guard triggers | Design gap | [management to confirm] |
| CC6.4 Physical | Not in repository | Not verified | [management to supply] |
| CC6.5-CC6.8 Disposal, boundary threats, transmission, malicious software | Size caps; webhook signatures; STARTTLS / TLS for mail; upload type and size checks; safe download headers. **Not yet:** HTTPS, malware scanning, enforced retention | Design gap | [management to confirm] |
| CC7.1-CC7.5 Operations | Vulnerability reviews (one-off); System Log; error capture; rollback and restore steps. **Not found:** alerting, incident response | Design gap | [management to confirm] |
| CC8.1 Change management | Written release flow; build gate; type-checked build; automated tests run manually; migration scripts and rollbacks; one approver | Design gap | [management to confirm] |
| CC9.1-CC9.2 Disruption, vendors | Nightly backup written; none for vendors | Design gap | [management to confirm] |
| A1.1-A1.3 Availability (if included) | Health endpoint; nightly dump; written restore; **no** second copy or restore test | Design gap | [management to confirm] |
| C1.1-C1.2 Confidentiality | Internal-note separation; private storage; vault encryption; System Log retention. **Not yet:** classification, confidential tier, general retention | Design gap | [management to confirm] |

Result counts across the 38 criteria: Suitably designed 0; Design gap 33; Not verified 5 (`SOC2-TYPE-I-CONTROL-DESIGN-MATRIX.md`). **A draft description cannot be finalised until management closes or openly discloses these gaps.**

---

## Section 10. Complementary user-entity controls

*(Proposed; none is currently communicated to staff — see `SOC2-SYSTEM-BOUNDARY.md` §9)* Users must protect their credentials, not share approval links or codes, report incidents and suspected misuse, and keep their devices secure. Managers and HR must inform IT promptly of joiners, movers and leavers and review elevated access. Managers must approve responsibly and not approve their own requests. Channel owners must monitor their channels. **[management to confirm and communicate]**

---

## Section 11. Subservice organisations

*(Carve-out vs inclusive method is a question for the auditor — see `SOC2-SYSTEM-BOUNDARY.md` §8)*

Proposed list (each **[management to confirm whether used in production]**): Google Workspace / Gmail (mail send and receive; optional Gmail API), Microsoft (optional Outlook / Graph intake), Meta (WhatsApp Cloud API, pilot), DeskTime (time and application usage), Groq (optional LLM summary, off unless a key is set), Web Push providers (optional), Resend (optional fallback), GitHub (source), internet service provider and router. Complementary subservice-organisation controls expected from them: protect the data in transit and at their end, notify of incidents, maintain availability. **[contracts and assurance reports: management to supply]**

---

## Section 12. Significant changes and incidents (DC: changes during the period and incidents — PROVISIONAL)

A Type I report is "as of a date"; the following recent changes are documented and should be described if management chooses a date after them:
- Move of production from the retired server 10.0.1.12 to app server 10.0.1.98, database server 10.0.0.205 and NAS 10.0.0.25 on 2026-10-07 (runbook §8).
- Audit batches and migrations 156-163 (release stated in project notes; **live status [management to confirm from `auth.schema_migrations`]**) and the System Log (migration 160).
- Local-only items not in production: migration 164 and the application fixes from this VAPT; framework upgrade to 16.3.8.
- Recent product changes on `main`: removal of manual priority change and service change, "Catch me up" summary, approval e-mail codes and reminders, India-time display (git history).

**Security incidents:** the repository contains **no security incident register**. Engineering faults are recorded (for example an outage on 2026-09-22 from a build asset-path error, noted in `scripts/windows/build-for-deploy.ps1`). **[management to confirm whether any security incident has occurred and how it was handled]**

---

## Section 13. Criteria not applicable or not addressed

| Criterion area | Proposed treatment | Reason |
|---|---|---|
| Processing Integrity (PI1) | Not included (proposed) | No external reliance on processing outputs known; **[management to confirm]** |
| Privacy (P1-P8) | Not included (proposed) | Internal employee data; separate privacy review recommended **[management to confirm]** |
| Availability (A1) | Included only if management states a commitment **[management to confirm]** | No availability commitment written |
| Any specific criterion that no control addresses | Must be disclosed by management | A description must say where a criterion is not addressed |

---

## Open questions / evidence requests for management

1. Confirm the **reporting entity name**, the purpose and the reader of the description.
2. Choose the **"as of" date** for a Type I report.
3. State the **principal service commitments** (Section 2) you want to make and can support.
4. Provide **names and titles** for the people and owners in Sections 3.3 and 5.
5. Provide the **organisation chart, policy set, code of conduct and HR practices** (Section 5).
6. Describe the **risk assessment process** and provide the register if it exists (Section 6).
7. Describe **how monitoring and log review are done in practice** with evidence (Section 7).
8. Confirm the **list of vendors in use**, the contracts and any assurance reports (Section 11).
9. Confirm the **migration status on production** (`auth.schema_migrations`) and the **service settings** that decide the controls.
10. Say whether **any security incident** has occurred since go-live, and provide the record.
11. Decide whether the gaps in Section 9 will be **closed or disclosed** before any report date.
12. Decide which **independent CPA firm** to approach and who will own the relationship.
