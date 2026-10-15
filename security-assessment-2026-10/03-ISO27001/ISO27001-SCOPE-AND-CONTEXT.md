# ISO/IEC 27001:2022 - Proposed ISMS Scope and Context for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This file proposes what an Information Security Management System (ISMS) for CKDesk could cover, and describes the setting it would work in (clauses 4.1, 4.2 and 4.3 of ISO/IEC 27001:2022). It is a **proposal written by the assessment team from the repository only**. Nothing here has been agreed, approved or signed by management. Where only management can know a fact (who owns something, headcount, contracts, policies), the text says "Not known from the repository — management to confirm" and the item is repeated in the data requests at the end.

Evidence classes: **A** verified local technical test evidence · **B** repository evidence (source, scripts, migrations) · **C** authorised organisational evidence (approved policies, records; **none supplied so far**) · **D** documentation-only · **E** missing / not verified. Source inputs: `security-assessment-2026-10/01-BASELINE/01-APPLICATION-AND-SECURITY-BASELINE.md`, `.../04-CONTROL-EVIDENCE-INVENTORY.md`, `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, `CLAUDE.md`.

This is not a certification, and the words "ISO 27001 compliant" must not be used about CKDesk. Only an accredited certification body can certify an ISMS. Nothing from this assessment is deployed: production runs build 20261015-145217 (main `717e5c6`), which does not contain the assessment's fixes.

---

## 1. Short summary of the proposal

| Question | Proposed answer | Status |
|---|---|---|
| What would the ISMS protect? | The Citykart Desk service-desk platform and the information it holds (tickets, attachments, staff contact data, approvals, mailbox and channel content, audit logs), together with the servers, storage, tools and people that run it. | PROPOSED |
| Who is the organisation? | Citykart (staff user base of about 553 accounts at last count; 527 on the 2026-09-24 snapshot, roughly 308 head office and 214 stores). Legal entity name: Not known from the repository — management to confirm. | Management to confirm |
| Is it a whole-company ISMS or only CKDesk? | Proposed as a **CKDesk-only scope** (a "product ISMS") that treats the wider Citykart IT estate as an interface, not as part of the scope. Management may prefer a larger scope. | Management decision |
| Where is the boundary? | Inside: the application, its three production hosts, the developer machine, the admin machine that holds the server key, the integrations it calls, and the people who build, run and use it. Outside: the wider Citykart network, other applications on the shared servers, the retail stores' own IT, Citykart's ERP. | PROPOSED |

---

## 2. Organisational context (clause 4.1)

Clause 4.1 asks the organisation to understand the outside and inside issues that affect whether its ISMS can reach its goals. The list below is drawn from what the repository shows. It is a starting list for management to correct, not a finished analysis.

### 2.1 What CKDesk is for (from the repository)

CKDesk is Citykart's internal service desk (the project folder name suggests it is an alternative to a hosted service-desk product; the business reason is not recorded in the repository). Staff raise requests (IT, HR and other support teams); technicians work them; managers and administrators configure services, SLAs, approvals and reports; an "intake" module turns incoming e-mail and WhatsApp messages into tickets. At the last count the system held about 553 users and 278 tickets (Source: `security-assessment-2026-10/COMPLIANCE-WRITER-BRIEF.md`, from the project owner's figures; the 2026-09-24 snapshot in `main-server-configuration/09-teams-and-users-structure.md` shows 527 accounts: 482 requesters, 41 technicians, 2 managers, 0 admins, 2 platform owners).
Evidence class: B/D.

### 2.2 External issues (outside the company)

| Issue | What the repository shows | Effect on information security |
|---|---|---|
| Internet exposure | The app is reachable at `http://182.72.84.10:3210` through a router port forward to 10.0.1.98. It is plain HTTP today (known open item D-018 / VA-API-01). | Anyone on the internet can reach the login page; sign-in data and session cookies cross networks unencrypted. Highest-priority technical item. |
| Reliance on large cloud mail providers | Outbound mail via a Google Workspace mailbox (SMTP `smtp.gmail.com:587`) and inbound replies read over IMAP; optional Gmail API / Microsoft Graph channels. | Mail is the channel for password-reset links, invitation links, approval and CSAT links. A provider change or outage affects both availability and account security. |
| Meta WhatsApp Cloud API | A webhook and sender exist for a controlled pilot (IT and HR support); credentials stored in the database vault. Real-Meta validation was not done in earlier stage reports. | Staff mobile numbers and message content go to a third party. |
| Optional LLM provider | `generateEmailBrief` can call Groq only if `INTAKE_LLM_API_KEY` is set. Whether it is set in production is not in the repository. | Sends the subject, sender and first 2,000 characters of an incoming mail to an outside provider if enabled. |
| DeskTime | API key held in the vault; sync job reads employee time and application usage by e-mail address. | Staff activity data is collected from an outside service; a notice to staff is not in the repository. |
| Known-vulnerability pressure on the software stack | Next.js 16.2.9 (the version in production) has published advisories including remote code execution on Windows hosts; `npm audit` over production dependencies found 9 issues (1 critical, 5 high, 3 moderate). The LOCAL branch upgrades to 16.3.8; this is **not deployed**. | The platform must keep patching quickly; there is no scheduled process for it today. |
| Laws and contracts | Not known from the repository. Citykart is a retail company; employee data, customer data (if any enters tickets) and any contractual security clauses are likely to matter, including Indian data-protection law. | A legal and regulatory register does not exist in the repository. PROVISIONAL — management to confirm which laws, contracts and customer promises apply. |

