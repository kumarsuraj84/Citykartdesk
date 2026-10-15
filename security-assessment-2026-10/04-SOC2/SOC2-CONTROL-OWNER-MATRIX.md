# SOC 2 Control Owner Matrix - CKDesk

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

A SOC 2 Type II examination asks, for every control, who is responsible, whether that person did the work on time, and whether someone else checked. This matrix lists every control area for CKDesk with a **proposed owner role**, a **backup owner role**, and a column for the **name**, which management must fill in. Roles are proposals only; they are written so that no person is assumed. Where a role could not be found in the repository, the control is marked **NO - none identifiable**. Where the repository shows someone does the work in practice (for example, "the user" in CLAUDE.md approving every push and deploy) but does not name them and has no backup, it is marked **PARTIAL**. The repository cannot show the organisation chart, so a role that is filled in real life but not written anywhere is also an open question for management.

Good practice for owners: the person who does a control should not be the only person who checks it (separation of duties); every owner needs a named backup; owners accept the role in writing (a dated acknowledgement, which does not exist yet).

## Summary

- Control areas listed: **33**
- Marked NO - none identifiable: **26**
- Marked PARTIAL (a de-facto role is visible, no name, no backup): **7**
- Areas with a named, accepted owner today: **0**

## Matrix

| # | Control area | Controls | Proposed owner role | Backup owner role | Name | Owner identifiable today? | Basis (what the repository shows) |
|---|---|---|---|---|---|---|---|
| 1 | Governance and management oversight of security | C14, C13, CG | Executive Sponsor | Deputy Executive Sponsor (Director level) | Name: to be assigned by management | NO - none identifiable | No named security owner, DPO or management review in the repository (inventory section 1). |
| 2 | Information security policy ownership and annual review | C14 | Information Security Lead | Compliance Coordinator | Name: to be assigned by management | NO - none identifiable | No approved policy set found. |
| 3 | Risk assessment and risk acceptance | C13 | Information Security Lead | Executive Sponsor | Name: to be assigned by management | NO - none identifiable | No risk register or assessment found. |
| 4 | User provisioning (joiners and movers) | C01 | IT Operations Lead | Application Owner | Name: to be assigned by management | PARTIAL - de-facto role only, no name | Accounts are created by admins in the Users screen, but the repository names no person or request approver; CLAUDE.md names only the project owner as approver of changes, not of access. |
| 5 | User deprovisioning (leavers) and HR trigger | C01 | HR Lead | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | No leaver procedure or HR trigger found. |
| 6 | Quarterly access review | C02 | Application Owner | Information Security Lead | Name: to be assigned by management | NO - none identifiable | No access review ever recorded. |
| 7 | Privileged access (platform owners, admins, server keys, postgres password, service-role key) | C03 | Information Security Lead | Executive Sponsor | Name: to be assigned by management | NO - none identifiable | Key and password custody not described; shared Administrator account. |
| 8 | Authentication settings (password rules, MFA, session limits, sign-up switch) | C01, C03 | Application Owner | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | Settings are in a service file on the server; no owner named; open decisions D-036/D-037. |
| 9 | Change approval and release to production | C04 | Application Owner (approver) and Development Lead (releaser) | Deputy approver (to be appointed) | Name: to be assigned by management | PARTIAL - de-facto role only, no name | CLAUDE.md and the runbook name "the user" (the project owner) as the one who gives the explicit OK; the person is not named in the repository and no backup approver exists. |
| 10 | Development and code quality (tests, lint, type check, CI) | C04, C05 | Development Lead | Second developer or reviewer (to be appointed) | Name: to be assigned by management | PARTIAL - de-facto role only, no name | One developer identity commits everything; role not formally assigned. |
| 11 | Database migrations and superuser database work on 10.0.0.205 | C04, C07 | Database Administrator | IT Operations Lead | Name: to be assigned by management | PARTIAL - de-facto role only, no name | The runbook says the project owner runs DDL as postgres; no formal DBA role or backup is named. |
| 12 | Vulnerability scanning and remediation tracking | C05 | Information Security Lead | Development Lead | Name: to be assigned by management | NO - none identifiable | No standing process; one-off VAPT only. |
| 13 | Penetration testing (independent) | C16 | Information Security Lead | Executive Sponsor | Name: to be assigned by management | NO - none identifiable | None performed independently. |
| 14 | Patching of servers, database, NAS and runtime | C06 | IT Operations Lead | Database Administrator | Name: to be assigned by management | NO - none identifiable | No patch owner or schedule found. |
| 15 | Dependency and framework updates (npm) | C06, C05 | Development Lead | Second developer | Name: to be assigned by management | PARTIAL - de-facto role only, no name | Done ad hoc by the developer; no owner role defined. |
| 16 | Backups (database, attachments, configuration) | C07 | Database Administrator | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | The task runs on 10.0.0.205; who owns it and the script is not in the repository. |
| 17 | Restore testing | C07, C11 | Database Administrator | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | No restore test recorded; no owner. |
| 18 | Business continuity and disaster recovery | C11 | Executive Sponsor | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | No plan found. |
| 19 | Server and network operations (10.0.1.98, firewall, port forward, services, scheduled tasks) | C03, C06, C09 | IT Operations Lead | Network administrator (to be appointed) | Name: to be assigned by management | PARTIAL - de-facto role only, no name | The runbook describes the setup and the project owner performs operations by ssh; no formal role. |
| 20 | NAS administration (10.0.0.25) | C07, C03 | IT Operations Lead | Storage administrator (to be appointed) | Name: to be assigned by management | NO - none identifiable | NAS administration holders not described. |
| 21 | Security monitoring and log review | C09 | Information Security Lead | Application Owner | Name: to be assigned by management | NO - none identifiable | Nobody is defined as reviewer of the System Log. |
| 22 | System Log and application audit trail administration (retention, export, integrity check) | C09 | Application Owner | Information Security Lead | Name: to be assigned by management | NO - none identifiable | Feature exists; owner not defined. |
| 23 | Alerting and on-call response | C08, C09 | Information Security Lead | IT Operations Lead | Name: to be assigned by management | NO - none identifiable | No alerting; the WhatsApp runbook refers to a technical escalation owner by title only. |
| 24 | Incident response | C08 | Information Security Lead | Executive Sponsor | Name: to be assigned by management | NO - none identifiable | No plan or roster. |
| 25 | WhatsApp pilot monitoring (daily checks) | C08, C09 | Pilot monitoring owner | Technical escalation owner | Name: to be assigned by management | PARTIAL - de-facto role only, no name | The pilot documents name roles by title ("pilot monitoring owner", "technical escalation owner") but state no person is named yet. |
| 26 | Vendor and supplier management | C10 | Vendor Relationship Owner | Procurement / Legal | Name: to be assigned by management | NO - none identifiable | No supplier register found. |
| 27 | Security awareness and training | C12 | HR Lead | Information Security Lead | Name: to be assigned by management | NO - none identifiable | No programme or records found. |
| 28 | Key and secret management and rotation | C15 | IT Operations Lead | Database Administrator | Name: to be assigned by management | NO - none identifiable | Locations described; no owner or interval. |
| 29 | Data protection, classification and retention (including privacy duties) | C14, C13 | Executive Sponsor (or appointed data protection lead) | Application Owner | Name: to be assigned by management | NO - none identifiable | No classification scheme, data inventory or privacy notice found. |
| 30 | Physical and environmental security of servers, NAS and developer PC | C11, C03 | IT Operations Lead | Facilities Manager (to be appointed) | Name: to be assigned by management | NO - none identifiable | No facility description found. |
| 31 | Endpoint security of the developer PC and the administration PC | C03, C15 | IT Operations Lead | Information Security Lead | Name: to be assigned by management | NO - none identifiable | Not stated in the repository. |
| 32 | Evidence collection, examination coordination and auditor liaison | CG | Compliance Coordinator | Information Security Lead | Name: to be assigned by management | NO - none identifiable | No such role exists. |
| 33 | Exception register and risk acceptance sign-off | C05, C13, CG | Information Security Lead (register), Executive Sponsor (acceptance) | Compliance Coordinator | Name: to be assigned by management | NO - none identifiable | No register existed before this assessment. |

