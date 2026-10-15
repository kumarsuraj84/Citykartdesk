# ISO/IEC 27001 Risk Assessment for Citykart Desk (CKDesk)

Date: 2026-10-15

Status: **DRAFT for management review - internal readiness assessment, not an audit report or attestation**

## How to read this

This document explains a simple way to score risk, lists what CKDesk needs to protect, and then lists 49 specific risks with a proposed score for each. Each risk is tied to an asset, a threat and a weakness that was actually seen: a VAPT finding id from `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`, a residual from the earlier audit (ids D-xxx and R-n from `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`), or a control-evidence gap from `01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md`.

**All scores are the assessor's proposal. Management must confirm or change them.** The scores describe production **as it runs today** (build 20261015-145217). The fixes made in this assessment exist only on the local branch and are not deployed, so a risk that a local fix addresses is still scored as open. The treatment plan shows the expected score after treatment.

This is a readiness document. It does not claim any certification or compliance.

## 1. Method (kept deliberately simple)

1. List the assets (section 3) and say who should own each.
2. For each asset, name the threats (what could go wrong) and the weaknesses (why it could). Use real findings, not guesses.
3. Score **likelihood** (1-5) and **impact** (1-5) using the tables below. **Score = likelihood x impact** (1 to 25).
4. Look at the controls that already exist and score with them in place ("current risk").
5. Any risk scoring **10 or more** (High or Critical) must have a treatment plan (see `ISO27001-RISK-TREATMENT-PLAN.md`). Risks below 10 are listed with a suggested handling; management may accept them in writing.
6. Management confirms scores, approves treatments and signs off any residual risk it accepts. Repeat at least once a year and after any major change or incident.

## 2. Scales defined for CKDesk

CKDesk is used by about 553 accounts across head office and stores (2026-09-24 snapshot: 482 requesters, 41 technicians, 2 managers, 2 platform owners). It is reachable from the internet on a public address, it runs on single servers, and it holds staff personal data and ticket content.

### Likelihood (next 12 months, with today's controls)

| Score | Name | Meaning for CKDesk |
|---|---|---|
| 1 | Rare | No known route; needs several unlikely events together. |
| 2 | Unlikely | Possible, but needs inside knowledge, special access or unusual conditions. |
| 3 | Possible | Route is known and needs ordinary skill, or a plausible mistake or equipment failure within a year. |
| 4 | Likely | Easy for any user or outsider, or a common event (disk failure, missed patch); expected within a year. |
| 5 | Almost certain | Open to anyone today with no effort, or already happening. |

### Impact (worst realistic outcome)

| Score | Name | Meaning for CKDesk |
|---|---|---|
| 1 | Minor | No data exposed; fixed within an hour; no business effect. |
| 2 | Small | One team delayed up to a day, or a small amount of low-sensitivity data exposed. |
| 3 | Moderate | Desk unusable for 1-3 working days; or staff or ticket data exposed inside the company to people who should not see it; or wrong SLA and audit figures. |
| 4 | Major | Desk unusable for more than 3 days, or permanent loss of some tickets or files; staff personal data exposed outside the company; legal notification likely; the audit trail is no longer trusted. |
| 5 | Severe | Whole database or all attachments lost with no copy; outsider takes over the system or the servers; large external breach of staff data; many stores and offices stopped for a long time. |

### Score matrix and bands

| L \ I | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **5** | 5 | 10 | 15 | 20 | 25 |
| **4** | 4 | 8 | 12 | 16 | 20 |
| **3** | 3 | 6 | 9 | 12 | 15 |
| **2** | 2 | 4 | 6 | 8 | 10 |
| **1** | 1 | 2 | 3 | 4 | 5 |

| Band | Score | Rule |
|---|---|---|
| Low | 1-4 | Monitor. |
| Medium | 5-9 | Management may accept in writing, or apply a cheap fix. |
| High | 10-16 | **Treatment plan required.** |
| Critical | 20-25 | **Treatment plan required; act first.** |

### Treatment options