### 2.3 Internal issues (inside the company)

| Issue | What the repository shows |
|---|---|
| One person holds the roles of owner, developer, approver and deployer | All 271 commits carry one author identity ("Local Setup <local@citykart.org>"); `CLAUDE.md` makes one "explicit OK" the only approval for push and deploy; no code review record. |
| Shared infrastructure | The app server 10.0.1.98 also hosts another application (Citykart Spinwheel); the database server 10.0.0.205 hosts other applications' databases; server administration is by the shared Windows `Administrator` account with one ssh key held on one admin PC. |
| Small number of single points of failure | One app server, one database server, one NAS, one router NAT, one shared Gmail mailbox. No standby, no second backup copy ("Not done yet" in the runbook). |
| Control strength is mostly in software | Strong code-level controls (row-level security, hash-chained System Log, role guards, rate limits, 268 test files). Management controls (policy set, risk assessment, access reviews, incident plan, training, supplier review) were not found in the repository. |
| Culture and resources | Not known from the repository — management to confirm (is there an IT security function, a budget, a steering group, an information security officer). |
| Open decisions recorded by the owner | HTTPS (D-018, D-037), default import password (D-011), confidentiality tier for HR/Finance-type teams (D-005), auth-service password policy (D-036), second backup copy, reboot test of 10.0.1.98. |
| Staff awareness | No training or awareness record found. All staff are users of the system; how many people run it is not known from the repository — management to confirm. |

---

## 3. Interested parties and what they expect (clause 4.2)

Clause 4.2 asks the organisation to identify the parties that matter to the ISMS and which of their needs become requirements. The needs below are **inferred from the repository and from the nature of the service**; none has been confirmed with the party itself.

| Interested party | What they probably need from CKDesk's security | Basis in the repository | Confirmed? |
|---|---|---|---|
| Top management / project owner | Reliable service, no leak of staff or business data, no unplanned outage, proof of due care if something goes wrong. | `CLAUDE.md` (owner approves every push/deploy); open-decision list. | Not known — management to confirm |
| Requesters (about 480+ staff, head office and stores) | Their requests, personal details and attachments are seen only by the right people; the service is available; password-reset and invitation mail is safe. | Row-level security; mobile-number fix VA-INT-13 (LOCAL only). | Inferred |
| Technicians and support teams (about 41) | Clear rules for who may see and change what; the tool works; no surprise changes. | Roles and RLS; "nobody can change priority" rule. | Inferred |
| Managers and administrators | Reports and configuration that cannot be tampered with by people with lower rights; audit trail. | Target-role guard; System Log. | Inferred |
| HR and Finance support teams | Confidentiality of their tickets from other teams (no tier exists today: D-005). | `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`. | Inferred, **open decision** |
| Developer / project owner's technical team | Safe way to change, test and deploy; recoverable releases. | Deploy runbook; rollback scripts. | Inferred |
| IT infrastructure team (servers, DB host, NAS, network) | Clear boundaries for what CKDesk may touch on shared servers. | `CLAUDE.md` scope rules. | Inferred |
| HR department | Leaver and joiner triggers; lawful handling of staff data (DeskTime data, mobile numbers, ticket content). | Users screen; DeskTime integration. | Not known — management to confirm |
| Legal / compliance function | A register of applicable laws; breach notification route; supplier contracts. | None found. | Not known — management to confirm |
| Citykart group / other business units sharing the servers | CKDesk does not harm their applications or data. | Shared server note in runbook. | Inferred |
| Suppliers: Google (Workspace/Gmail), Microsoft (Outlook/Graph), Meta (WhatsApp), DeskTime, optional LLM provider, GitHub, Synology (NAS), ISP/router | Correct use of their service terms and credentials; abuse limits. | See section 6. | Terms not in repository |
| Customers or end consumers of Citykart | None is shown directly; they only matter if ticket text contains their data. | Not shown. | Not known — management to confirm |
| Regulators / law enforcement | Lawful processing, breach notification, record retention. | None found. | Not known — management to confirm |
| External auditors / certification body / customers who ask for assurance | Evidence of an operating ISMS. | This assessment. | Not known — management to confirm |
| Cyber insurer (if any) | Baseline controls (backups, MFA, patching). | Not shown. | Not known — management to confirm |

