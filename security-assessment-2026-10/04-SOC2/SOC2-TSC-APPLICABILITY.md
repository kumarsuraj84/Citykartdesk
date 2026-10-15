# SOC 2 Type I Readiness - Trust Services Categories: Applicability Decisions

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

SOC 2 has five "Trust Services Categories". **Security** (called the Common Criteria, CC1-CC9) is always included. The other four are optional and chosen by management because they match what the service promises: **Availability** (A1), **Confidentiality** (C1), **Processing Integrity** (PI1) and **Privacy** (P1-P8). This file gives a *proposal* for each, with reasons taken from the repository. **Management decides; an independent CPA firm confirms.** Where the exact wording of a criterion is not certain, it is marked **PROVISIONAL — confirm against the licensed standard (AICPA Trust Services Criteria)**.

Evidence classes: **A** verified LOCAL test · **B** repository · **C** authorised organisational evidence (none supplied) · **D** documentation only · **E** missing. Nothing from this assessment is deployed; production runs build 20261015-145217 (main `717e5c6`).

An important framing fact: CKDesk is an **internal help desk**; the repository shows **no external customer** and **no written commitment** to anyone about security, availability, accuracy or privacy. In SOC 2, the categories are chosen from the *commitments the service makes*. So the reasoning below says what is known and what management must confirm (see `SOC2-SYSTEM-BOUNDARY.md` §1 for the "who is the reader" question).

## Summary of proposals

| Category | Criteria | Proposal | Confidence | Deciding fact management must supply |
|---|---|---|---|---|
| Security | CC1-CC9 | **IN** (always) | High | None needed for inclusion |
| Availability | A1.1-A1.3 | **IN, conditional** (assess it now; include in any report only if management states an availability commitment) | Medium | Is there any commitment (written or in practice) that staff can rely on the help desk being up, or on getting data back? |
| Confidentiality | C1.1-C1.2 | **IN** | High | Which information is promised to be confidential, and to whom (HR / finance tickets, internal notes)? |
| Processing Integrity | PI1.1-PI1.5 (PROVISIONAL count) | **OUT for the first assessment; revisit** | Medium | Do other parties rely on CKDesk approvals, SLA figures or reports for money, contract or legal decisions? |
| Privacy | P1-P8 | **OUT of the SOC 2 scope; recommend a separate privacy review** | Medium | What law and what promises apply to the personal data, and who is the owner? |

Counts in the matrix (`SOC2-TYPE-I-CONTROL-DESIGN-MATRIX.md`) cover **CC (33 criteria) + A1 (3) + C1 (2) = 38**. PI and P are not in the matrix because they are proposed OUT.

---

## 1. Security (Common Criteria CC1-CC9) — proposed IN

**Reasoning.** Security is the base category. CKDesk holds personal data of about 553 accounts, internal notes, approvals, mailbox credentials and attachments, and is reachable from the internet over plain HTTP (D-018, VA-API-01). It has role-based access, an audit log with a hash chain, and a large security test suite (Inv. §6, §8). All of the following nine groups are therefore in scope: CC1 control environment, CC2 communication, CC3 risk assessment, CC4 monitoring of controls, CC5 control activities, CC6 logical and physical access, CC7 system operations, CC8 change management, CC9 risk mitigation (business disruption and vendors).

**Note on CC6.4 (physical access).** The repository says nothing about premises. It stays in scope but can only be answered with evidence from whoever runs the rooms (class C).

---

## 2. Availability (A1) — proposed IN, conditional

### What the repository shows

| Question | Finding | Class |
|---|---|---|
| Is there an availability commitment or SLA **to users** for the system? | **None found.** The "SLA policies" in CKDesk are for *tickets* (response / resolution times for requests), not uptime of the tool itself. No uptime target, maintenance window or published status in any document read. Search for "uptime" finds only the health-check endpoint (`/api/health`) and a load-test acceptance report. | B/D |
| Is the help desk operationally important? | Yes in practice: IT, HR and other support tickets, approvals, SLA clocks and e-mail intake run through it; approval links and CSAT links are e-mailed to staff. | B |
| Backup and recovery design? | Nightly `pg_dump` at 02:30 with 30 days kept, written restore steps — but **no second copy** ("Not done yet"), **no recorded restore test**, backup script not in the repo, vault key and DB settings not in the dump (Inv. §9). | D/E |
| Redundancy? | Single app server, single database server, single NAS, single router NAT, single shared mailbox. No replica, standby or failover (Inv. §10). | D |
| Capacity evidence? | Target-scale capacity (220 requesters / 60 technicians) was **not verified** in the 2026-09-17 acceptance report; later performance work on the audit stack (100k and 500k tickets) exists. No capacity monitoring (Inv. §10). | D |
| Monitoring and alerting for outages? | Health endpoint exists; **no uptime probe, no alert** (Inv. §8, §10). | B (absence) |

### Recommendation

