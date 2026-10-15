# ISO/IEC 27001:2022 - Clause 4 to 10 Gap Assessment for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

ISO/IEC 27001:2022 clauses 4 to 10 are the "management system" requirements: the rules for running an Information Security Management System (ISMS). Annex A (the 93 controls) is a separate list and is not assessed here. For each clause this file gives: the requirement in plain words, what the repository shows (with file names), the evidence class, a state, the gap, a recommended action and a suggested owner role.

- **I do not have the licensed standard open.** The requirement text below is my own plain-English summary of the clause. Where I am not sure of the exact scope or numbering, it is marked **PROVISIONAL — confirm against the licensed standard**.
- **The 2022 edition ends at clause 10.2** (10.1 Continual improvement; 10.2 Nonconformity and corrective action). There is no 10.3 in the 2022 edition; the order of 10.1 and 10.2 differs from the 2013 edition. PROVISIONAL — confirm against the licensed standard.
- **Evidence classes:** A verified local technical test evidence · B repository evidence · C authorised organisational evidence (approved policies, signed records; **none has been supplied**) · D documentation-only · E missing / not verified.
- **States:** Designed · Implemented · Tested · Operating with evidence · Not implemented · Not verified · Not applicable. A document or script existing does not prove the control operates. Because no Class C evidence exists, **no clause below can be shown as "Operating with evidence"**.
- **"Not implemented" here means:** the repository was searched and nothing exists; management might hold such records elsewhere, and if it supplies them the state would change to "Not verified" until an auditor sees the records operating.
- Nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`), without the assessment's LOCAL fixes.

Evidence sources: `security-assessment-2026-10/01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md` (sections cited as "Inv. n"), `.../03-EXISTING-AUDIT-RECONCILIATION.md`, `security-assessment-2026-10/05-REMEDIATION/00-FINDING-STATUS-TABLE.md`, `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, `CLAUDE.md`.

---

## 1. Summary table

| Clause | Topic | Class | State | Biggest gap |
|---|---|---|---|---|
| 4.1 | Context of the organisation | E (draft by assessment) | Not implemented | No approved context analysis |
| 4.2 | Interested parties | E (draft) | Not implemented | No requirements register; legal register missing |
| 4.3 | Scope | E (draft) | Not implemented | No approved scope statement |
| 4.4 | The ISMS and its processes | E | Not implemented | No ISMS exists as a system |
| 5.1 | Leadership and commitment | E | Not verified | No management commitment evidence |
| 5.2 | Policy | E | Not implemented | No information security policy |
| 5.3 | Roles, responsibilities, authorities | D / E | Not implemented | No named ISMS roles |
| 6.1.1 | Actions to address risks and opportunities (general) | E | Not implemented | No planning |
| 6.1.2 | Risk assessment | E | Not implemented | No method, criteria or register |
| 6.1.3 | Risk treatment | B / E | Not implemented | No treatment plan or Statement of Applicability |
| 6.2 | Security objectives | E | Not implemented | No objectives |
| 6.3 | Planning of changes | E | Not implemented | No change control for the ISMS |
| 7.1 | Resources | E | Not verified | No resourcing decision |
| 7.2 | Competence | E | Not verified | No competence records |
| 7.3 | Awareness | E | Not verified | No training/awareness records |
| 7.4 | Communication | E | Not verified | No communication plan |
| 7.5 | Documented information | B / D | Designed (partial) | No document control; many stale documents |
| 8.1 | Operational planning and control | B / D | Designed (partial) | Controls written but not shown operating |
| 8.2 | Risk assessment (performing it) | E | Not implemented | Never performed |
| 8.3 | Risk treatment (performing it) | A / B | Not implemented (as ISMS) | Technical fixes are LOCAL only |
| 9.1 | Monitoring, measurement, evaluation | B / D | Implemented (technical logging) / Not implemented (review) | Nobody defined to review logs; no metrics |
| 9.2 | Internal audit | E | Not implemented | No programme; no independent auditor |
| 9.3 | Management review | E | Not implemented | No review ever held |
| 10.1 | Continual improvement | B / D | Not verified | Informal only |
| 10.2 | Nonconformity and corrective action | B / D | Designed (partial) | No formal register or root-cause records |

