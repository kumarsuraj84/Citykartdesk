# SOC 2 Type I Readiness - Proposed System Boundary for Citykart Desk (CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

SOC 2 is an audit of a "system": the set of infrastructure, software, people, data and procedures that deliver a service. Before anything can be assessed, someone has to draw a line around that system. This file is the **proposed** line for CKDesk. It is built only from what the repository shows (evidence class B) and from the written runbooks (class D). No management evidence (class C) has been supplied, so every statement about who owns something, what a contract says, or what is switched on in production is marked **"Not known from the repository — management to confirm"**.

Evidence classes used in this file: **A** verified LOCAL technical test · **B** repository (source, migrations, scripts) · **C** authorised organisational evidence (none supplied) · **D** documentation only · **E** missing / not verified. A document or script existing does not prove a control operates.

Nothing from this assessment is deployed. Production runs build 20261015-145217 (main `717e5c6`), which does **not** contain the assessment's fixes. This file describes the boundary of the system as it is in production plus the repository it is built from.

Sources: `01-BASELINE/01-APPLICATION-AND-SECURITY-BASELINE.md`, `01-BASELINE/04-CONTROL-EVIDENCE-INVENTORY.md` (section numbers below, "Inv. §n"), `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`, `CLAUDE.md`.

---

## 1. The first question: who is the "service organisation" and who are the "user entities"?

In a normal SOC 2 report, a **service organisation** (a company that runs a service) reports to **user entities** (its customers) about its controls. CKDesk is an **internal help desk** for Citykart's own staff. The repository shows no external customer.

So, before this boundary means anything, management must say **why a SOC 2 style report is wanted** and **who will read it**. Realistic possibilities (management must pick one):

| Possibility | What it would mean for the boundary |
|---|---|
| (a) Internal assurance only (the board / owner wants to know the design is sound) | Service organisation = Citykart IT / the CKDesk team. User entities = Citykart head office and stores. No external reader. A CPA report is optional. |
| (b) A group company, lender, auditor or customer asked for it | Then that party is the user entity and their requirements decide the criteria. **Not known from the repository.** |
| (c) CKDesk will later be offered to third parties | The multi-tenant leftovers (`organizations`, `org_id`, `seat_limit`, `license_keys`) suggest this was once considered (Inv. §11). A different, wider boundary would be needed. Not proposed now. |

This file assumes **(a)**. If it is (b) or (c), the boundary and the criteria in `SOC2-TSC-APPLICABILITY.md` must be revisited.

---

## 2. The proposed boundary in one picture (text)

```
  Staff browsers (head office + stores)            <- OUT (user-entity side, see CUECs, section 9)
          |  plain HTTP today (D-018 / VA-API-01 open)
  Internet / ISP / router (NAT TCP 3210)           <- OUT (subservice / third party, section 8)
          |
  ==== PROPOSED BOUNDARY STARTS ==========================================================
  App server 10.0.1.98 (Windows):  reverse proxy -> Next.js app (CkDeskApp) -> Auth (GoTrue)
                                   -> PostgREST -> Storage ; scheduled tasks ; log shipper
          |                         |                                 |
  Database server 10.0.0.205     NAS 10.0.0.25                    Mail / WhatsApp / OAuth / DeskTime
  PostgreSQL 18, db "ckdesk"     CKAPPLICATIONS_DATA\CKDESK_DATA  (vendors, section 8)
  nightly backup task            attachments + sidecar files
  Dev PC 10.0.0.47 + GitHub repo (build, deploy, admin ssh key) <- IN as supporting component
  ==== PROPOSED BOUNDARY ENDS ============================================================
```

---

## 3. Infrastructure