**Propose IN (conditional).** Reasons:
1. The largest design weaknesses in the whole assessment sit in availability and recovery (no off-server backup copy, no restore test, no DR plan). Leaving A1 out would hide them, even though they would still be visible under CC9.1 and CC7.5.
2. Staff rely on the tool daily, so an implied commitment exists even if none is written.

**Condition.** A1 can only be *in a report* if management states, in writing, what it commits to (for example, "support hours availability target" and "recovery objective"). Without a stated commitment there is nothing for an auditor to test the criteria against. If management prefers not to commit, mark A1 OUT of any report and keep the improvement work anyway.

**What management must confirm.** (a) Any availability target or commitment, even informal. (b) Business hours of the service and tolerable downtime. (c) How much data loss is acceptable (the nightly backup means up to about 24 hours of loss). (d) Who is on call.

---

## 3. Confidentiality (C1) — proposed IN

### What the repository shows

| Question | Finding | Class |
|---|---|---|
| Does CKDesk hold information that must be kept confidential? | Yes. **Internal notes** hidden from requesters (D-015, VA-INT-01/03). **HR and finance style tickets** — and the finding D-005: no confidentiality tier exists, so every manager, admin and platform owner can read every team's tickets (`requests_select`; `migrations/158:34-47`). Mailbox and channel credentials in the vault. Approval decisions. Staff mobile numbers (VA-INT-13, fixed locally only). Attachments of any kind. E-mails from outside parties. | B/A |
| Is there an explicit confidentiality commitment? | None in the repository. The earlier decision **D-005 was left as "Requires user approval"** (owner decision pending). | D |
| Is there a classification scheme or handling rule? | **No** (Inv. §11). | E |
| Are there technical confidentiality controls? | Yes: row-level security on every table; internal flag copied to attachments (local fix, `uploadAttachment`, M164); recipients of internal-note notifications filtered (VA-INT-03, local); secrets encrypted in the vault. But in transit the site is plain HTTP, and key management is thin (shared JWT secret, 10-year keys, vault key not backed up). | A/B |
| Disposal of confidential information? | Retention rows exist but **no job enforces them** except the System Log and Event Log; no anonymisation or delete function; retired server still holds archive data (Inv. §11, §14). | B |

### Recommendation

**Propose IN.** The service is explicitly built to separate what a requester may see from what staff may see (internal notes, team boundaries), and the open D-005 decision is a confidentiality design question. A report that left Confidentiality out would not cover the issue the owner has already flagged.

**What management must confirm.** (a) Decision on D-005 (restricted teams: yes/no, which teams). (b) Whether any third party was promised confidential handling of their information (suppliers, vendors e-mailing the mailbox). (c) A classification scheme and retention periods. (d) Whether the retired server's archive data will be deleted.

---

## 4. Processing Integrity (PI1) — do NOT assume; analysis

SOC 2 "Processing Integrity" asks whether system processing is **complete, valid, accurate, timely and authorised**, measured against the *service's own commitments* (PROVISIONAL: the category has five criteria, PI1.1-PI1.5, covering definitions of processing, inputs, processing, outputs and stored items — confirm against the licensed standard).

### Actual processing activities in CKDesk

| Activity | What the repository shows (class B unless noted) | Integrity-relevant controls found |
|---|---|---|
| Ticket creation (web form, e-mail, WhatsApp) | Server creates tickets; requester can set only allowed fields (VA-TKT-08, local); direct DB insert dropped (VA-DB-02, M164, local); one ticket per e-mail message (unique index, migration 162) | Duplicate prevention, field whitelist |
| Ticket numbers | Single counter with overflow fix (migration 159) | Tested (remediation 80) |
| Status changes | Database transition guard (migration 163), `lib/constants/request-transitions.ts` | Tested (118) |
| SLA clocks, due dates, priority | Priority from sub-category / SLA / rule; database refuses priority and SLA edits when status is unchanged (VA-DB-01, M164 **local only**); in production a technician / manager can still edit through the data API (R-1, A-tested) | Partial |
| Approvals | Decision, self-approval refused, 7-day signed link, one-time code hashed with attempts (migration 161), atomic counting (local) | Tested; side doors remain (VA-TKT-07) |
| Reports, exports, dashboards | Paging helper throws on error and flags truncation (D-019); cached 60 s; CSV safe writer; SLA breach logic duplicated in several places (D-049 partial) | Partial |
| Scheduled jobs | "Claim first, then act" for business rules, reply sync, CSAT (D-042/D-063); alerts job not (D-042 partial) | Partial |
| Reply-by-e-mail | Sender must be a ticket participant (VA-INT-02, local); sender authenticity header check (D-028) | Partial |
| DeskTime sync | Imports time / usage by e-mail; no reconciliation control found | None found |

### What is **not** known

- **No written processing commitment** to any user or other party: no statement such as "reports are accurate to X" or "SLA times are calculated by rule Y and may be relied on for Z".
- Whether anyone **outside CKDesk relies on its numbers** for a binding decision: for example, do vendor SLA charges, penalties, staff appraisals or payments rely on CKDesk's SLA reports? Do approvals in CKDesk authorise spending? The repository cannot say.
- Whether DeskTime or SLA data is used for performance appraisal of staff (which would raise the integrity stakes).