Count of the 25 clause rows by primary state: Operating with evidence 0 · Tested 0 · Implemented 0 · Mixed 1 (9.1: technical logging is Implemented, review and measurement Not implemented) · Designed (partial) 3 (7.5, 8.1, 10.2) · Not verified 6 (5.1, 7.1, 7.2, 7.3, 7.4, 10.1) · Not implemented 15 (4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 6.1.1, 6.1.2, 6.1.3, 6.2, 6.3, 8.2, 8.3, 9.2, 9.3). For 4.1-4.3 a draft prepared by this assessment exists but is not approved by management, so it does not change the state.

The honest headline: **the technology controls are strong in places, but the ISMS management system around them does not yet exist in any form the repository can show.** Without Class C evidence this cannot be improved by writing more code.

---

## 2. Clause 4 - Context of the organisation

### 4.1 Understanding the organisation and its context

| Item | Content |
|---|---|
| Requirement (own words) | Work out the outside and inside issues that can affect the ISMS achieving its intended results, and keep that understanding current. |
| What the repository shows | No context analysis. `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §1 and `CLAUDE.md` describe the infrastructure and working rules; `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md` lists open decisions. A first draft of the context is in `security-assessment-2026-10/03-ISO27001/ISO27001-SCOPE-AND-CONTEXT.md` section 2 (written by the assessment, not by management). |
| Evidence class | E (D for the infrastructure description) |
| State | Not implemented (draft prepared, not approved) |
| Gap | No management-owned, approved, dated context statement; no review cycle. Legal, contractual and customer drivers unknown. |
| Recommended action | Management reviews and edits the draft context, signs it, and sets a yearly review. |
| Suggested owner role | Top-management sponsor with the information security lead |

### 4.2 Understanding the needs and expectations of interested parties

| Item | Content |
|---|---|
| Requirement | Identify the parties relevant to the ISMS and which of their requirements the ISMS will address (including legal and contractual ones). |
| Repository | No register. Draft table in the scope file section 3 (inferred, unconfirmed). The inventory (Inv. 11, 12) records that there is no data-protection notice, no DPAs, no supplier register. |
| Class | E |
| State | Not implemented (draft prepared, not approved) |
| Gap | No legal and regulatory register; no confirmation of needs with HR, Finance, Legal, suppliers or customers. |
| Action | Legal/compliance function builds a register of laws and contracts (including staff-data law, monitoring notices for DeskTime data); the information security lead confirms expectations with the main parties. |
| Owner role | Legal/compliance function; information security lead |

### 4.3 Determining the scope of the ISMS

| Item | Content |
|---|---|
| Requirement | Decide and document the boundaries and applicability of the ISMS, taking account of 4.1, 4.2 and the interfaces and dependencies with other organisations. The scope must be available as documented information. |
| Repository | None approved. A proposed scope (application, three production hosts, NAS, dev PC, integrations, roles; with interfaces) is in `ISO27001-SCOPE-AND-CONTEXT.md`. |
| Class | E |
| State | Not implemented (draft prepared, not approved) |
| Gap | Scope not decided; shared servers (10.0.1.98 hosts another application; 10.0.0.205 hosts other databases) need a clear boundary; physical locations unknown. |
| Action | Management decides CKDesk-only or wider scope, signs the scope statement, records the shared-host boundary. |
| Owner role | Top-management sponsor |

### 4.4 Information security management system

| Item | Content |
|---|---|
| Requirement | Establish, implement, maintain and continually improve an ISMS, including the processes needed and how they interact. |
| Repository | There is no ISMS process model. Pieces exist separately: change and deploy runbook (`docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4-§5, D), System Log (`docs/SYSTEM-LOG.md`, B), audit and fix reports (B), test suite (268 test files, B; run by hand, no CI: Inv. 6). |
| Class | B / D for pieces; E for the system |
| State | Not implemented |
| Gap | No list of ISMS processes, owners, inputs/outputs or interaction; no PDCA (plan-do-check-act) loop. |
| Action | Define the ISMS as a small set of processes (risk, access, change, backup, incident, supplier, log review, audit, review) with owners; this register's policy list (`ISO27001-POLICY-REGISTER.md`) is a starting point. |
| Owner role | Information security lead |

---

## 3. Clause 5 - Leadership