---

## 4. Proposed scope of the ISMS (clause 4.3)

Clause 4.3 requires a documented scope that takes into account the issues and parties above, and the interfaces and dependencies with things outside the scope. **Proposed scope statement (DRAFT — not approved):**

> The Information Security Management System of Citykart covers the design, development, operation, support and use of the Citykart Desk service-desk platform ("CKDesk"), including the application, its production and development infrastructure, the data it processes, and the people and suppliers involved in running it, from the Citykart head office and stores. Statement of applicability: to be produced after the risk assessment.

### 4.1 In scope (proposed)

| Area | In-scope items | Evidence |
|---|---|---|
| **Application** | The Next.js web application (Server Actions, `proxy.ts`, API routes): service desk, approvals, tasks and projects, analytics and reports, Intake (e-mail, WhatsApp, OAuth channels), Administration, System Log. About 60 pages, 27 API routes, 54 server-action files with 295 exported actions. Source repository `github.com/kumarsuraj84/Citykartdesk`. | B (`01-APPLICATION-AND-SECURITY-BASELINE.md` section 2) |
| **Self-hosted back-end services** | PostgreSQL database `ckdesk`, PostgREST, GoTrue (sign-in service), Storage service, reverse-proxy service, NSSM-managed Windows services `CkDeskApp`, `CkDeskAuth`, `CkDeskPostgrest`, `CkDeskStorage`, and the proxy. | D (runbook §2-§3) |
| **Production host 1: app server 10.0.1.98** | Windows Server 2022, app folder, `.env.local` and service config files, Windows scheduled tasks (`CitykartDesk-Cron-*`, log shipper), the firewall rule for port 3210. *The other application on this server (Citykart Spinwheel) is out of scope but shares the machine.* | D |
| **Production host 2: database server 10.0.0.205** | PostgreSQL 18 instance **only the `ckdesk` database, its roles, its backup task `CK_Backup_CKDESK` and backup folder `E:\DB BACKUP\CK_CKDESK_DBBACKUP`**. Other applications' databases are out of scope. | D |
| **Production host 3: NAS 10.0.0.25** | Synology RS1221+; share `CKAPPLICATIONS_DATA`, folder `CKDESK_DATA` (attachments and sidecar files). Other NAS folders are out of scope. | D |
| **Developer PC 10.0.0.47** | Source code, local Supabase stack, local copies of data (developer dumps), signed-in developer tools and credentials. | B/D |
| **Admin PC holding the ssh key** | The PC that holds `~/.ssh/citykart_newservers`. Is this the same machine as the developer PC? Not known from the repository — management to confirm. | D |
| **Source code host** | GitHub repository (cloud). | B |
| **Retired server 10.0.1.12 ("Main")** | Kept disabled, with an archived old database and a final dump on 205. Proposed: in scope **only for secure disposal / retention decisions** (residual data). | D |
| **Information** | Tickets, comments (including internal notes), attachments, approvals and one-time codes, CSAT ratings, user profiles (name, e-mail, employee id, job title, manager, department, location, store, mobile numbers, avatar), e-mail threads and participants (Intake), WhatsApp events, push subscriptions, DeskTime time and application usage, System Log and Event Log records, configuration (rules, SLAs, services), stored secrets in the vault, signing keys and server config secrets, backups. | B (`04-CONTROL-EVIDENCE-INVENTORY.md` §11) |
| **Integrations** | Google Workspace mailbox (SMTP/IMAP), Gmail API with Pub/Sub, Microsoft Graph (Outlook), Meta WhatsApp Cloud API, DeskTime, Web Push services, optional LLM provider (Groq), optional Resend fallback. | B |
| **People and roles** | See section 5. | B/D |
| **Processes** | Joiner/mover/leaver for CKDesk accounts, change and release, backup and restore, logging and monitoring review, incident handling, supplier management for the listed suppliers, document control for ISMS records. | Proposed |

### 4.2 Out of scope (proposed) and why