**Reduce** (add or improve controls) · **Accept** (knowingly live with it; management signs) · **Transfer** (insurance or contract; does not remove the risk) · **Avoid** (stop the activity, for example switch off a feature or remove public access).

## 3. Assets

C = confidentiality, I = integrity, A = availability value (H high, M medium, L low) - proposed.

| Asset id | Asset | Where | Proposed owner role | C | I | A | Why it matters |
|---|---|---|---|---|---|---|---|
| AS-01 | CKDesk application (Next.js web app, five Windows services, scheduled tasks) | Server 10.0.1.98; build 20261015-145217 | Application owner (developer) (tba) | M | H | H | The working system for ~553 users; internet-reachable on a public address. |
| AS-02 | Database `ckdesk` (tickets, profiles, approvals, forms, System Log) | Server 10.0.0.205 (shared with other applications) | Database administrator (tba) | H | H | H | All business records and the audit trail; includes staff personal data. |
| AS-03 | Attachments on the NAS (`CKAPPLICATIONS_DATA\CKDESK_DATA`) | NAS 10.0.0.25 | Server administrator (tba) | M-H | H | M | Files uploaded to tickets; may contain personal or confidential content. |
| AS-04 | Mailbox credentials and OAuth tokens (shared Gmail App Password, intake mailbox tokens) | Database vault; Google Workspace | Application owner (tba) | H | M | H | Lets the system read and send company mail; one shared mailbox. |
| AS-05 | WhatsApp tokens and app secret (Meta Cloud API channel) | Database vault; Meta | Application owner (tba) | H | M | M | Allows messages as the company number; pilot status. |
| AS-06 | Service-role key, JWT secret and other server secrets (`CRON_SECRET`, link secrets) | Files on 10.0.1.98 (`.env.local`, auth, PostgREST, storage settings) | Application owner (tba); Server administrator (tba) | H | H | H | Full database bypass; keys are valid for 10 years. |
| AS-07 | Database backups (nightly dumps, 30 days) and pre-migration dumps | Disk E: on 10.0.0.205 | Database administrator (tba) | H | H | H | Only recovery source; same server as the live database; no second copy. |
| AS-08 | Source repository (GitHub `kumarsuraj84/Citykartdesk` and local clones, 31 unpushed branches) | GitHub; dev PC | Application owner (tba) | M | H | M | Business logic, migrations, deploy scripts; no secrets tracked. |
| AS-09 | Developer PC 10.0.0.47 (source, production-like dumps, tools, assistant) | Dev PC | IT head (tba) | H | H | M | Origin of every release; holds local data copies. |
| AS-10 | Admin SSH key and the shared Windows `Administrator` account (98 and 205) | Admin PC; servers | IT head (tba) | H | H | H | Full control of production; one shared account. |
| AS-11 | People: the single developer, admins, technicians, managers and ~553 users | Organisation | Top management (tba); HR head (tba) | M | H | H | Knowledge and behaviour; single developer is a continuity risk. |
| AS-12 | System Log and audit records (append-only, hash chain) | Database `ckdesk` | Application owner (tba) | M | H | M | Evidence of who did what; protects accountability. |
| AS-13 | Network path (router NAT, public IP 182.72.84.10, port 3210; LAN) | Router; ISP; LAN | Network administrator (tba) | M | M | H | Only way in for users; plain HTTP today. |
| AS-14 | Third-party services (Google Workspace, Meta, DeskTime, optional LLM, push services) | Outside suppliers | Vendor / procurement owner (tba) | M-H | M | M | Receive tickets, mail text, staff mobile numbers and activity data. |
| AS-15 | Windows servers, PostgreSQL, Node, NSSM, login/API/storage components | 10.0.1.98, 10.0.0.205, NAS | Server administrator (tba) | M | H | H | Platform software that must be patched; versions not recorded. |

## 4. Risk register

Each row names the finding or gap it comes from. "Existing controls" are the controls seen in the repository or in the isolated tests; none of them has been shown to operate in production by class C evidence.