| # | Component | What the repository / runbook says | Proposed | Class |
|---|---|---|---|---|
| I-1 | **App server 10.0.1.98** | Windows Server 2022. Runs five Windows services started by NSSM (`CkDeskApp`, `CkDeskPostgrest`, plus the login service, the file-storage service and the small reverse proxy; exact service names to be confirmed). Also holds the scheduled tasks and the log shipper. **Shared**: it also hosts another application ("Citykart Spinwheel"). Rule: touch only CKDesk's own folder and services. | IN (CKDesk folders, services and tasks only). The other application is OUT. | D (Inv. §4, §14) |
| I-2 | **Database server 10.0.0.205** | PostgreSQL 18, database `ckdesk`, data on `D:\POSTGRESQL DB`. **Shared** with other applications' databases. Database roles: `citykart_desk_app`, `anon`, `authenticated`, `service_role`, `ck_backup`, `postgres` (Inv. §4). | IN for database `ckdesk` and its roles. Other databases OUT. | D |
| I-3 | **Backup job on 205** | Scheduled task `CK_Backup_CKDESK`, 02:30 nightly, `pg_dump -Fc`, readability check, 30 days kept in `E:\DB BACKUP\CK_CKDESK_DBBACKUP`. The script `C:\ProgramData\CKBackup\backup-db.ps1` is **not in the repository**. | IN | D (Inv. §9) |
| I-4 | **NAS 10.0.0.25** | Synology (model recorded as RS1221+), share `CKAPPLICATIONS_DATA`, folder `CKDESK_DATA` holds attachments, one `.xattrs.json` sidecar per file. "RAID/snapshots are the NAS's job" - no NAS backup or snapshot setup is described. | IN for the `CKDESK_DATA` folder. Other shares OUT. | D |
| I-5 | **Network and public access** | Router NAT forwards TCP 3210 to 10.0.1.98; Windows firewall rule "Citykart Desk web app (3210)" on 98. Public/email URL `http://182.72.84.10:3210` — **plain HTTP**. Whether port 5432 or the NAS can be reached from outside the LAN is **not stated**. No network diagram. | IN (the NAT rule and firewall rule). ISP and router hardware: carve-out candidate (section 8). | D (Inv. §3, §14) |
| I-6 | **Reverse proxy** | A small Node `http` server (`deploy/windows/proxy/server.js`), no TLS, reuses keep-alive connections with one retry. | IN | B/D |
| I-7 | **Developer / admin PC 10.0.0.47** | Builds the application (`scripts/windows/build-for-deploy.ps1`), holds the ssh key used to reach 98 and 205, and holds production-like data copies (git-ignored dump files; `main-server-configuration` captured from the live screens). Endpoint protection, disk encryption and screen lock: not stated. | IN as a **supporting component** because deployment and administrative access start here. | B/D (Inv. §4, §14) |
| I-8 | **Source repository (GitHub)** | `github.com/kumarsuraj84/Citykartdesk`, remote branch `origin/main`. Branch protection and review settings are GitHub-side and **not in the repository**. | IN (as software supply chain). GitHub itself is a vendor (section 8). | B |
| I-9 | **Retired server 10.0.1.12 ("Main")** | Retired and kept disabled. Its old database is kept as an archive and a final dump is kept on 205 (`main_final_precutover_20261007.dump`). The runbook lists "drop of the archived `citykart_desk` database on Main" as an open item. | **OUT of the operating boundary**, but the *data it still holds* is IN for confidentiality and disposal questions (criteria C1.2 / CC6.5). Management decision needed. | D (Inv. §14, cross-cutting 5) |
| I-10 | Workstations of staff and store PCs/phones | Not in the repository. | OUT (user-entity side). See CUECs. | E |
| I-11 | Physical premises, power, cooling, rooms | Not in the repository (IP addresses only). | **Cannot be placed** until management says where the servers and the NAS sit and who runs that site. | E |

---

## 4. Software