### 5.1 Leadership and commitment

| Item | Content |
|---|---|
| Requirement | Top management must show leadership: set the policy and objectives, make sure ISMS requirements are part of business processes, provide resources, communicate importance, ensure results, direct and support people, promote improvement. |
| Repository | `CLAUDE.md` shows the owner takes decisions on deploy and holds open decisions (D-005, D-011, D-018, second backup copy). That shows involvement in operations, not ISMS leadership. |
| Class | D (as to involvement); E (as to the ISMS) |
| State | Not verified |
| Gap | No minutes, resourcing decision, policy sign-off or objectives set by top management. |
| Action | Management signs scope and policy; attends the first management review (`ISO27001-MANAGEMENT-REVIEW-READINESS.md`). |
| Owner role | Top-management sponsor |

### 5.2 Policy

| Item | Content |
|---|---|
| Requirement | Top management sets an information security policy that fits the organisation, includes objectives (or a framework for them), commits to meet requirements and to improve, is documented, communicated within the organisation and available to interested parties as appropriate. |
| Repository | No information security policy, acceptable use policy or similar (Inv. 1, class E). `CLAUDE.md` contains operating rules for developers and AI assistants, which are not a policy. A DRAFT policy outline is in `ISO27001-POLICY-REGISTER.md`. |
| Class | E |
| State | Not implemented |
| Gap | No approved policy; no communication to staff; no review date. |
| Action | Management reviews and approves a short top-level policy; publishes it to staff (CKDesk itself could host it). |
| Owner role | Top-management sponsor; information security lead drafts |

### 5.3 Organisational roles, responsibilities and authorities

| Item | Content |
|---|---|
| Requirement | Top management assigns and communicates responsibilities and authorities for (a) ISMS conformity to the standard and (b) reporting ISMS performance to top management. |
| Repository | Software roles exist and are enforced (`lib/constants/roles.ts`; `lib/admin/target-guard.ts`; RLS) - B, tested (`tests/unit/target-guard.test.ts`). They describe system permissions, not ISMS duties. Business roles for the WhatsApp pilot are only titles with no name ("once named", `PILOT_MONITORING_SCORECARD.md`). All 271 commits share one author identity; one person approves every push/deploy (`CLAUDE.md`). |
| Class | B (software roles) / D (pilot titles) / E (ISMS roles) |
| State | Not implemented for ISMS roles (software roles: Implemented and Tested) |
| Gap | No named information security lead, risk owners, asset owners, release approver independent of the developer, log reviewer, or internal auditor. |
| Action | Appoint and record the roles listed in the scope file section 5; add a simple RACI. |
| Owner role | Top-management sponsor |

---

## 4. Clause 6 - Planning

### 6.1.1 General (actions to address risks and opportunities)

| Item | Content |
|---|---|
| Requirement | Plan, using the context (4.1) and the interested parties' needs (4.2), the risks and opportunities to address so the ISMS can achieve its results, prevent or reduce unwanted effects and achieve improvement; plan how to integrate and evaluate these actions. |
| Repository | None as a plan. The audit defect register tracks vulnerabilities (`audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`, B/D); the VAPT status table (`05-REMEDIATION/00-FINDING-STATUS-TABLE.md`) does the same. These cover technical weaknesses only. |
| Class | E |
| State | Not implemented |
| Gap | Business, supplier, people and physical risks are not planned for. |
| Action | Combine 4.1/4.2 results into a short risk and opportunity list reviewed by management. |
| Owner role | Information security lead |

### 6.1.2 Information security risk assessment

| Item | Content |
|---|---|
| Requirement | Define and apply a risk assessment process: risk acceptance criteria and criteria for performing assessments; consistent, valid, comparable results; identify risks and risk owners; analyse likelihood and consequence; evaluate against criteria; keep the results as documented information. |
| Repository | No risk assessment method, criteria, asset register or risk register (Inv. 1). The earlier audits and this VAPT are technical vulnerability work, not risk assessment: they rank defects (Critical/High/Medium/Low) but do not rate business impact, assign risk owners or record acceptance. Open items such as D-005, D-011, D-018 have no recorded risk acceptance. |
| Class | E |
| State | Not implemented |
| Gap | Entire process. Asset inventory exists only as a server list. |
| Action | Agree a simple scoring method (for example 1-5 likelihood x 1-5 impact), build an asset list (see scope file section 4.1), run a first assessment, and have risk owners accept or treat each risk in writing. |
| Owner role | Information security lead, with the CKDesk owner as risk owner for system risks |