| Risk id | Risk | Asset | Threat | Vulnerability (finding ids) | Existing controls | L | I | Score | Rating | Owner role | Treatment option |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RISK-01 | Production runs a web framework with a published critical flaw | AS-01, AS-15 | Internet attacker uses a published remote-code-execution flaw on the Windows app server, then reads server secrets and the database. | VAPT-DEP-01: production build runs Next.js 16.2.9 (16 advisories, incl. GHSA-p293-qw3h-jr36, CVSS 9.0, fixed in 16.3.3). The fix (16.3.8) exists only in LOCAL. No standing dependency process. | Login page; Windows firewall allows only port 3210; no web application firewall. | 4 | 5 | 20 | Critical | Application owner (tba) | Reduce |
| RISK-02 | Users sign in over plain HTTP; cookies are not Secure | AS-13, AS-01 | Anyone on the network path (public Wi-Fi, ISP hop, store network) reads or steals passwords and session cookies, including admin sessions. | VA-API-01 / D-018 / D-037: public URL is http://, no TLS, cookies not marked Secure and last 400 days, CSP is report-only, no HSTS. | Security headers (nosniff, frame, referrer); report-only CSP. | 4 | 4 | 16 | High | IT head (tba) | Reduce (needs management decision) |
| RISK-03 | Known default password for bulk-imported accounts | AS-01, AS-11 | A person who knows the default initial password signs in as an imported user, possibly a technician or manager. | VA-API-02 / VA-ADM-02 / D-011: bulk import falls back to a fixed default password (value is in the finding table; not repeated here); forced reset is enforced only by a page layout. Production check not done. | Flag-clearing by users fixed in LOCAL (M164); must-reset flag; 8-character minimum. | 4 | 4 | 16 | High | Application owner (tba) | Reduce (needs management decision) |
| RISK-04 | No backup copy outside the database server | AS-07, AS-02 | Disk failure, ransomware, fire or admin error on 10.0.0.205 destroys the database and its backups together. | Runbook records the second copy as "Not done yet" (deferred by the owner). Backups on disk E: of the same server. | Nightly dump, 30 days, integrity listing (described, script not in repo). | 3 | 5 | 15 | High | Database administrator (tba) | Reduce |
| RISK-05 | Backups never proved by a restore; script and secrets not in the repo | AS-07, AS-04 | On the day a restore is needed it fails or is slow, or mail and intake secrets are lost. | No dated restore-test record; `backup-db.ps1` not in repo; vault key and secret rows not in dumps; no alert on a failed backup (shipper not run on 205). | Integrity listing by `pg_restore --list`; written restore steps. | 3 | 4 | 12 | High | Database administrator (tba) | Reduce |
| RISK-06 | Attachments on the NAS have no described backup | AS-03 | NAS failure or deletion loses ticket files with no copy. | Runbook says "RAID/snapshots are the NAS's job"; no snapshot or backup policy is described. | RAID (assumed, not shown). | 3 | 4 | 12 | High | Server administrator (tba) | Reduce |
| RISK-07 | One shared Administrator account and key for server access | AS-10, AS-15 | Loss or misuse of one key gives full control of production and nobody can be held accountable. | Ssh as built-in `Administrator` with one key on the admin PC to 10.0.1.98 and 10.0.0.205; custody and holders not described. | Key-based (not password) login. | 3 | 5 | 15 | High | IT head (tba) | Reduce |
| RISK-08 | Long-lived shared keys and secrets stored in files | AS-06 | Theft of `.env.local` or the JWT secret gives a full database bypass for up to 10 years. | Anon and service-role tokens minted for 10 years; one JWT secret used by all services; service-role key is also the HMAC key; fallbacks to `CRON_SECRET` (VA-API-05); secrets in plain files. | Files on the app server; vault for mailbox secrets. | 3 | 5 | 15 | High | Application owner (tba) | Reduce |
| RISK-09 | All changes made and approved by one person; no CI or second review | AS-08, AS-01 | A faulty or malicious change reaches production unnoticed. | One author identity for 271 commits; one approver in `CLAUDE.md`; tests, lint and type check run by hand; no pull requests or branch protection shown. | Local tests (268 files), type errors fail the build, written deploy steps. | 4 | 3 | 12 | High | Application owner (tba); IT head (tba) | Reduce |
| RISK-10 | Only one person can maintain, deploy and restore the system | AS-11 | Illness or departure leaves no one who can run releases, restores or key tasks. | Single developer identity; procedures are in documents but not rehearsed by anyone else. | Runbook; documents. | 3 | 4 | 12 | High | Top management (tba) | Reduce |
| RISK-11 | No alerts when services, backups or security events fail | AS-01, AS-02, AS-07 | A stopped service, failed backup or attack goes unnoticed for days. | No alert rule on critical rows, failed backup, login bursts or service down; `lib/monitoring.ts` is a stub; uptime and error tracking items unticked; shipper not wired on 205. | System Log rows; `/api/health`; manual checks. | 4 | 3 | 12 | High | IT head (tba) | Reduce |
| RISK-12 | Nobody is assigned to read the System Log | AS-12 | Attack signs (failed sign-ins, invalid webhook signatures, role changes) are never looked at. | System Log has no defined reviewer, cadence or triggers; only WhatsApp has a daily check. | Logs exist; Logs screen; verify-integrity button. | 4 | 3 | 12 | High | ISMS owner (tba) | Reduce |
| RISK-13 | No incident response plan, roster or contact list | AS-11, AS-01 | Response to a breach is slow and ad hoc; evidence lost; legal duties missed. | No plan, tree, templates or incident register found; WhatsApp runbook only. | Ops checklists; System Log. | 3 | 4 | 12 | High | ISMS owner (tba) | Reduce |
| RISK-14 | Technicians or managers can change priority, deadlines and assignee directly | AS-02, AS-12 | An insider hides SLA breaches or changes ticket ownership with one direct call, bypassing the screens. | VA-DB-01 / VA-TKT-01 (rest): priority/SLA fix is in M164 (LOCAL only); other columns (`assigned_to`, `description`, `form_data`, `resolved_at`, `closed_at`, `reopen_count`, category) still writable. | Status-transition guard (M163); System Log records priority/assignee changes; due dates logged after M164. | 4 | 3 | 12 | High | Application owner (tba) | Reduce |
| RISK-15 | Staff mobile numbers and internal-note files reachable by ordinary users | AS-02, AS-03 | Any employee reads colleagues' mobile numbers; a requester downloads files attached to internal notes; note text reaches wrong people. | VA-INT-13 / VA-DB-07, VA-INT-01 / VA-TKT-04, VA-INT-03 / VA-TKT-03: fixed in LOCAL (M164 and app) only. | Role checks; row-level security on most tables. | 4 | 3 | 12 | High | Application owner (tba) | Reduce |
| RISK-16 | HR and Finance tickets visible to every manager-level user | AS-02 | A manager, admin or platform owner reads sensitive HR or finance requests. | D-005: no confidentiality tier; any manager-level user sees every team's tickets. | Few such users (2 managers, 2 platform owners at the 2026-09-24 snapshot); audit rows. | 3 | 3 | 9 | Medium | Service desk lead (tba) | Accept (until decision) / Reduce |
| RISK-17 | Passwords can be guessed or stuffed; no multi-factor sign-in | AS-01, AS-11 | An outsider guesses or reuses a password and signs in, including as an admin or manager. | No MFA; auth-service password rules possibly 6 characters (D-036); limiter is in memory and lost on restart; per-address limits need TRUSTED_PROXY_HOPS; plain HTTP. | Per-account limit 10/min; 3 reset mails/hour; generic reset reply. | 4 | 4 | 16 | High | Application owner (tba); IT head (tba) | Reduce |
| RISK-18 | Leavers and unused accounts stay active | AS-11, AS-01 | A former employee or contractor keeps access to tickets and data. | No joiner/mover/leaver procedure or HR trigger; no access review; R-3 deactivated login may work up to 1 hour; signed e-mail links valid up to 7 days. | Deactivate and ban function; RLS treats inactive as signed out. | 4 | 3 | 12 | High | HR head (tba); IT head (tba) | Reduce |
| RISK-19 | Excess privileges are not reviewed; the permission screen is not enforced | AS-01 | Rights grow over time; people hold more access than needed. | No periodic review; the Roles & Permissions matrix writes rows nothing reads. | Role guard in code; target guard. | 3 | 3 | 9 | Medium | IT head (tba) | Reduce (cheap) |
| RISK-20 | Managers can change shared configuration and business rules | AS-01, AS-02 | A manager changes business hours, holidays, priorities or rules that set priority, status or team. | VA-DB-03 (rest), VA-ADM-03, VA-TKT-02, VA-ADM-06, VA-ADM-09, R-2: ~20 config tables and global settings writable by managers. | Four SLA tables restricted in M164; audit triggers. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce after management decision |
| RISK-21 | Stored script in templates and report-only CSP | AS-01 | A manager plants script in an e-mail template that runs in an admin's browser. | VA-INT-05 / VA-ADM-07 fixed in LOCAL only; CSP is report-only and allows inline/eval; browser render not run. | Server-side sanitiser on one path; nosniff. | 2 | 4 | 8 | Medium | Application owner (tba) | Reduce |
| RISK-22 | Misuse of the shared mailbox credentials | AS-04 | An admin or attacker redirects the saved mailbox password to another server or reads company mail. | VA-ADM-01 (fixed in LOCAL only); shared Gmail App Password; vault key custody. | Vault encryption; host validation (D-026 partly). | 2 | 4 | 8 | Medium | Application owner (tba) | Reduce |
| RISK-23 | Vault key lost or not escrowed | AS-04, AS-05, AS-06 | After a restore, stored mail, WhatsApp and DeskTime secrets cannot be read and the channels stop. | Vault key is a database setting not in dumps; no rotation, no escrow. | Restore procedure says re-create key and re-enter secrets. | 3 | 3 | 9 | Medium | Database administrator (tba) | Reduce (in RISK-05 plan) |
| RISK-24 | One shared secret reused for many purposes | AS-06 | Leak of `CRON_SECRET` opens cron endpoints and weakens link and OAuth state signing. | VA-API-05: fallback chain ends in `CRON_SECRET`; can reach Microsoft in a URL. | Constant-time compare; 503 when unset. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce (in RISK-08 plan) |
| RISK-25 | WhatsApp webhook probing or flooding | AS-05 | Attacker floods or probes the webhook; stolen token sends messages in the company name. | D-061: per-caller limit is OFF unless TRUSTED_PROXY_HOPS is set; real-Meta validation not done in earlier stages. | HMAC signature check; 1 MB body cap; vault storage. | 2 | 3 | 6 | Medium | Application owner (tba) | Accept with monitoring |
| RISK-26 | Forged or wrongly attributed e-mail replies | AS-01 | A spoofed reply changes a ticket, or any employee replies to any ticket number. | VA-INT-02 (fixed in LOCAL, logic-tested only T12); D-028 / R-7: mail with no authentication result is trusted. | Google DMARC/DKIM/SPF header check. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce |
| RISK-27 | Approval workflows can be bypassed through side doors | AS-01 | A requester or sender approves their own request, or an unreviewed workflow is used. | VA-TKT-05/06/07, D-030 partial: delegate and add-approver paths have no sender check. | Self-approval refused on the decide step; one-time codes; 7-day links. | 3 | 3 | 9 | Medium | Service desk lead (tba) | Reduce after policy decision |
| RISK-28 | Public endpoints abused to slow or fill the system | AS-01, AS-12 | Flooding of the System Log, huge request bodies or large spreadsheets exhaust disk, memory or time. | VA-API-07 (fixed in LOCAL), VA-API-04, D-039, VA-API-06 / VA-INT-04 / VA-ADM-18 (open), no web application firewall. | Size caps on listed public paths; global caps in LOCAL. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce |
| RISK-29 | Ordinary users write directly to tables lacking checks | AS-02, AS-03 | A signed-in user plants data in other users' projects, tasks or file folders, or saves a harmful push address. | VA-DB-06 (rest), VA-TKT-09, VA-DB-10, D-025, R-4: role-only policies and missing org tests. | Row-level security; most paths fixed in M164. | 3 | 3 | 9 | Medium | Database administrator (tba) | Reduce |
| RISK-30 | Uploaded files are not scanned for malware | AS-03 | A malicious file is opened by a technician. | No scanning; only type allow-list and magic-byte check; AV on servers unknown. | Type/size checks; nosniff downloads. | 3 | 3 | 9 | Medium | Server administrator (tba) | Reduce |
| RISK-31 | Vulnerable software is not tracked on a regular basis | AS-01, AS-08 | Known flaws in dependencies stay unfixed because nobody checks. | No scanner, schedule or SBOM; one-off `npm audit` found 31 findings; the `uuid` via `exceljs` residual is accepted by default. | Lock file; this assessment's one-off audit. | 4 | 3 | 12 | High | Application owner (tba) | Reduce |
| RISK-32 | Server, database and runtime patch levels are unknown | AS-15 | Unpatched Windows, PostgreSQL, Node, NSSM or login/API components are exploited. | No patch schedule or version inventory; Node on 98 unknown (D-038); login service built from source with a patch script. | Versions noted at install time in the runbook. | 3 | 4 | 12 | High | Server administrator (tba); Database administrator (tba) | Reduce |
| RISK-33 | Developer and admin PCs hold production-like data and keys | AS-09, AS-10 | Theft, malware or an unlocked PC exposes real data or gives access to production. | Local dumps (git-ignored); endpoint protection, encryption and screen lock not stated; the admin ssh key is on a PC. | Dumps are git-ignored; audit stack uses synthetic data. | 3 | 4 | 12 | High | IT head (tba) | Reduce |
| RISK-34 | Source repository integrity and loss | AS-08 | Account takeover on GitHub or loss of the dev PC changes or loses code and 31 unpushed branches. | Access list, MFA, branch protection unknown; `.claude/settings.local.json` tracked; unpushed branches only on one PC. | Secret search found none tracked. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce |
| RISK-35 | Outside suppliers hold company data without recorded terms | AS-14, AS-04, AS-05 | A supplier breach or change exposes tickets, mail or staff data; no exit route. | No supplier register, contracts or due diligence; DeskTime key in a URL; active integrations unknown. | Vault encryption for credentials; https calls. | 3 | 3 | 9 | Medium | Vendor / procurement owner (tba) | Reduce |
| RISK-36 | Personal data is not governed | AS-02, AS-03, AS-14 | Complaints, regulator questions or a breach find no inventory, notice, retention or deletion process. | No data inventory, notice or DSAR/breach steps; `retention_policies` not enforced; no delete/anonymise function; DeskTime activity monitoring notice not shown. | Log redaction; retention for System and Event Logs; mobile-number fix in LOCAL. | 3 | 4 | 12 | High | Legal / compliance contact (tba) | Reduce |
| RISK-37 | Single points of failure and unproven capacity | AS-01, AS-02, AS-03, AS-13 | One server, NAS or router failure stops the desk; load beyond capacity slows or crashes it. | One app server, one shared database server, one NAS, one router, one mailbox; target capacity not verified (55.4% failure at load on 2026-09-17); reboot test pending; audit-lock effect R-8 not tested. | Auto-start services; health endpoint; circuit breaker (REL-1). | 3 | 4 | 12 | High | IT head (tba) | Reduce partly; accept the rest by decision |
| RISK-38 | No recovery targets or continuity plan | AS-11, AS-02 | Nobody knows how long an outage may last or what to do first; business decisions are made in a crisis. | No RTO/RPO, no DR plan, no failover or tabletop test. | Restore and rollback steps in the runbook. | 3 | 4 | 12 | High | Top management (tba); IT head (tba) | Reduce |
| RISK-39 | Physical protection of servers and NAS not known | AS-02, AS-03, AS-07, AS-15 | Theft, fire, flood, heat or power loss destroys or exposes equipment and backups. | No facility information in the repository (scored provisionally; to be re-scored after a walk-through). | Not known. | 2 | 5 | 10 | High | Facilities / admin head (tba) | Verify, then reduce |
| RISK-40 | Shared servers: other applications run beside CKDesk | AS-15, AS-02 | A fault, overload or compromise of a neighbouring application, or an admin working on it, affects CKDesk. | 10.0.1.98 also hosts another application; 10.0.0.205 holds other databases; shared Administrator access; service accounts not described. | Scope rules in `CLAUDE.md`; separate database and role. | 3 | 4 | 12 | High | Server administrator (tba) | Reduce |
| RISK-41 | Old documents lead to action on the wrong server | AS-15 | An operator uses a stale procedure and works on the retired server 10.0.1.12 or the wrong service names. | Several documents still describe 10.0.1.12, Railway and `Citykart*` service names. | `CLAUDE.md` warns against 10.0.1.12. | 2 | 3 | 6 | Medium | Application owner (tba) | Reduce (cheap) |
| RISK-42 | Audit records could be altered by a database owner | AS-12 | A privileged person disables triggers and edits or removes evidence. | Append-only triggers can be disabled by owner or superuser; no off-server copy; SLA due-date changes were not logged before M164. | Hash chain with verify function; archive not delete. | 2 | 4 | 8 | Medium | Database administrator (tba) | Reduce |
| RISK-43 | Audit locking slows the system under load | AS-01, AS-02 | Every audited change locks one shared row, so busy periods queue up. | R-8 / D-066: not load-tested after migration 160. | Earlier load work on the audit stack. | 2 | 3 | 6 | Medium | Application owner (tba) | Reduce (load test, in RISK-37 plan) |
| RISK-44 | No management system around security (policy, owner, review, internal audit) | AS-11 | Controls decay; nobody is accountable; certification or customer review would fail. | No policy, scope, ISMS owner, management review or internal audit records found. | Individual technical controls; this assessment (draft). | 4 | 3 | 12 | High | Top management (tba) | Reduce |
| RISK-45 | Staff and technicians are not trained in security | AS-11 | Phishing, password sharing or secrets typed into tickets cause incidents. | No awareness programme or records; no developer secure-coding training evidence. | None known. | 4 | 3 | 12 | High | HR head (tba); ISMS owner (tba) | Reduce |
| RISK-46 | AI assistant works in the development and operations flow | AS-08, AS-09 | Rules written in a text file are the only brake on changes made with an assistant; code or data may be shared with its provider. | Rules in `CLAUDE.md` (no push or deploy without OK; passwords not repeated). The assistant's real access to servers and the data sent to its provider are not described in the repository. | Written rules; explicit-OK practice. | 2 | 4 | 8 | Medium | IT head (tba) | Reduce / decide |
| RISK-47 | Secrets typed into tickets and notes | AS-02, AS-03 | Passwords placed in notes or attachments are read by many people. | A planning document says some old notes contain a default password; the 10-character resolution-note rule helps only partly. | Resolution-note rules; log redaction (not tickets). | 3 | 3 | 9 | Medium | Service desk lead (tba) | Reduce |
| RISK-48 | Sessions last very long and are not tied to a timeout | AS-01 | A stolen or left-open session stays valid for months. | D-037: library default cookies (400 days); no idle timeout; R-3 token valid after deactivation up to 1 hour. | 1-hour access tokens with refresh. | 3 | 3 | 9 | Medium | Application owner (tba) | Reduce (after HTTPS, in RISK-02 plan) |
| RISK-49 | Service-role access is used in 104 source files | AS-01, AS-02 | A missing role or ownership check in any one action exposes or changes data, bypassing row-level security. | Wide use of the service-role client; code-level checks differ file by file; many VAPT findings were of this type. | Role checks, tests, database triggers as second line. | 3 | 4 | 12 | High | Application owner (tba) | Reduce |