| # | Component | Facts from the repository | Proposed | Class |
|---|---|---|---|---|
| S-1 | **CKDesk web application** | Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19. Production runs 16.2.9 (the framework advisories fixed by the assessment's upgrade to 16.3.8 are **not live**; finding VAPT-DEP-01). 60 pages, 27 API routes, 54 server-action files, 295 exported actions (baseline §2). | IN | A/B |
| S-2 | **Login service (GoTrue)** | Self-hosted, built from source with a Windows patch (`deploy/windows/services/patch-auth-windows.ps1`). Settings live in `services\auth\.env` on 98 (not in the repo). Template sets sign-up disabled. | IN | B/D |
| S-3 | **PostgREST (data API)** | Self-hosted; reads the database with the user's token so row security applies. Must be restarted after a migration (schema cache). | IN | D |
| S-4 | **Storage service** | Self-hosted; stores files on the NAS; runs as local Windows user `ckappuser`. Attachments are also served through app routes that check access. | IN | D/B |
| S-5 | **Database logic** | 164 migration files up to `…163` at the baseline (the assessment adds one **local-only** migration, `…164_vapt_security_hardening.sql`, which is not in production); whether 156-163 are live is **not provable from the repo**. In the disposable audit database: 222 row-security policies and 39 `SECURITY DEFINER` functions in `public`, plus triggers and a pgcrypto-based `supabase_vault` shim. | IN | B |
| S-6 | **Scheduled jobs** | Windows tasks `CitykartDesk-Cron-*`: Alerts (30 min), Business Rules (15 min), E-mail reply sync (1 min), CSAT (30 min), System Log archive (6 h), Approval reminders (daily 10:00); log shipper (2 min). Run as SYSTEM, call app routes with a shared secret `CRON_SECRET`. | IN | B |
| S-7 | **System Log and log shipper** | Append-only `system_log` with hash chain (migration 160), `scripts/log-shipper.mjs`, `/api/system-log/ingest`. | IN | B |
| S-8 | **Secrets and configuration files** | `.env.local`, `services\auth\.env`, `postgrest.conf`, `storage-src\.env` on 98; vault key as a database setting on 205. | IN | D |
| S-9 | **Older components in the repo** | `api/` (separate worker with its own Dockerfile and `railway.toml`), `Dockerfile`, `railway.toml`: described as **not** the live deployment. The role of `api/` in production is **not known from the repository — management to confirm**. | OUT unless management confirms it runs in production | B/D |
| S-10 | **Open-source components** (GoTrue, PostgREST, Storage, PostgreSQL, Node, NSSM) | Self-hosted software. Treated as **software inside the boundary** (Citykart patches and runs it), not as subservice organisations. | IN | D |
| S-11 | **Test and audit stacks** | Local development stack and a disposable audit stack (ports 553xx, egress guard, 21-check isolation gate - `01-BASELINE/02-LOCAL-ISOLATION-CERTIFICATION.md`). No staging server. | OUT of the production boundary (they hold synthetic data). Relevant to change management only. | A/B |

---

## 5. People (roles)

Software roles come from `lib/constants/roles.ts`. Job roles (who performs them) are **not known from the repository — management to confirm**.

| Role | Where defined | What it can do (summary) | Count (source) | Proposed |
|---|---|---|---|---|
| Requester (`user`) | App roles | Raise and follow own tickets, approve when named as approver, rate (CSAT) | 482 of 527 (2026-09-24 snapshot, D); audit DB sample 300 | IN as end user (CUEC side) |
| Technician (`agent`) | App roles | Work tickets of their team, internal notes | 41 (snapshot) | IN |
| Manager | App roles | Org-wide ticket read (D-005), reports, some configuration | 2 (snapshot) | IN |
| Admin | App roles | Users, configuration, System Log; cannot change admin / platform owner | 0 (snapshot) | IN |
| Platform owner | App roles | Grants admin / platform owner; global settings | 2 (snapshot) | IN |
| Developer / deployer | `CLAUDE.md`, runbook §4 | Commits, builds, deploys; all 271 commits carry one author identity | 1 identity | IN |
| Release approver | `CLAUDE.md` ("the user's explicit OK") | Approves each push and deploy | 1 person named as "the user" | IN |
| Server administrator (Windows `Administrator`, ssh key) | Runbook §2 | Full control of 98 and 205 | shared built-in account | IN |
| Database administrator (`postgres`) | Runbook §5 | Runs migrations; password typed by the user | not stated | IN |
| NAS administrator | Not documented | Share permissions, snapshots | not stated | IN (role unknown) |
| IT Support owner / HR Support owner / pilot monitoring owner / technical escalation owner | `PILOT_MONITORING_SCORECARD.md`, `WHATSAPP_PILOT_RUNBOOK.md` | Named by title; documents say no person is named yet | none named | IN (WhatsApp pilot only) |
| Security owner / DPO / risk owner | - | - | **Not found in repository** | Needed (see gaps) |

Population figures are the 2026-09-24 admin-screen snapshot (about 553 accounts at the last count according to the assessment brief). They are not re-verified.

---

## 6. Data

| # | Data | Examples | Stored where | Sensitivity (PROVISIONAL, no scheme exists) | In boundary |
|---|---|---|---|---|---|
| DT-1 | **Ticket data** | Title, description, form answers, category, status, priority, SLA dates, assignment, comments, tasks, projects, history | Database `ckdesk` | Internal; **some tickets Confidential** (HR, finance - see D-005) | IN |
| DT-2 | **Internal notes** | Technician notes hidden from the requester (D-015, VA-INT-01/03) | Database | Confidential | IN |
| DT-3 | **Personal data of staff** | Name, e-mail (sign-in), employee id, job title, manager, department, location, store, cost centre, designation, avatar | Database | Personal | IN |
| DT-4 | **Mobile numbers** | One or more per profile; WhatsApp opt-in (VA-INT-13 fixed locally only) | Database | Personal, higher sensitivity | IN |
| DT-5 | **Attachments** | Files on tickets, tasks, e-mail intake | NAS `CKDESK_DATA` + sidecar files; records in database | Internal to Confidential; may hold anything users upload | IN |
| DT-6 | **Approval data** | Approval steps, decisions, comments, one-time codes (hashed, 10 min), signed e-mail links | Database | Confidential (business decisions) | IN |
| DT-7 | **E-mail and WhatsApp conversations** | Bodies and participant addresses (intake), WhatsApp events and media | Database, NAS | Personal / Confidential; includes **people outside Citykart** (senders) | IN |
| DT-8 | **Secrets** | Mailbox password, WhatsApp / Intake credentials, DeskTime API key (encrypted in vault); JWT secret, service-role key, `CRON_SECRET` (files on 98) | Database vault, files on 98 | Restricted | IN |
| DT-9 | **Logs** | System Log (audit, security, error, event), Event Log (page views / clicks), Windows service logs, `backup.log`; source IP and user agent | Database, files | Internal; contains personal data (user ids, IPs) | IN |
| DT-10 | **DeskTime data** | Per-person project time and application usage matched by e-mail | Database | Personal, employee monitoring | IN (if enabled — management to confirm) |
| DT-11 | **Web Push subscriptions** | Browser endpoint and keys per user | Database | Personal | IN |
| DT-12 | **CSAT ratings** | Ratings and comments | Database | Internal | IN |
| DT-13 | **Backups** | `pg_dump` files for 30 days on 205; pre-cutover dump of the old server | `E:\DB BACKUP\...` on 205 | Same as the data inside; **second copy not made** | IN |
| DT-14 | **Developer copies** | Git-ignored dump files and file archive on the dev PC (not opened by this assessment) | Dev PC | Production-like — contains the above | IN (risk) |

No data inventory, classification scheme or record of processing exists in the repository (Inv. §11). Row "Sensitivity" is a proposal.

---

## 7. Procedures in the boundary (what is written down)

| Procedure | Where written | Class |
|---|---|---|
| Release: test locally, explicit OK, push, build, copy zip, swap folders, verify `/api/health` and `/api/version` | `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4; `CLAUDE.md` | D |
| Application rollback (rename folders back; never reverses a database change) | Runbook §4 | D |
| Database migration (back up first, `psql --single-transaction`, restart PostgREST, record in `auth.schema_migrations`) | Runbook §5; `deploy-bundle-migrations-156-163/run-migrations.ps1`; `supabase/production/run-ckdesk-migration-155.ps1` | B/D |
| Migration rollbacks for 156-163 | `supabase/rollback/` | B |
| Backup (nightly) and restore (written steps) | Runbook §6 | D |
| After-reboot checklist; service control and start order | Runbook §7 | D |
| WhatsApp pilot daily checks, common failures, pause-and-preserve rollback | `WHATSAPP_PILOT_RUNBOOK.md` | D |
| User invitation, bulk import, deactivation (as software behaviour) | `lib/actions/admin/users.ts` | B |
| **Not found**: information security policy, access request / leaver process, access review, incident response plan, risk assessment, vendor management, BC/DR plan, data classification, retention schedule actually applied, log review procedure | - | **E** |

---

## 8. Subservice organisations and vendors

A **subservice organisation** is an outside company whose service Citykart's system relies on to meet a criterion. SOC 2 gives two ways to treat them:
- **Carve-out method**: the description names the vendor and the controls it is expected to run (called "complementary subservice organisation controls"), but the vendor's own controls are **not** tested in the report.
- **Inclusive method**: the vendor's relevant controls are described and included in the report, which requires the vendor's cooperation and its own auditor evidence.

**Question for the independent auditor (not decided here):** *Which method should be used for each vendor below? Our expectation is carve-out for all, because Citykart holds no contract right to audit large providers such as Google or Meta.* The auditor and management decide.

| # | Vendor / service | What the repository shows | Data that leaves Citykart | In production? | Suggested method (question) | Class |
|---|---|---|---|---|---|---|
| V-1 | **Google Workspace / Gmail** (SMTP `smtp.gmail.com:587`, IMAP `imap.gmail.com:993`) | One shared mailbox with an App Password (in the vault) sends all notifications and reads replies once a minute (3-day look-back) | Ticket notifications, approval and CSAT links, password-reset and invitation links, vendor mails, scheduled reports; incoming replies | Likely yes (main-server-configuration doc); **management to confirm** | Carve-out; list Google's availability and security as complementary subservice controls | B/D |
| V-2 | **Google (Gmail API / Pub/Sub) and Microsoft (Graph / Outlook) OAuth** | Optional intake channels; webhooks; OAuth state signed | Mailbox content for intake | Not in the repository — **management to confirm** if any channel is active | Carve-out, if active | B |
| V-3 | **Meta WhatsApp Cloud API** | Webhook (HMAC checked), outbound via `graph.facebook.com`, credentials in vault; pilot for IT and HR support; repo reports say real-Meta validation was not done | Staff mobile numbers, message text and media, ticket details | **Management to confirm** (pilot status) | Carve-out, if active | B/D |
| V-4 | **LLM provider (Groq by default)** | `generateEmailBrief` calls `api.groq.com` only when `INTAKE_LLM_API_KEY` is set; reviewers only | Subject, From address, first 2,000 characters of an e-mail | Probably off by default — **management to confirm** | Carve-out, or "not used" | B |
| V-5 | **DeskTime** | API key in vault, sent as a URL query parameter; sync route exists but the task installer does not create a schedule | Employee list, time and application usage | **Management to confirm** | Carve-out, if active | B |
| V-6 | **Browser push services** (Web Push) | Off unless VAPID keys are set | Notification title, body, link | **Management to confirm** | Carve-out | B |
| V-7 | **Resend** (optional e-mail API fallback) | Used only if no SMTP is configured | As e-mail | Probably not — **management to confirm** | Carve-out or not used | B |
| V-8 | **GitHub** | Hosts the source code | Source code (no production data) | Yes | Carve-out | B |
| V-9 | **ISP / router / public IP** | Router NAT to 98 | All traffic in transit (plain HTTP) | Yes | Carve-out | D |
| V-10 | **Hardware and facility providers** (server hosting room, NAS vendor support, power) | Nothing in the repository | - | Unknown | Cannot decide until the facility is described | E |
| V-11 | **Google Fonts / gstatic** | Allowed in the (report-only) CSP | Visitor IP when fonts load | Probably yes | Carve-out (low impact) | B |
| V-12 | **Staffing / contractors with admin access** | Not in the repository | - | Unknown | Management to confirm | E |

Not subservice organisations: Supabase (cloud) — **not used in production**; the Supabase open-source components run on Citykart's own server. The "Catch me up" ticket summary runs inside the app and uses no outside service. The planned "CK Desk Bot" is **not built**; if it uses an outside model, the boundary must be revisited.

**No supplier register, contracts, data-processing terms, supplier SOC / ISO reports or exit plans exist in the repository (Inv. §12).** This is recorded as a design gap in `SOC2-TYPE-I-GAP-ASSESSMENT.md`.

---

## 9. Complementary user-entity controls (CUECs)

These are things Citykart's own staff and stores must do for the system's controls to work. They are *proposed* and are **not currently written down anywhere in the repository**, so no one has been told to do them.

| # | Who | What they must do | Why it matters |
|---|---|---|---|
| U-1 | Every user | Keep their password private; do not share accounts; change the temporary or default password at first sign-in; never type a password into a ticket or note | The app signs people in by password only (no MFA). A rule requires resolution notes to say "no password" |
| U-2 | Every user | Report lost devices, suspected account misuse, phishing mails and strange approval e-mails to IT at once | Approval and CSAT links work without signing in |
| U-3 | Every user | Do not forward approval or CSAT e-mail links; the one-time code stays private | Links are bearer links |
| U-4 | Store managers and head-office managers | Tell IT promptly when someone joins, moves or leaves, so the account is created, changed or deactivated | The app has no feed from HR; deactivation is a manual admin action (Inv. §2) |
| U-5 | Managers / approvers | Approve only what they have checked; do not approve their own request; do not delegate to avoid separation of duties | Self-approval is blocked in code, but delegation side doors remain (VA-TKT-07) |
| U-6 | Managers and admins | Review the list of people with elevated rights regularly and tell IT of changes (management must define "regularly") | No access review process exists (Inv. §2.4) |
| U-7 | Requesters and technicians | Mark sensitive tickets correctly (HR, finance); use the confidential routes once defined; do not attach files with data that is not needed | No classification scheme (D-005) |
| U-8 | Store and head-office staff | Keep their own PCs, phones and browsers updated and locked; sign out on shared PCs | Browsers hold the session cookie (long lifetime, D-037) |
| U-9 | HR | Give IT the leaver list the same day; give IT the monitoring notice wording if DeskTime is used | Deprovisioning and privacy |
| U-10 | Business owners of integrations (IT Support owner, HR Support owner) | Own and review the WhatsApp / e-mail channels; name the escalation owner | Runbook says no one is named yet |
| U-11 | Anyone who raises a ticket by e-mail or WhatsApp | Use only the official mailbox / number; do not trust a message asking for a code or password | Channel spoofing |
| U-12 | All staff | Follow the information security and acceptable-use rules once management approves them | **No such policy exists yet** |

---

## 10. What is proposed OUT of the boundary

- The other applications on 10.0.1.98 and 10.0.0.205, and other NAS shares.
- The retired server 10.0.1.12 as an operating system (its remaining data is a disposal question - see I-9).
- Staff end-user devices and networks outside the Citykart data centre (CUEC side).
- The test and audit stacks (synthetic data), except as evidence for change management.
- The old Railway / Docker deployment and the separate `api/` worker unless management confirms they run in production.
- Planned but unbuilt features (CK Desk Bot, Google Workspace user sync).

---

## 11. Open questions / evidence requests for management

1. State the **purpose and reader** of any SOC 2 style report (internal only? a named customer / group company / lender?). The boundary and criteria depend on it.
2. Name the **service organisation** (legal entity and team) and the **responsible executive** for CKDesk.
3. Confirm the **list of production servers, NAS folders and Windows services** actually used by CKDesk, with exact service names, and whether `api/` runs in production.
4. Provide a **network diagram**: what is reachable from the internet, whether 5432 and the NAS are reachable from outside the LAN, and what the router/firewall rules are.
5. Describe the **physical location** of 10.0.1.98, 10.0.0.205, 10.0.0.25 and the backup disks: who owns the room, who has access, power/UPS/cooling, and whether the backup disks are in the same room as the servers.
6. Confirm which **integrations are enabled in production** (Gmail mailbox, Gmail API / Outlook, WhatsApp, Groq, DeskTime, Web Push, Resend) and the date each was enabled.
7. Provide **contracts / terms** for Google Workspace, Meta, DeskTime, Groq (if used), the ISP and the NAS support, and any supplier SOC or ISO reports.
8. List the **named people** for each role in section 5 (release approver, database administrator, server administrator, NAS administrator, security owner, privacy owner, pilot monitoring owner, technical escalation owner), and who holds the ssh key and the `postgres` password.
9. Confirm the **current number of users by role** (the figures here are the 2026-09-24 snapshot) and the number of platform owners and admins.
10. Decide what happens to the **data still on the retired server 10.0.1.12** and the old archived database (keep, until when, then delete how).
11. Confirm the **method per vendor** you would like to propose (carve-out or inclusive), then ask the CPA firm to confirm.
12. Approve (or change) the **complementary user-entity controls** in section 9 and say how staff will be told.
13. Confirm that **CKDesk data may leave the country or the company network** (Google, Meta, Groq, DeskTime) and under what approval.