## Role definitions (proposed, for management to adjust)

| Role | What this person does for CKDesk |
|---|---|
| Executive Sponsor | Accountable to the organisation for security of CKDesk; approves policies, accepts risks, signs management assertions. |
| Information Security Lead | Runs the security programme: reviews logs, tracks findings, owns policies, incidents and exceptions. Should not be the person who deploys code. |
| IT Operations Lead | Looks after servers, network, patching, services, scheduled tasks and secret rotation on 10.0.1.98 and the NAS. |
| Database Administrator | Looks after PostgreSQL on 10.0.0.205: backups, restores, superuser work, migrations. |
| Development Lead | Owns the code, tests, dependency updates and the release procedure. |
| Application Owner | Business owner of CKDesk: approves releases and access policy, owns user access reviews. |
| HR Lead | Joiner and leaver information, awareness training, acknowledgements. |
| Vendor Relationship Owner | Supplier register, supplier reviews, contracts. |
| Compliance Coordinator | Keeps the evidence calendar, collects evidence, prepares for the auditor. |
| Independent Reviewer | A person who is not the operator and who checks that evidence is real and complete. |

## Open questions / evidence requests for management

1. Fill in the Name column for every area; give each owner a backup who is a different person.
2. Say whether one person currently fills several roles (for example the project owner as approver, DBA and server administrator). If yes, name the independent reviewer who will check that person's controls.
3. Provide an organisation chart or role list that shows who has authority over CKDesk (Not known from the repository — management to confirm).
4. Confirm whether the "pilot monitoring owner" and "technical escalation owner" for the WhatsApp pilot have been named, and who.
5. Provide written acceptance (dated) of each owner role once names are filled in. Do not date it earlier than the day it is really signed.