| Item | Reason / what must still be said in the scope document |
|---|---|
| Other applications on 10.0.1.98 (Citykart Spinwheel) and other databases on 10.0.0.205 | Owned and operated separately. They share hardware, so the **shared-host risk stays in scope** (the app, and its protection from them and them from it, but not their content). |
| Citykart's ERP, store point-of-sale and retail systems | Not part of CKDesk. CKDesk does not connect to them per the repository. |
| General office network, store networks, Wi-Fi, Internet link, router (except the NAT rule and port 3210) | Run by the wider IT function. They are a **dependency** (section 6). |
| End-user devices (staff laptops and store PCs) and browsers | Not managed by the CKDesk team. A dependency: sessions run on them. |
| Google, Microsoft, Meta, DeskTime and LLM provider internals | Suppliers. Our scope stops at the credentials, configuration and data we give them. |
| Physical premises of the head office, stores and data room | Run by facilities management. A dependency (section 6); the scope should still state who is responsible for the room that holds 10.0.1.98, 10.0.0.205 and 10.0.0.25 (Not known from the repository — management to confirm). |
| Citykart's HR processes in general | A dependency; CKDesk needs a leaver trigger from HR. |
| Disposable VAPT/audit stack on the dev PC (ports 553xx) | A test tool. Holds synthetic data only; excluded from the information scope but covered by the development controls. |
| Planned items not built: "CK Desk Bot", Google Workspace user sync | Not built. They must be added to the scope and risk assessment **before** they go live. |

### 4.3 Interfaces and dependencies (clause 4.3 c)