### Recommendation

**Propose OUT for the first readiness assessment, and revisit once management answers the question above.** Reasons: (1) no commitment about processing exists to test against; (2) the report would add effort without a decided reader; (3) the processing-integrity controls that matter most are already partly exercised under CC5, CC7 and CC8. **However:** the repository holds more processing integrity design than most internal tools (status guard, atomic claims, paging errors) and the open items (R-1, VA-TKT-07, SLA report duplication) are real. If management confirms that approvals or SLA reports drive financial or contractual decisions, the answer should become **IN**.

**If PI1 were added, expect these gaps:** no documented definition of processing and of "correct" output; priority / deadline integrity bypass through the data API (R-1 / VA-TKT-01 rest); no reconciliation of reports; no monitoring of failed jobs beyond the System Log.

---

## 5. Privacy (P1-P8) — do NOT assume; analysis

The SOC 2 Privacy category covers how a service organisation handles **personal information collected from data subjects** (people the data is about): notice, choice and consent, collection, use / retention / disposal, access, disclosure, quality, and monitoring and enforcement (PROVISIONAL: eight sub-areas P1-P8 — confirm against the licensed standard).

### Personal information actually processed (Inv. §11)

| Data | Who it is about | Source |
|---|---|---|
| Name, e-mail, employee id, job title, manager, department, location, store, cost centre, designation, avatar | Employees (about 553 accounts) | Admin creates accounts (invitation or CSV) |
| One or more mobile numbers per profile; WhatsApp opt-in | Employees | Admin / profile |
| Ticket text, attachments, internal notes, CSAT | Employees, sometimes other people named in tickets | Users |
| E-mail bodies and sender addresses; WhatsApp numbers, messages, media | **Employees and people outside Citykart** | Mail / WhatsApp intake |
| DeskTime: time, projects, **application usage** per person | Employees (monitoring) | Sync from DeskTime |
| Event Log (page views, clicks), IP address, user agent | Employees | Automatic |
| Web Push endpoints | Employees | Browser |

### What is known and what is missing

- **Known:** the data is mainly employee data, collected for employment and operations. Every user is an authorised account holder (no public sign-up).
- **Not found (E):** privacy notice to staff, record of processing, legal basis, data-subject request procedure (access / correction / deletion), retention schedule that is enforced, DPIA, breach notification duty, cross-border transfer register, data processing terms with Google / Meta / DeskTime / Groq (Inv. §11). A rule exists that notes must not hold passwords (a data-minimisation measure).
- **Not known:** applicable law and the owner. India's Digital Personal Data Protection Act, 2023 is named here only as a prompt for management and legal counsel to check — **PROVISIONAL, not a legal opinion**.
- **No deletion function** exists (only deactivation), so a deletion request could not be met today.

### Recommendation

**Propose OUT of this SOC 2 assessment, but do not ignore privacy.** Reasons:
1. The SOC 2 Privacy category is designed for a service organisation's *customers' individuals*; here the "data subjects" are Citykart's own employees and correspondents, and no privacy commitments to them are written.
2. The right first step is a **separate privacy review** (data inventory, notice, legal basis, retention, subject rights), owned by someone management names, because it needs legal input that the repository cannot give.
3. Privacy-related technical controls (access control, encryption, logging) are already covered under Security and Confidentiality.

**Triggers to bring Privacy IN:** a customer / group company / regulator requests it; CKDesk is offered to third parties; the DeskTime or WhatsApp use expands.

**If P1-P8 were added, expect gaps:** no notice, no consent / choice record, no inventory, retention not enforced, no subject-access or deletion procedure, no disclosure register, no quality or monitoring process.

---

## Open questions / evidence requests for management

1. Confirm the **reader and purpose** of the assessment (see boundary file §1) — it decides whether categories beyond Security are needed.
2. Availability: state any **availability target, support hours, maximum tolerable downtime and acceptable data loss**, even if informal; say whether to commit to them in writing.
3. Confidentiality: give the **decision on D-005** (restricted teams) and list teams whose tickets must be restricted (for example HR, finance).
4. Confidentiality: provide any **confidentiality promise** made to staff, suppliers or others (policy, contract, NDA).
5. Processing integrity: say whether **approvals, SLA reports or DeskTime data** are used for payments, penalties, appraisals or contracts.
6. Privacy: name an **owner for privacy**, the **applicable law(s)**, and whether a privacy notice / DeskTime monitoring notice has been given to staff.
7. Provide the **data protection / retention schedule** management wants (periods per data type) and confirm whether the 5-year `retention_policies` values reflect policy.
8. Provide **contracts / data terms** with Google, Meta, DeskTime and Groq (if used).
9. Decide on the **timing**: assess Security + Confidentiality (+ Availability) first, then Processing Integrity and Privacy later?
10. Decide whether an **independent CPA firm** will be approached, and who will own that relationship.