### 6.1.3 Information security risk treatment

| Item | Content |
|---|---|
| Requirement | Choose treatment options; determine all controls needed (compare with Annex A and justify omissions); produce a Statement of Applicability (SoA) stating controls, whether implemented, and why any are excluded; formulate a treatment plan; obtain risk owners' approval of the plan and acceptance of residual risk. |
| Repository | No treatment plan or SoA. Technical treatment is visible: the 2026-10 VAPT fixed or planned fixes for findings (32 rows in section A and 15 rows in section B of the status table; many IDs per row), with Class A before/after tests for many; **all LOCAL, nothing deployed**. Earlier audit fixes (migrations 156-163) were released on 2026-10-14 per the project owner's notes (not repository evidence; production state of those migrations is Not verified). |
| Class | A / B (technical fixes), E (plan, SoA) |
| State | Not implemented as a management process; technical items Tested LOCAL |
| Gap | No SoA; no approval of residual risk. Open decisions (HTTPS, default password, D-005) have no risk-acceptance record. |
| Action | After 6.1.2, produce the SoA (93 Annex A controls, applicable or not, with reason) and a treatment plan that cites the finding IDs; risk owner signs. |
| Owner role | Information security lead; risk owners |

### 6.2 Information security objectives and planning to achieve them

| Item | Content |
|---|---|
| Requirement | Set measurable objectives at relevant levels consistent with the policy, take account of risk results, monitor them, communicate them, update as needed; say what will be done, by whom, with what resources, by when, and how results are evaluated. |
| Repository | None. The WhatsApp pilot scorecard has operational targets for that channel only (`PILOT_MONITORING_SCORECARD.md`, D). `.claude/uat/severity-matrix.md` sets fix times for UAT defects (Critical before next cycle, High 24 h, Medium before go-live), dated 2026-06-14 (D, stale template). |
| Class | E |
| State | Not implemented |
| Gap | No objectives or metrics. |
| Action | Set 4-6 objectives, for example: HTTPS live; 0 accounts with default password; restore test done every month; critical dependency advisories patched within a set number of days; privileged-user review each quarter. Targets are management's to set. |
| Owner role | Top-management sponsor; information security lead |

### 6.3 Planning of changes (new in the 2022 edition; PROVISIONAL — confirm against the licensed standard)