| Dependency / interface | Who runs it | What CKDesk relies on it for | Control question for the ISMS | Evidence of control today |
|---|---|---|---|---|
| Citykart network and firewall; router NAT to 10.0.1.98:3210 | Not known from the repository — management to confirm | Reaching users; blocking the database and NAS from the internet | Is port 5432 or the NAS reachable from outside? Not stated. | E |
| Power, cooling, fire protection, room access | Facilities / IT | Availability and physical protection | Who maintains it? UPS? | E |
| Windows Server patching of 98 and 205; PostgreSQL 18 patching; NAS firmware | Infrastructure team (assumed) | Secure platform | Patch schedule and records | E |
| Backup storage `E:\` on 205, NAS storage | Infrastructure team (assumed) | Recovery | Off-server copy not done | D |
| Google Workspace (mailbox, App Password) | Google; mailbox admin at Citykart | Outbound and inbound mail | Contract, 2-step verification, App Password custody | E |
| Microsoft 365 / Graph (if an Outlook channel is connected) | Microsoft; tenant admin | Intake mail | Whether any channel is active in production | E |
| Meta WhatsApp Business account and phone number | Meta; the business account admin | WhatsApp intake pilot | Account ownership, token rotation | E |
| DeskTime | DeskTime vendor | Time data | Contract and staff notice | E |
| LLM provider (Groq), if enabled | Groq | Mail summary helper | Whether enabled; what data leaves | E |
| GitHub | GitHub | Source code storage | Account protection (2FA), branch protection | E |
| ISP / public IP 182.72.84.10 | ISP | Public reachability | Static IP contract | E |
| HR | Citykart HR | Joiner/leaver events; screening; confidentiality terms | Trigger and timing | E |
| Technical authors (developer, any AI coding assistant) | Project owner | Change creation | See the rules in `CLAUDE.md` | D |
| Retired server 10.0.1.12 | Infrastructure | Archive | Disposal plan | D |

---

## 5. People roles inside the scope

Software roles (B, `lib/constants/roles.ts`): `user` (Requester), `agent` (Technician), `manager`, `admin`, `platform_owner`. Job roles that an ISMS needs but the repository does not name:

| ISMS role | Why it is needed | Named person | Source |
|---|---|---|---|
| Top management sponsor (accepts risk, approves policy) | Clause 5.1-5.3 | Not known from the repository — management to confirm | E |
| CKDesk service / product owner | Owns the system and its risk | Appears as "the user" / project owner in `CLAUDE.md`; name not recorded | D |
| Information security lead (ISMS manager) | Runs the ISMS | Not appointed | E |
| Developer(s) | Builds and fixes | One shared identity ("Local Setup") in git | B |
| Release approver (independent of the developer) | Separation of duties for change | Not defined: the owner approves every push/deploy | D |
| Server administrators (98, 205, NAS) | Run infrastructure | A shared `Administrator` account; individuals not known | D |
| Database administrator | Holds `postgres` password; runs migrations | The user types it on the server; person(s) not named | D |
| Technical escalation owner / monitoring owner for the WhatsApp pilot | Daily checks | "once named" in `PILOT_MONITORING_SCORECARD.md` | D |
| System Log reviewer | Reads security and audit records | Not defined | E |
| Platform owners (2 at the 2026-09-24 snapshot) and administrators (0 at that snapshot) | Privileged application users | Not known | D |
| Internal auditor (independent) | Clause 9.2 | Not appointed | E |
| Data protection / privacy contact | Staff data | Not appointed | E |
| Supplier relationship owners | One per supplier in section 6 | Not named | E |

---

## 6. Suppliers and their place in the scope

| Supplier | Role | Data sent (repository) | In scope as | Contract / DPA evidence |
|---|---|---|---|---|
| Google Workspace / Gmail | Outbound SMTP and inbound IMAP of one shared mailbox; Pub/Sub for Gmail API channels | Notification mails, approval/CSAT/reset/invitation links, vendor mails, scheduled reports; incoming replies | Critical supplier | E |
| Microsoft (Outlook, Graph) | Optional intake channel | Mailbox content | Supplier, if used | E |
| Meta (WhatsApp Cloud API) | Pilot channel | Mobile numbers, messages, media | Critical supplier for that channel | E |
| DeskTime | Time and activity data | API key in URL query; employee time data returned | Supplier | E |
| Groq (LLM), if enabled | Mail summary | Subject, sender, first 2,000 characters of mail | Supplier, if used | E |
| Resend, if configured | Fallback mail | As mail | Supplier, if used | E |
| GitHub | Source hosting | Source code | Supplier | E |
| Browser push vendors | Web Push | Notification text | Supplier | E |
| Google Fonts / gstatic | Fonts and styles | Visitor IP | Minor supplier | B |
| Synology (NAS hardware), Microsoft (Windows), PostgreSQL project, GoTrue/PostgREST/Storage open-source projects, Node.js | Platform software and hardware | None sent out | Components needing patch tracking | D |
| ISP / telecom | Public link | Traffic | Dependency | E |

---

## 7. Information classification starting point (for scoping the information assets)

No classification scheme exists (E). Proposed starting tiers for management to adopt or change: **Restricted** (secrets, keys, vault contents, backups, System Log audit rows, HR/Finance tickets, one-time codes); **Internal** (ordinary tickets, attachments, staff directory); **Public** (login page, version/health endpoints). Mapping tickets to a "Restricted" team tier depends on decision D-005.

---

## 8. What only management can confirm

1. Whether the scope is CKDesk only or wider; the legal entity and site names.
2. Whether the scope statement above is accepted or corrected.
3. Names for the roles in section 5.
4. Which laws, contracts and customer promises apply (legal register).
5. Which integrations are really active in production (e-mail channels, WhatsApp, LLM, DeskTime, push).
6. Where 10.0.1.98, 10.0.0.205 and 10.0.0.25 physically sit; who controls access to the room; the facility owner.
7. Whether the database port 5432 and the NAS are reachable from outside the local network.
8. Who administers the shared servers and who holds the ssh key.
9. Whether the dev PC and admin PC are the same machine and how they are protected.
10. Acceptable risk levels (risk appetite) and who accepts risk.
11. Whether the retired server 10.0.1.12 and its archived database will be disposed of, and when.
12. Whether CKDesk is to be extended (CK Desk Bot, Google Workspace sync) and whether those should be inside the scope from the start.
13. Whether any customer or regulator has asked for certification, which would drive the timeline.

---

## Open questions / evidence requests for management

1. Name of the top-management sponsor who will approve the ISMS scope, policy and risk decisions (and the date they approved this scope, once they do).
2. Legal entity name, site list and a decision: CKDesk-only scope or company-wide scope.
3. Name of the CKDesk owner, the information security lead, the release approver (a second person independent of the developer) and the internal auditor.
4. Network diagram showing the router NAT, firewall rules, and whether 5432 and the NAS are reachable from outside; owner of the network.
5. Facility details for the servers and NAS: location, access control, power (UPS), cooling, fire protection, visitor log (Class C evidence).
6. List of active integrations in production (with account owners): Gmail/Google Workspace mailbox, Outlook, WhatsApp, DeskTime, Groq or any other model provider, push.
7. Supplier contracts, terms, and data-processing agreements for Google, Microsoft, Meta, DeskTime, Groq (if enabled), GitHub.
8. Legal and regulatory register (employee data, DeskTime monitoring notice, breach notification duties).
9. Number of staff and contractors with access to the servers and to the code; list of privileged application users (platform owners, admins).
10. Decision on whether the shared servers' other applications (Citykart Spinwheel, other databases) are treated as a dependency, with the owner of each.
11. Written risk appetite statement or equivalent management decision on risk acceptance.
12. Disposal plan for the retired server 10.0.1.12.