## 5. Summary

| Rating | Number of risks |
|---|---|
| Critical | 1 |
| High | 27 |
| Medium | 21 |
| Low | 0 |
| **Total** | 49 |

Risks at or above the treatment threshold (10): **28** of 49.

Number of risks at each likelihood and impact (rows = likelihood, columns = impact):

| L \ I | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **5** | - | - | - | - | - |
| **4** | - | - | 9 | 3 | 1 |
| **3** | - | - | 14 | 11 | 3 |
| **2** | - | - | 3 | 4 | 1 |
| **1** | - | - | - | - | - |

Highest scores (assessor's proposal):

| Risk id | Risk | Score | Rating |
|---|---|---|---|
| RISK-01 | Production runs a web framework with a published critical flaw | 20 | Critical |
| RISK-02 | Users sign in over plain HTTP; cookies are not Secure | 16 | High |
| RISK-03 | Known default password for bulk-imported accounts | 16 | High |
| RISK-17 | Passwords can be guessed or stuffed; no multi-factor sign-in | 16 | High |
| RISK-04 | No backup copy outside the database server | 15 | High |
| RISK-07 | One shared Administrator account and key for server access | 15 | High |
| RISK-08 | Long-lived shared keys and secrets stored in files | 15 | High |
| RISK-05 | Backups never proved by a restore; script and secrets not in the repo | 12 | High |

How the VAPT findings feed the register: the **High** findings VA-API-01 (HTTP), VA-API-02 (default password), VA-DB-01 (priority and SLA writes) and the critical VAPT-DEP-01 (framework) map to RISK-02, RISK-03, RISK-14 and RISK-01. The Medium and Low findings map to RISK-15, RISK-20 to RISK-30 and RISK-34. Finding ids that appear in the status table only as grouped Low items (VA-INT-07, -11, -12, VA-API-11, -12, VA-ADM-12, -13, -15 to -17, VA-TKT-10 to -20, VA-DB-09, -12) are not scored one by one: none gives an outsider access to data. They stay in the master register and are covered here only in general terms by RISK-49 (service-role use).

## 6. Limits of this assessment

- Scores use what the repository and the isolated local tests show. Production settings, server patch levels, physical protection, supplier terms and people processes were **not** seen. Where that matters the vulnerability text says so; RISK-39 is scored provisionally for that reason.
- Business impact (how many stores stop, cost per hour of outage) was not supplied. Impact scores are therefore judgement and should be adjusted by the business.
- The dynamic tests ran only on the disposable stack. Tools such as Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei and Burp were not available; `npm audit`, targeted searches and source reviews replaced them.
- No risk has been accepted by management yet. "Accept" in the register is only a proposal.

## Open questions / evidence requests for management

Everything in this list is "Not known from the repository - management to confirm". Do not send secrets, passwords or keys; send the document, screenshot or export with secrets removed.

1. Approve or change the **likelihood and impact scales**, the **bands**, and the **treatment threshold of 10** (risk appetite).
2. Confirm the **asset list** and name an **owner for each asset** (section 3). Confirm the asset values (C, I, A).
3. Give the **business impact** of an outage: how many stores and offices depend on CKDesk, what stops when it is down, and the longest acceptable outage (needed to fix impact scores for RISK-04, RISK-37, RISK-38).
4. Confirm which **integrations are enabled in production**: Gmail/Outlook intake, WhatsApp, DeskTime sync, the LLM summary, push notifications (RISK-22, RISK-25, RISK-35).
5. Run (or authorise the database administrator to run) a **count of live accounts still using the default initial password** and send the number only (RISK-03).
6. Confirm the **live auth-service settings**: sign-up disabled, minimum password length, session lifetime (RISK-17, RISK-03).
7. Confirm whether the **second backup copy** and any **restore test** exist outside the repository, with dates (RISK-04, RISK-05, RISK-06).
8. Provide **physical and environmental facts** for the server room(s) and NAS so RISK-39 can be re-scored.
9. Say who may approve **risk acceptance** and how it is recorded.
10. Name the person who will own this risk register and review it at least yearly.