| Item | Content |
|---|---|
| Requirement | When a change to the ISMS is needed, make it in a planned way. |
| Repository | Technical change control exists in prose (build, deploy, migration and rollback steps: `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4-§5; `audit-2026-10/remediation/11-CHANGE-AND-ROLLBACK-PLAN.md`; `supabase/rollback/*`; `deploy-bundle-migrations-156-163/run-migrations.ps1`). Those relate to software releases, not changes to the ISMS itself. |
| Class | B / D (technical) ; E (ISMS) |
| State | Not implemented for the ISMS; software change control is Designed |
| Gap | No process for changing scope, policy or controls. Also: one approver, no independent review, no tags/release register (Inv. 5). |
| Action | State in the document-control procedure that ISMS changes need a short change note and approval by the sponsor. Treat software change control separately in the change management policy. |
| Owner role | Information security lead |

---

## 5. Clause 7 - Support

### 7.1 Resources

| Item | Content |
|---|---|
| Requirement | Determine and provide the resources needed for the ISMS. |
| Repository | Nothing on budget, staffing or time allocation. Facts that suggest resource limits: single author identity in git, no CI, no second reviewer, no off-server backup yet ("deferred by the user"). |
| Class | E |
| State | Not verified |
| Gap | Unknown whether security work is funded; second-copy backup, HTTPS and independent audit depend on it. |
| Action | Management records resourcing decisions (people, time, tools, certificate, backup storage, external test). |
| Owner role | Top-management sponsor |

### 7.2 Competence

| Item | Content |
|---|---|
| Requirement | Decide the competence needed of people who affect security performance, ensure they are competent (education, training, experience), take actions to get competence where needed and keep evidence. |
| Repository | No competence matrix, training records or certificates. Developer/AI-assistant working rules exist in `CLAUDE.md` and `AGENTS.md`. |
| Class | E |
| State | Not verified |
| Gap | No evidence; developer, server admin and DBA competence not documented. |
| Action | HR/IT list required competences per ISMS role and keep training records. |
| Owner role | HR with the information security lead |

### 7.3 Awareness

| Item | Content |
|---|---|
| Requirement | People doing work under the organisation's control must know the policy, their contribution to the ISMS, and the effects of not conforming. |
| Repository | None. No security awareness, phishing training, acceptable-use acknowledgement, or onboarding briefing was found (Inv. 15). Passwords for imported accounts follow a default pattern (D-011, open), which shows a need for awareness. |
| Class | E |
| State | Not verified |
| Gap | No programme or records for about 550 users. |
| Action | Short yearly briefing and acknowledgement (staff, technicians, admins), with extra briefing for platform owners and admins. |
| Owner role | HR; information security lead |

### 7.4 Communication

| Item | Content |
|---|---|
| Requirement | Decide what, when, with whom, by whom and how to communicate internally and externally on the ISMS. |
| Repository | CKDesk is itself a communication channel (notifications, announcements); the WhatsApp runbook names a "technical escalation owner" without a person. No communication plan, no external contact list, no breach-notification contacts (Inv. 13). |
| Class | D / E |
| State | Not verified |
| Gap | No plan; no incident communication rules. |
| Action | Short communication table (audience, topic, frequency, owner), plus incident communication contacts. |
| Owner role | Information security lead |

### 7.5 Documented information

| Item | Content |
|---|---|
| Requirement | The ISMS includes the documents the standard requires and those the organisation judges necessary; documents are identified, described, formatted, reviewed and approved; controlled for availability, protection, distribution, access, storage, preservation, change control, retention and disposition (7.5.1-7.5.3). |
| Repository | Many documents exist under `docs/` and the root, with version history in git (B). Control is weak: several documents are stale or contradict the live setup (retired server 10.0.1.12 and old `Citykart*` service names in `docs/WINDOWS-DEPLOYMENT.md` and `docs/PERFORMANCE-MAIN-SERVER.md`; Railway/Resend in `docs/ARCHITECTURE.md`; `HANDOVER.md`; `.claude/uat/*` unticked) - see Inv. "Reliability of the documents". No document owner, approval, review date or classification marks. The repo tracks `.claude/settings.local.json` although the runbook says never to commit it. |
| Class | B / D |
| State | Designed (partial) |
| Gap | No document control procedure; no approved master list; stale material mixed with current. |
| Action | Mark `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` as the controlled operations document; add status banners (current/history) to stale documents; create a document register with owner, version, approval date and review date. |
| Owner role | Information security lead (document controller) |

---

## 6. Clause 8 - Operation

### 8.1 Operational planning and control

| Item | Content |
|---|---|
| Requirement | Plan, implement and control the processes needed to meet requirements and carry out the risk-treatment actions; keep documented information to be confident they were done as planned; control planned changes and review unintended changes; control outsourced processes. |
| Repository | Controls are written and in places coded: deployment and rollback (runbook §4), migration scripts that back up first (`supabase/production/run-ckdesk-migration-155.ps1`, `deploy-bundle-migrations-156-163/run-migrations.ps1`), build gate checks (`scripts/windows/build-for-deploy.ps1`), scheduled jobs (`scripts/windows/install-cron-tasks.ps1`), log shipper (`scripts/log-shipper.mjs`), test suites (manual). Not found: CI, release register, second approver, evidence that rollback was rehearsed, backup script (`backup-db.ps1` is on 10.0.0.205 and not in the repo), restore-test record. Outsourced/supplier processes (Google, Meta, DeskTime, optional LLM): no control records (Inv. 12). |
| Class | B / D |
| State | Designed (partial); not shown operating |
| Gap | No operational evidence trail (release records, backup logs, restore test, log review); supplier controls missing. |
| Action | Introduce a release record (build id, date, approver, tests run, result), keep backup logs, record a monthly restore test, build the supplier register. |
| Owner role | CKDesk owner; server administrator |

### 8.2 Information security risk assessment (performing it)

| Item | Content |
|---|---|
| Requirement | Perform risk assessments at planned intervals or when significant changes are proposed or occur; keep results. |
| Repository | Never performed as an ISMS activity (see 6.1.2). Triggers that would require one are visible: change of servers on 2026-10-07 (migration from 10.0.1.12), new integrations (WhatsApp, Gmail API, optional LLM), the System Log, upcoming HTTPS change. |
| Class | E |
| State | Not implemented |
| Gap | No assessment, no schedule. |
| Action | First full assessment after the method is agreed; then at least yearly and at each major change (for example before WhatsApp goes beyond the pilot, before CK Desk Bot). |
| Owner role | Information security lead |

### 8.3 Information security risk treatment (performing it)

| Item | Content |
|---|---|
| Requirement | Implement the risk treatment plan and keep results as documented information. |
| Repository | Technical fixes written and tested LOCAL (Class A): for example Next.js upgrade 16.2.9 to 16.3.8 (production-dependency criticals 1 to 0, status table row VAPT-DEP-01); M164 migration (`supabase/migrations/20240101000164_vapt_security_hardening.sql`); proxy and upload fixes. **None is deployed.** Open or decision items remain: VA-API-01 (HTTP/cookies), VA-API-02 (default password), VA-DB-08 (not verified), VA-API-05, more. |
| Class | A / B |
| State | Not implemented as an ISMS process; individual fixes Tested (LOCAL), not deployed |
| Gap | No treatment plan to implement; deployment pending; open decisions undecided. |
| Action | Treat the VAPT status table as the first input to a treatment plan (`ISO27001-MANAGEMENT-REVIEW-READINESS.md` section 5); record deployment approval and result per fix. |
| Owner role | CKDesk owner; information security lead |

---

## 7. Clause 9 - Performance evaluation

### 9.1 Monitoring, measurement, analysis and evaluation

| Item | Content |
|---|---|
| Requirement | Decide what to monitor and measure, the methods to get valid results, when to monitor and measure, who does it, when and by whom results are analysed and evaluated; keep evidence; evaluate performance and effectiveness. |
| Repository | Technical logging is substantial: System Log with hash chain and "Verify integrity" (`supabase/migrations/20240101000160_system_log.sql`, `lib/actions/admin/system-log.ts`), audit triggers on 45 business tables, error capture, CSP reports, log shipper every 2 minutes, retention rules (`docs/SYSTEM-LOG.md`, Inv. 8). Monitoring page `/admin/monitoring` (counts). Missing: a defined reviewer and cadence, alert routing (`lib/monitoring.ts` is a console stub), uptime monitoring, backup failure alert on 205, metrics and thresholds, evaluation reports. Whether migration 160 and the shipper are live on production is Not verified. |
| Class | B / D |
| State | Implemented (technical logging, LOCAL-tested; production live state Not verified) for the data; Not implemented for measurement, review and evaluation |
| Gap | No one is told to read the logs; no KPIs; no evidence of review. |
| Action | Define 6-8 metrics (for example open critical advisories, failed sign-ins per week, backup success, restore test date, number of privileged users, open VAPT findings by severity); name a weekly log reviewer; add alerting for backup failure and service down. |
| Owner role | Information security lead; named log reviewer |

### 9.2 Internal audit

| Item | Content |
|---|---|
| Requirement | Conduct internal audits at planned intervals to check the ISMS conforms to the organisation's own requirements and the standard and is effectively implemented; plan a programme (frequency, methods, responsibilities, reporting); define criteria and scope; choose objective and impartial auditors; report to management; keep evidence. |
| Repository | No audit programme, no auditor appointed, no internal audit report in the ISO sense. The October 2026 audit (`CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md`, `audit-2026-10/`) and this 2026-10 assessment are technical reviews performed by the same project team with AI assistance; they are **not** independent internal audits of an ISMS (the developer cannot audit their own work). |
| Class | E |
| State | Not implemented |
| Gap | Full. |
| Action | See `ISO27001-INTERNAL-AUDIT-READINESS.md`: appoint an independent auditor, run a first audit after the ISMS basics exist. |
| Owner role | Top-management sponsor appoints; independent internal auditor performs |

### 9.3 Management review

| Item | Content |
|---|---|
| Requirement | Top management reviews the ISMS at planned intervals. Inputs include status of earlier actions, changes in issues, feedback on performance (nonconformities, monitoring results, audit results, objectives), feedback from interested parties, risk results and treatment status, and improvement opportunities. Outputs are decisions on improvements and any change needs. Keep evidence. |
| Repository | None. No minutes or agenda. A readiness pack (inputs list, agenda, blank minutes, headline inputs now available) is in `ISO27001-MANAGEMENT-REVIEW-READINESS.md`. **No review has been held; none is claimed.** |
| Class | E |
| State | Not implemented |
| Gap | Full. |
| Action | Hold a first management review once scope, policy and the first risk assessment exist; keep signed minutes. |
| Owner role | Top-management sponsor |

---

## 8. Clause 10 - Improvement

### 10.1 Continual improvement

| Item | Content |
|---|---|
| Requirement | Continually improve the suitability, adequacy and effectiveness of the ISMS. |
| Repository | Improvement is visible in practice: audits led to fixes (migrations 156-164, `docs/POST-AUDIT-BATCH-2.md`), tests grew to 268 files, System Log was built, a VAPT was run. These are product and engineering improvements, not recorded outcomes of ISMS reviews. |
| Class | B / D |
| State | Not verified (informal improvement only) |
| Gap | No improvement log tied to audits and management review. |
| Action | Keep an improvement register fed by audit results, incidents, management review and VAPT. |
| Owner role | Information security lead |

### 10.2 Nonconformity and corrective action

| Item | Content |
|---|---|
| Requirement | When a nonconformity occurs, react and control/correct it; evaluate the need to remove causes; implement actions; review effectiveness; update risks and the ISMS if needed; keep records of the nature of the nonconformity, actions and results. |
| Repository | Related practice: defect registers and fix reports (`audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`, `docs/DESK-UAT-001-FIX-REPORT-2026-09-10.md`, `docs/DESK-ALERTRULE-001-FIX-REPORT-2026-09-17.md`); an outage on 2026-09-22 from a build/asset-path error is recorded in comments of `scripts/windows/build-for-deploy.ps1`, and the script now has a check for it. This is good engineering practice but not a nonconformity register, and no security incident register exists (Inv. 13). |
| Class | B / D |
| State | Designed (partial) |
| Gap | No formal register, no root-cause template, no effectiveness check, no link to risk updates. |
| Action | Create one register for nonconformities, incidents and audit findings (ID, date, cause, action, owner, due, closure check). Seed it with the open VAPT items and the reconciliation list. |
| Owner role | Information security lead |

---

## 9. Priority order for closing the gaps

1. Management appoints the sponsor and information security lead (5.1, 5.3) and decides the scope (4.3).
2. Approve a short information security policy (5.2) and communicate it (7.3, 7.4).
3. Agree the risk method and perform the first risk assessment (6.1.2, 8.2); record acceptance or treatment of the open decisions (HTTPS, default password, D-005, backup copy).
4. Produce the Statement of Applicability and treatment plan (6.1.3), then deploy the approved fixes (8.3).
5. Set objectives and metrics, and name a log reviewer (6.2, 9.1).
6. Build the document register, the nonconformity register and the supplier register (7.5, 10.2, 8.1).
7. Appoint an independent internal auditor and run a first audit (9.2), then the first management review (9.3).

---

## Open questions / evidence requests for management

1. Does an approved information security policy, scope statement, risk register or Statement of Applicability exist anywhere outside the repository? If yes, supply the approved copies with dates and approver names (Class C).
2. Name the top-management sponsor, the information security lead, the CKDesk risk owner and the independent internal auditor.
3. Has management ever held a review of information security (minutes, agenda, date)? If not, confirm so in writing so the record is honest.
4. Provide the resourcing decision (budget, time, people) for security work in the next 12 months.
5. Provide training or awareness records for developers, administrators, technicians and all staff (or confirm none exist).
6. Provide the legal and regulatory register and any customer or regulator requirements driving certification.
7. Provide records of earlier corrective actions or incident handling outside the repository (outages, suspected breaches), or confirm none occurred.
8. Confirm whether an external or group-level ISMS already exists that CKDesk could join instead of building its own.
