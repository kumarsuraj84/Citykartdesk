# Citykart Desk (CKDesk) — Complete Security, VAPT, ISO/IEC 27001 and SOC 2 Status Report

**One document for a second reviewer (human or AI).** It compiles everything done from the first audit (13 Oct 2026) and the VAPT / ISO 27001 / SOC 2 assessment (15 Oct 2026) up to the current state of the local code (16 Oct 2026, local commit `bcfe76d`).

| | |
|---|---|
| Written | 2026-10-16, after local commit `bcfe76d` |
| Project | Citykart Desk (CKDesk), Next.js 16 + self-hosted Supabase (Postgres, PostgREST, GoTrue, Storage) |
| Production today | App server 10.0.1.98, database 10.0.0.205 (`ckdesk`), files on NAS 10.0.0.25. Build `20261015-145217`, main `717e5c6`, **Next.js 16.2.9**. |
| **Nothing in this report is in production** | No fix described here is pushed, merged, migrated or deployed. All work is on LOCAL branches. Production, the NAS and the old server 10.0.1.12 were never contacted by any test. |
| Overall status label | **CONDITIONAL — NOT READY FOR PRODUCTION RELEASE YET.** The work is in progress (Phase 3 of the plan below is partly done; phases 4–7 are not done). Several management decisions and production configuration steps are open. This is not a certification of any kind. |

---

## 0. How to read this report (and what it does NOT claim)

1. **"Fixed" means: fixed in the LOCAL working copy and proven on a disposable, isolated test copy of the system** (fake users, fake tickets, no e-mail, no WhatsApp, no route to production). It does not mean fixed in production. Production has none of the security fixes yet.
2. **ISO/IEC 27001 and SOC 2 were "readiness assessments", not audits.** I (an AI assistant working with the project owner) assessed the repository and drafted documents. I cannot issue a certificate or attestation. SOC 2 Type I and Type II attestations can only be issued by an independent CPA firm; ISO 27001 certification only by an accredited certification body. **No approved policy, owner, access review, restore test or management review exists yet**, so I recorded zero controls as "operating with evidence". I did not invent any record, approval or evidence.
3. **Evidence classes** used in every register: **A** = my own executed test on the isolated stack; **B** = repository evidence (source code, migrations, policy text); **C** = organisational evidence from the company (none supplied, so none claimed); **D** = documentation only; **E** = missing / not verified.
4. **Status words** are Fixed, Partially Fixed, Open, Requires Decision, Not Verified. Severity is the assessor's rating (not a CVSS score), apart from the one framework advisory whose published figure is quoted and marked as copied.
5. **The statuses in section 5 for 16 Oct ("now") are my own assessment** from the commits and the tests named beside each row. They have not been re-verified by anyone else. A reviewer should challenge them (see section 12, "Where I could be wrong").
6. Tools you named that were **not available** and therefore **did not run**: Semgrep, Gitleaks, OSV-Scanner, OWASP ZAP, Nuclei, Burp Suite. Their checks were replaced by `npm audit`, targeted searches and manual code review. I did not pretend otherwise.

---

## 1. Executive summary (plain language)

- **What the system is.** A ticket / service-desk web application used by the company. Staff, technicians, managers and administrators work in it; requesters raise tickets. It handles approvals, SLA deadlines, e-mail intake, WhatsApp intake, reports and dashboards.
- **What was found.** First audit (13 Oct): 4 Critical, 24 High, 31 Medium and about 45 Low/Informational security findings plus code-quality findings. The VAPT of 15 Oct consolidated everything into **70 distinct findings: 1 Critical, 3 High, 34 Medium, 32 Low**.
- **The most important insight.** Most serious problems were not "outsiders breaking in". They were **rules that existed only on the screens or in the server code**, while the database let a signed-in user bypass them by talking to it directly (for example a technician pushing a ticket deadline a year ahead, a user creating a ticket with a forged priority, a requester reading private internal notes' attachments, any employee reading colleagues' mobile numbers).
- **The most urgent production fact.** Production runs Next.js 16.2.9, which has published critical security advisories, including remote code execution on Windows servers (published CVSS 9.0). The fixed version (16.3.8) is already prepared as a separate, framework-only release candidate. It should be released first, on its own.
- **Progress on the 70 findings.**

| | 15 Oct (end of VAPT) | 16 Oct (now, local only) |
|---|---:|---:|
| Fixed | 29 | **46** |
| Partially Fixed | 6 | **3** |
| Requires Decision (management) | 6 | **5** |
| Not Verified | 2 | **2** |
| Open | 27 | **14** |
| Total | 70 | 70 |

- **Testing state of the final local code.** Type check clean; lint clean; default suite 1,789 passed / 18 skipped / 0 failed; remediation suite 184 / 184 passed; VAPT suite 68 / 68 passed. The 18 skipped tests need the production catalog and are deliberately blocked by the no-production rule. All dynamic tests ran only after a 21-point isolation gate passed (it failed once, on 16 Oct, because the owner's own Remote Desktop session to the old server was open; testing stopped until it was closed and the gate passed again).
- **What is still missing before any release.** 14 findings Open, 5 waiting for management decisions, 2 not verifiable from here, no full browser walk-through of the final code for every role, no performance run of the final code at 100k/500k tickets, ISO/SOC 2 work limited to drafts, and the production prerequisites in section 10 (new secrets, HTTPS decision, sign-up setting check, PostgREST restart, backup + restore test).

---

## 2. Timeline — what was done, in order

| Date | What happened | Where it lives |
|---|---|---|
| 13 Oct | **First full audit** of `main` @ `e215ebd`: architecture, 21-point isolation gate, synthetic dataset (329 users, 200 stores, 3,000 tickets), 30-module inventory, six-angle security/quality review, database integrity review, performance test at 100k/500k tickets. Produced 4 Critical / 24 High / 31 Medium / ~45 Low findings. | `CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md`, `audit-2026-10/reports/*` |
| 13 Oct | **First remediation** on branch `remediation/post-audit-2026-10`: all 4 Critical and 22 of 27 High fixed; migrations 156–159; ticket-list speed at 500k tickets 28 s → 1.3 ms. | `audit-2026-10/remediation/*` |
| 14 Oct | Further audit batches (migrations 160–163: System Log, status-transition check, unique ticket per e-mail, etc.), **deployed to production** (build `20261014-095639`). Plus many feature changes (reports, dashboards, approval reminders). | git history 14 Oct; production deploy notes |
| 15 Oct (morning) | **Start of the VAPT + ISO/IEC 27001 + SOC 2 readiness assessment.** Baseline, isolation certification, attack-surface, automated checks, manual penetration tests, five independent code reviews, then ISO/SOC 2 drafts. | `security-assessment-2026-10/01-BASELINE … 06-MANAGEMENT` |
| 15 Oct (14:45) | "No manual priority change" feature deployed to production (build `20261015-145217`, main `717e5c6`). | production |
| 15 Oct (16:29–16:58) | **VAPT fixes (LOCAL, branch `security/vapt-iso27001-soc2-local`)**: Next.js 16.3.8, migration 164 and about 56 code files; assessment reports committed. | commits `35922ad`, `7ee19e0`, `b6e5a79` |
| 16 Oct (10:01) | **Phase 0:** framework-only release candidate branch `release/p0-framework-next-16.3.8` (`bb38cbf`), proven independent of migration 164. | branch `release/p0-framework-next-16.3.8` |
| 16 Oct | **Complete remediation program (Phases 1–3A, local):** server-only writes (mig. 165), approvals privacy (166), ownership/privacy (167), password enforcement (168), no default password, per-purpose secrets, permission matrix, Low findings batch A (mig. 169). | branch `security/remediation-phase2-local` (11 commits above `main`) |

---

## 3. Safety rules followed (isolation)

- **LOCAL development and LOCAL testing only.** No production access, no GitHub push, no merge, no deployment. No production database migration was run. No password, token or key is printed in any report.
- **Isolated audit stack**: containers `supabase_*_ckdesk_audit`, API port 55421, database 55422, mail trap 55424, app 3310. Different from the developer's own stack (ports 543xx).
- **Egress guard** (`audit-2026-10/guard/egress-guard.cjs`) refuses connections to 10.0.1.98, 10.0.0.205, 10.0.0.25, 10.0.1.12 and 182.72.84.10 before a socket opens.
- **Isolation gate** (`audit-2026-10/guard/run.ps1`): 21 checks (loopback-only URLs, no production address anywhere, mail/WhatsApp/OAuth/LLM settings blank, audit stack running, only synthetic users and tickets, no network socket to production by any non-browser process). All dynamic tests run through it.
- **Gate failure on 16 Oct:** check N1 flagged `mstsc.exe` (the owner's Remote Desktop session to the old server 10.0.1.12). The audit never opens such a session. Dynamic testing stopped; I did not bypass or weaken the gate. Gate re-ran 21/21 after the owner closed the session.
- Test-harness databases only: all migrations in this report were applied to the disposable audit database, never to real data.

---

## 4. What was tested and how

| Area | Method | Evidence class |
|---|---|---|
| Architecture / attack surface | Read of all routes, server actions, proxy, migrations | B |
| Database access control (RLS, grants, triggers, functions) | Real signed-in test users (requester, technician, manager, admin, platform owner) calling the database REST interface directly; before/after each fix; rollback and re-apply of migrations | A |
| Server actions (ticket, approval, admin, user, settings) | Called through real server code with a real session against the real isolated database | A |
| HTTP behaviour (login CSRF, static-path bypass, header trust, log flooding, body size) | HTTP probes against the rebuilt isolated app | A |
| Authentication | Sign-in throttling, password spraying, forgot-password timing, one-time passwords, must-change-password enforcement (server + database) | A |
| Secrets handling | Unit tests + script that checks the environment | A/B |
| E-mail / webhooks | Logic-level tests with mocks only (no real mail or WhatsApp) | A (logic) |
| Dependencies | `npm audit` before/after Next.js upgrade | A |
| Source review | Five independent code reviews plus own review | B |
| Performance | 3,000 synthetic tickets, 40 timed calls per operation as real users (before/after migration 164). Earlier (13 Oct): 100k and 500k tickets. | A |
| ISO 27001 / SOC 2 | Document and repository assessment; control-by-control matrices | B/D (no organisational evidence) |

**Not done (stated openly):** the scanners listed in section 0; real e-mail/WhatsApp/OAuth behaviour; full browser walk-through of the *final* code for every role; 10–25 MB upload test with a real file; performance run of the final code at 100k/500k tickets; any test against production (forbidden).

---

## 5. The 70 findings — what it was, what changed, status now

Legend for "Now": **F** = Fixed (local, with code + test), **P** = Partially fixed, **O** = Open, **D** = Requires management decision, **NV** = Not verified. "Prod" = something must be done on production before the fix has effect.
Test names: `v20` = `tests/vapt/20-ticket-actions-authz`, `v21` = `…21-approvals-separation`, `v22` = `…22-projects-tasks-files-privacy`, `v23` = `…23-permission-matrix-and-rules`, `v24` = `…24-ticket-low-findings`, `v30` = `…30-onboarding-and-password-enforcement`; `T10/T11/T12` = `tests/vapt/10/11/12`; `TU` = `tests/unit/vapt-hardening-units`; migrations M164–M169 are in `supabase/migrations/20240101000164…169`.

| ID | Sev | What was wrong (before) | 15 Oct | Now | What changed (after) and evidence |
|---|---|---|---|---|---|
| DEP-01 | Critical | Next.js 16.2.9 has 16 published advisories incl. Windows remote code execution | F | **F** | Next.js 16.3.8 (and eslint-config-next); `npm audit` prod vulnerabilities 9 → 2 moderate. Separate release candidate branch `release/p0-framework-next-16.3.8`. **Prod: not deployed.** |
| DEP-02 | Medium | `uuid` inside `exceljs` has a moderate advisory | O | **O** | Only fix is a breaking downgrade of `exceljs`; vulnerable call not used. Needs management acceptance or a library change. |
| 001 | High | A technician/manager could change priority, SLA deadlines, assignee, description etc. of a ticket by talking to the database directly | P | **F** | M164 guard trigger + **M165 removes direct INSERT/UPDATE/DELETE on `requests` and ~45 server-written tables for signed-in users**; server actions write after explicit checks. Assignee validated. Tests v20, 71/40/118 updated. |
| 002 | High | Plain HTTP: login cookies not Secure, no HSTS, CSP only reports | D | **D** | Code is HTTPS-ready (Secure cookies + HSTS switch on when the site URL starts with https). **Management must decide HTTPS/VPN; certificate + reverse proxy needed. Prod.** |
| 003 | High | Bulk-imported users all got one password written in source code | D | **F** | No shared default any more: bulk import creates random one-time passwords or sends invitations (`lib/auth/one-time-password.ts`, `bulkCreateUsers`); forced change enforced by the server (profile loader) **and the database (M168: helpers return no org/role for a flagged user)**. Tests v30, unit/one-time-password. **Prod: check whether any live account still has the old shared password; choose onboarding mode (both prepared).** |
| 004 | Med | Any user could create a ticket in the database with any priority/service/team | F | **F** | Tickets created by the server only (M164, strengthened by M165). |
| 005 | Med | A user could switch off their own "must change password" flag | F | **F** | Column right removed + trigger; plus M168 enforcement. |
| 006 | Med | A manager could change configuration reserved for administrators (services, SLA policy, ~20 master tables) directly in the database | P | **F** | M165 revokes direct writes on those tables; server checks through the permission matrix (`lib/permissions/matrix.ts`). v23 (direct write refused). |
| 007 | Med | Any manager/admin can change company-wide settings; any app-setting key accepted | D | **D** | **Safest preparation built:** only known keys with value checks (`APP_SETTING_RULES`), and switch `global_settings_write` (managers / admins / platform owners only). Default = today's behaviour. **Decision needed.** v23. |
| 008 | Med | A manager can write a Business Rule that sets priority/status/group | D | **D** | Switch `business_rules_write`; additionally a rule can only make status moves a person could make (+ auto-close), e.g. cannot revive a cancelled ticket. v23. **Decision needed.** |
| 009 | Med | A manager can edit approval workflow steps, even naming themselves | D | **D** | Switch `workflow_edit`; approver separation rules (see 016). **Decision needed.** |
| 010 | Med | E-mail intake reviewer can set ticket priority by hand | D | **D** | Switch `intake_priority_override` (allowed / denied). **Decision needed.** |
| 011 | Med | Start of an internal note was sent by bell/e-mail/push to people who may not read it | F | **F** | Alerts reach only permitted readers. T10. |
| 012 | Med | File attached to an internal note was downloadable by the requester | F | **F** | File inherits the internal flag; storage read rule hides it. T10 before/after. |
| 013 | Med | E-mailed reply accepted from any employee/OEM for any ticket number | F | **F** | Sender must take part in the ticket. T12/TU. |
| 014 | Med | Submit-for-approval picked any workflow, could be started by requester | F | **F** | Staff only, defined workflow, sender recorded. |
| 015 | Med | Ad-hoc approval route names (with ticket title) readable by every employee | P | **F** | M166: approval workflows readable only by org staff or those with a visible approval; steps via workflows. v21. |
| 016 | Med | Separation of duties only on "decide"; delegate/add-approver/other submit were side doors | O | **F** | `lib/approvals/separation.ts`: requester/sender cannot be approvers on any route (choose, add, delegate); `added_by` recorded. v21 (5 of 6 failed before the fix). |
| 017 | Med | New ticket stored any form keys, incl. technician-only fields | F | **F** | Only requester-settable fields accepted. |
| 018 | Med | Project / task / task-file rules checked role only, not ownership | O | **F** | M167: `can_view_project` for members/milestones/updates; tasks same-org + visible-request checks; task-file direct writes revoked. v22 (7 of 8 failed before). |
| 019 | Med | Every employee could read staff list with roles, approval routes, escalation and alert rules | O | **P** | Approval routes (M166), alert/escalation/permission-override/scheduled-report/related-request lists and team membership (M167) now staff-only/own. **The general staff list (names, roles) is still readable by signed-in users — to be re-checked/decided.** |
| 020 | Med | Every employee could read all colleagues' mobile numbers | F | **F** | Own row or staff; write admin only. |
| 021 | Med | File-store read rule ignored org/internal flag; two INSERT policies lacked an org test | P | **P** | Internal flag and org in read rule (M164); org checks on comment/attachment inserts and attachment UPDATE/DELETE revoked (M167). **Storage-side read rule not re-verified after M167.** |
| 022 | Med | Any user could upload straight into the task-attachments store | F | **F** | Direct-upload policy removed. |
| 023 | Med | If live sign-up is enabled, a stranger could become an employee of the first organisation | NV | **NV** | Verified dynamically on the audit stack that a stranger's sign-up creates an active profile there; templates now disable sign-up; checker `scripts/check-auth-settings.mjs` fails when it is on. **Prod: read the live setting.** |
| 024 | Med | Saved mailbox password could be redirected to another server | F | **F** | Password needed again when host/user changes. |
| 025 | Med | Report Builder showed technician-only form fields to the requester | F | **F** | Hidden for requester-type viewers. |
| 026 | Med | A manager could edit administrators / reporting lines / groups | F | **F** | Who-may-change-whom guard extended. |
| 027 | Med | OEM template preview showed stored HTML uncleaned (stored XSS) | F | **F** | Preview built from clean editor HTML. |
| 028 | Med | Unauthenticated callers could flood the System Log | F | **F** | Trusted-address key, global cap, size check first; HTTP probe before/after. |
| 029 | Med | Paths ending in .png/.svg skipped the session check | F | **F** | Only root static files skip it. HTTP probe before/after. |
| 030 | Med | One secret (`CRON_SECRET`) was the fallback for many purposes and could go to Microsoft in a URL | O | **F** | `lib/secrets.ts`: one secret per purpose, fail closed (no cross-purpose fallback); Outlook subscription address carries no secret; `scripts/check-secrets.mjs`. Tests unit/secrets. **Prod: set the per-purpose secrets before release (temporary escape switch `ALLOW_SHARED_SECRET_FALLBACK=1` exists).** |
| 031 | Med | Spreadsheet preview trusted sizes written inside the file (zip bomb) | F | **F** | Real unpack with a hard limit. TU/xlsx-zip-bomb. |
| 032 | Med | Sign-in throttling per account only, in memory; spray possible | P | **F** | Failure-based throttling (successful sign-ins never use allowance), spray detection by address, `lib/rate-limit.ts`. Unit tests auth-throttling. **Prod: `TRUSTED_PROXY_HOPS` must be set so the real client address is known.** |
| 033 | Med | One-time approval code written in the e-mail subject (visible in logs) | F | **F** | Code only in body. |
| 034 | Med | Admin regex on stranger mail could hang the worker (ReDoS) | F | **F** | Length cap + nested-repeat refusal. |
| 035 | Med | Next.js buffers request bodies at 10 MB behind the proxy file, so 10–25 MB attachments may be cut | NV | **NV** | Configuration set (30 MB); **never tested with a real 20 MB upload** (Phase 4 item). |
| 036 | Med | A signed-in user can store any push-notification address via the data API; the server later posts to it | O | **O** | Phase 3 item not yet done (validate the address). |
| 037 | Low | DMARC pass for a different domain accepted; two From lines | F | **F** | Pass must match sender domain; two From headers = no sender. |
| 038 | Low | Login CSRF via /auth/confirm | F | **F** | Origin / Sec-Fetch-Site check (HTTP probe: 303 → 403). |
| 039 | Low | Deactivated person's session kept working | F | **F** | Inactive profile = signed out; password change ends other sessions. |
| 040 | Low | `?sampleTo=` could mail real approval links to any address | F | **F** | Company mail domain only. |
| 041 | Low | Forgot-password timing reveals known/unknown addresses; 3 resets/hour per employee | O | **F** | Same work and minimum time for both cases; global hourly cap. Unit tests auth-throttling. |
| 042 | Low | Webhook design weaknesses (Gmail one URL token, Outlook echoes validation token, no replay window, WhatsApp GET unthrottled) | O | **O** | Not yet done (Phase 3B). |
| 043 | Low | Parallel wrong guesses of approval code counted as one | F | **F** | Counted atomically. TB. |
| 044 | Low | Approval-link holder can request unlimited codes; limits in memory; page shows ticket before proof | O | **O** | Not yet done (Phase 3B). |
| 045 | Low | No auto-reply / loop protection | F | **F** | Outbound `Auto-Submitted`; inbound auto-replies skipped. |
| 046 | Low | Intake mail viewer's remote-image block incomplete; frame redirect | O | **O** | Not yet done (Phase 3B). |
| 047 | Low | Any user could add internal notes to intake threads | F | **F** | Reviewer roles only. |
| 048 | Low | Admin writes accept identifiers from another organisation | O | **O** | Not yet done (Phase 3C). Only matters if a second organisation is ever hosted. |
| 049 | Low | Two admin pages rely on layout guard only | O | **O** | Not yet done (Phase 3C). |
| 050 | Low | Mail-server address check bypass (127.1 etc.) | F | **F** | Stricter numeric-form check. |
| 051 | Low | Several exports not audited; heavy report loads not limited | O | **O** | Not yet done (Phase 3C). (Test-mail sending was rate-limited in 2C.) |
| 052 | Low | Admin reset/invite accept any e-mail address | O | **O** | Not yet done (Phase 3B). |
| 053 | Low | OEM contact addresses count as organisation addresses; manager can set any outside address | O | **O** | Not yet done (Phase 3B). |
| 054 | Low | "Duplicate request" created a ticket with the server key, skipping creation checks, copying priority | O | **F** | Now goes through the normal creation path (`createRequestCore`): service re-checked, form re-validated, priority/deadlines recomputed. v24 (failed before). Note: no screen currently calls this function. |
| 055 | Low | Re-classifying silently un-assigned; assignment rules differ by path | O | **F** | Assignee validation (1A); an "assigned" ticket that loses its owner returns to "open"; update conditioned on status. v24. |
| 056 | Low | Re-classification moves priority/deadlines with no reason or status guard | O | **P** | Refused on resolved/closed/cancelled tickets; old and new deadlines written to history. **A mandatory reason (needs screen change) is not built.** v24. |
| 057 | Low | Approver search lets anyone test which employee owns which e-mail | O | **F** | Staff only; e-mail matches only when typed in full. v21. |
| 058 | Low | Races: updates not conditioned on the status read | O | **F** | Re-classification, submit-for-approval and approval resolution are conditional on the status read; a decision on an already-decided approval is refused and not recorded; an approval cannot revive a ticket closed meanwhile. v24 (failed before). Form-data edits were already atomic. |
| 059 | Low | Raw database error text returned to the browser | F | **F** | `sanitizeError` now used in **87 more places** across admin and intake actions (real error still logged on the server). Behaviour change: duplicate-name errors now show a generic "That already exists" message. |
| 060 | Low | History named the requester/assignee for what a Business Rule did | O | **F** | Rule-driven changes are attributed to the system, with the rule named in the details. v23. |
| 061 | Low | Reset-password needs no current password; display name unrestricted | O | **O** | Partly reduced (sessions end after a password change). Not closed. |
| 062 | Low | Home-dashboard function trusted caller-supplied role flags and counted approvals across organisations | O | **F** | M169: the public function derives the role itself (flags can only switch things off), counts only own-organisation approvals; the old function is internal and unreachable. v24. |
| 063 | Low | Requesters could read the full activity log (rule names, copied e-mail addresses, approver names) through the data API | O | **F** | M169: log readable by staff only through the data API; requesters get a server-built view with an allow-list of fields (`lib/activity-public.ts`). v24 (failed before). **Screen not yet re-checked in a browser.** |
| 064 | Low | Excess privileges: TRUNCATE/TRIGGER/REFERENCES; anon write on 18 tables; new functions public | P | **F** | M164 (privileges), M165 (anon has no table rights, default privileges), **M169 (anonymous role loses EXECUTE on all 56 of the application's own functions; functions already locked stay locked; new functions are not public by default; exact rollback list kept)**. v24. |
| 065 | Low | Uploads: no malware scan, no quota/rate limit, macro-capable Office formats allowed | O | **O** | Not yet done (Phase 3C). Malware scanning needs a decision on a scanner. |
| 066 | Low (info) | Public health route runs a service-key query for any caller; client addresses not recorded while `TRUSTED_PROXY_HOPS` unset | O | **O** | Not yet done (Phase 3C; the setting is a production step). |
| 067 | Low (info) | A path-check pattern lost its backslash; `X-Powered-By` header | F | **F** | Fixed. |
| 068 | Low | Store Master spreadsheet parsed (5 MB) in the web process, trusting declared size | O | **O** | Not yet done (Phase 3C). |

**Counting check** (computed from the table above): Fixed 46 = 29 earlier + 17 new (001, 003, 006, 015, 016, 018, 030, 032, 041, 054, 055, 057, 058, 060, 062, 063, 064); Partially Fixed 3 (019, 021, 056); Requires Decision 5 (002, 007, 008, 009, 010); Not Verified 2 (023, 035); Open 14 (DEP-02, 036, 042, 044, 046, 048, 049, 051, 052, 053, 061, 065, 066, 068). 46 + 3 + 5 + 2 + 14 = 70.

By severity now (computed from the table): **Critical** 1 of 1 Fixed. **High** 3: 2 Fixed (001, 003), 1 Decision (002). **Medium** 34: 24 Fixed, 2 Partially Fixed, 4 Decision, 2 Not Verified, 2 Open. **Low** 32: 19 Fixed, 1 Partially Fixed, 12 Open. The earlier first-audit findings (D-xxx) are tracked in `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md`; the 15 Oct reconciliation (75 earlier findings: 53 verified fixed, 9 still vulnerable, 7 needing a decision) is in `01-BASELINE/03-EXISTING-AUDIT-RECONCILIATION.md`.

---

## 6. All changes made so far (what was there, and what it does now)

### 6.1 Branches and commits (all LOCAL, none pushed)

| Branch | Content | Commits |
|---|---|---|
| `main` / `origin/main` | Production source (`717e5c6`) | — |
| `release/p0-framework-next-16.3.8` | **Framework-only release candidate**: Next.js 16.2.9 → 16.3.8, eslint-config-next, `npm audit fix`, one lint comment. No migration, no other change. Verified with migration 164 rolled back: default suite 1,741 pass, remediation 182 pass. | `bb38cbf` |
| `security/vapt-iso27001-soc2-local` | VAPT fixes of 15 Oct (migration 164, ~56 files) + assessment reports | `35922ad`, `7ee19e0`, `b6e5a79` |
| `security/remediation-phase2-local` (**current**) | Contains the VAPT branch plus the remediation program: 11 commits above `main`, 144 files (≈ +8,200 / −980 lines incl. tests and reports) | `6037221` (1A), `5035918` (precise tests), `0fe77a1` (1B/1C), `0afcaf9` (2A), `855a1b2` (2B), `9cabcdd` (2C), `ce64306` (2B completion), `bcfe76d` (3A) |

### 6.2 Database migrations (all with rollbacks in `supabase/rollback/`; applied only to the disposable audit database)

| # | Name | What it does | Before → After |
|---|---|---|---|
| 164 | `vapt_security_hardening` | Guard trigger refusing hand-made priority/SLA changes; no direct ticket INSERT; System Log watches SLA changes; internal-note file flag + org-aware file read; task-attachments direct upload removed; mobile numbers own/staff; must-change flag locked; config tables admin-only; TRUNCATE/TRIGGER/REFERENCES revoked | Technicians could quietly change priority/deadlines → refused by the database |
| 165 | `server_only_writes` | Signed-in users lose INSERT/UPDATE/DELETE/TRUNCATE on `requests` and ~45 tables whose rules live in server code (approvals, teams, org structure, settings, rules, logs …); `anon` loses all table and sequence rights; default privileges | Rules enforced only on screens → now the database refuses the same write from a direct call |
| 166 | `approvals_privacy` | `approval_workflow_steps.added_by`; workflows readable only by org staff or people with a visible approval | Every employee could read approval routes → no longer |
| 167 | `ownership_and_privacy` | Project members/milestones/updates need `can_view_project`; task insert/update same-org + visible; task-file writes revoked; comment/attachment insert org checks; alert/escalation/etc. lists staff-only; team membership own-or-staff | Role-only rules → ownership rules |
| 168 | `must_change_password_enforced` | `current_org_id()` / `current_user_role()` return nothing for a user who must still change their password | A flagged user kept full access until the page redirect → the database itself gives no access |
| 169 | `low_findings_db` | Activity log staff-only via data API; home-dashboard wrapper that derives roles; anonymous role loses EXECUTE on application functions (exact list stored for rollback) | see 062, 063, 064 above |

Rehearsals done on the audit database: 164 applied → rolled back → re-applied; 169 applied → rolled back → re-applied (the re-applied state is byte-for-byte the same set of function privileges). 165–168 were applied with before/after tests; **a complete forward / repeat / rollback / re-apply rehearsal of 165–168 as a chain is still on the to-do list (Phase 4).**

### 6.3 Application code — by theme

| Theme | Files (examples) | Change |
|---|---|---|
| Server owns ticket writes | `lib/actions/requests.ts`, `lib/requests/status-change.ts`, `lib/actions/intake/work.ts` | Status, assignee, source, response time written by the server with the admin client **after** explicit checks; remark written together with the move (never half-done) |
| Approvals | `lib/approvals/separation.ts` (new), `lib/actions/approvals.ts`, `decision.ts` | Requester and sender cannot approve on any route; approver search staff-only and exact e-mail; delegation picker checks sign-in; decision on a decided approval refused |
| Passwords and sign-in | `lib/auth/one-time-password.ts`, `lib/actions/admin/users.ts`, `lib/actions/auth.ts`, `lib/rate-limit.ts`, `lib/queries/profiles.ts`, `components/admin/BulkImportUsersDialog.tsx` | No default password; random one-time passwords or invitations; failure-based throttling; spray detection; forgot-password timing floor and cap; flagged user blocked by server and database |
| Settings checker | `lib/auth/settings-check.ts`, `scripts/check-auth-settings.mjs`, `supabase/config.toml`, `deploy/windows/config/auth.env.example` | Sign-up off in templates; script fails if live sign-up is on or password minimum too low |
| Secrets | `lib/secrets.ts`, `scripts/check-secrets.mjs`, webhook/cron/OAuth/CSAT/approval-link code, `scripts/log-shipper.mjs` | One secret per purpose, fail closed |
| Permission matrix | `lib/permissions/matrix.ts`, `policies.ts`, `lib/actions/admin/policies.ts`, `components/admin/PolicySwitchesCard.tsx`, settings page | Who may change what in one table; 4 owner-controlled switches stored as `policy.*` in `app_settings`, each defaulting to today's behaviour |
| Business Rules | `lib/rules/actions.ts`, `lib/constants/request-transitions.ts` | Rule can only make allowed status moves; history shows "system" |
| Tickets (Low batch) | `lib/actions/requests.ts` | Duplicate via creation path; re-classification guards; conditional updates |
| Activity log | `lib/queries/requests.ts`, `lib/activity-public.ts` | Requester history served by the server with an allow-list |
| Error messages | 20 files in `lib/actions/**` | 87 raw error messages replaced by `sanitizeError` |
| Front gate | `proxy.ts`, `next.config.ts` | Static-path bypass fixed; no `X-Powered-By`; upload limit 30 MB; Secure cookies + HSTS when https |

### 6.4 Behaviour changes a business owner may notice

1. Priority can never be set by hand (earlier decision, in production already) — and now a database guard enforces it too.
2. Bulk-imported users get one-time passwords or an invitation instead of a shared password; they must change it at first sign-in.
3. Requesters see their ticket history as before, but rule names and copied e-mail addresses no longer appear in what the browser receives.
4. A Business Rule can no longer move a ticket through a status change nobody could make (e.g. cancelled → in progress, in progress → closed).
5. Re-classifying a resolved/closed/cancelled ticket is refused.
6. Error messages in admin screens are more generic (the real error is in the server log).
7. If an admin sets the "who may change what" switches to a narrower choice, managers lose the corresponding rights. **All defaults keep today's behaviour.**

---

## 7. Test evidence

### 7.1 Latest results (isolated stack, after the 21-point gate passed)

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | 0 errors |
| Lint | 0 errors |
| Default suite (unit + integration) | **238 files passed, 4 skipped; 1,789 tests passed, 18 skipped, 0 failed** |
| Remediation suite (`vitest.remediation.config.ts`) | **33 files, 184 / 184 passed** |
| VAPT suite (`vitest.vapt.config.ts`) | **10 files, 68 / 68 passed** |
| Isolation gate | 21 / 21 before every dynamic run (one failure on 16 Oct, see section 3) |
| Rollback rehearsals | M164 and M169 applied → rolled back → re-applied, results compared |

### 7.2 Before/after proof for the new fixes (tests that failed on the old behaviour)

| Fix | Result on the old code | Result on the new code |
|---|---|---|
| Approval separation (016) | 5 of 6 attacks succeeded | all refused |
| Projects/tasks/files ownership (018) | 7 of 8 succeeded | all refused |
| Must-change-password enforcement (168) | a flagged user read 5 requests | none |
| Duplicate request, finished-ticket re-classification, decision after ticket closed (054/056/058) | 4 tests failed with the old code (code temporarily reverted) | pass |
| Dashboard flags, activity log, anonymous functions (062/063/064) | 3 tests failed with migration 169 rolled back | pass |

### 7.3 Old tests that were changed (not weakened; nothing deleted to turn a result green)

`tests/integration/approval-email-link`, `tests/remediation/102, 110, 118, 20-db-critical, 40-db-high, 71, 92`, `tests/setup/fixtures-d03.ts`, `tests/unit/approval-link, csp-report, header-trust, oauth-state`. Reasons: old tests encoded the old rules (users inserting tickets directly; requester clearing own reset flag; approver lists including the requester; a shared secret fallback; approval code in the subject). Each now asserts the new rule, and the precise denial code (permission error 42501), not "any error". 13 existing and 19 new test files in total changed or added since `main`.

### 7.4 Problems that the tests caught in my own work (honesty list)

- First draft of migration 169 granted EXECUTE to signed-in users on **every** function, re-opening internal ones (ticket-number burning, organisation delete, credentials, log retention). The regression run showed 6 failures; the migration was corrected to preserve existing access exactly (stored list + comparison before/after) before it was committed.
- My new permission-matrix test removed an existing company setting during its cleanup, which broke an older test; fixed by restoring the original value.
- A bulk text replacement for error messages also changed one audit-log entry that must keep the real error; caught by an older test and reverted.
- 2B's route-file changes were missed in the 2B commit and committed separately (`ce64306`); they were part of every regression run.

---

## 8. ISO/IEC 27001:2022 and SOC 2 (readiness only)

**What this is:** an internal readiness assessment. **What it is not:** an audit, certification or attestation. The company must supply organisational evidence (class C) before anything can be called operating.

### 8.1 ISO/IEC 27001:2022
- Management-system clauses 4.1–10.2 (25 rows): 15 not implemented, 6 not verified, 3 designed in part, 1 mixed; **0 operating with evidence**.
- Annex A: 93 controls (84 applicable to the CKDesk scope, 9 organisation-level): 16 implemented, 7 tested (local copy only), 14 designed only, 10 not implemented, **46 not verified** (all people and physical controls need organisational evidence), **0 operating with evidence**.
- Policies: 20 expected; draft outlines written, none approved. Risks: 49 assessed, 28 above the treatment threshold with treatment plans drafted. Statement of Applicability: draft.
- Biggest gaps: no approved scope/policy/risk method, no named roles, no internal audit, no management review, no access reviews, **no tested backup restore**, no off-server backup record, no CI, single-person change control, plain HTTP.
- Verdict recorded: **GAPS REMAIN**. A certification body would very likely not recommend certification today.

### 8.2 SOC 2
- Proposed scope: Security and Confidentiality in; Availability only if management states a commitment; Processing Integrity and Privacy out for now (reasoned).
- **Type I (design):** 38 criteria assessed: 0 suitably designed, 33 design gap, 5 not verifiable; 36 gaps recorded (1 critical, 17 high, 16 medium, 1 low, 1 info).
- **Type II (operation):** 131 evidence items would be needed: 3 exist, 24 partly, 59 not collected, 45 cannot exist until controls have run for a period (a minimum of about 3 months is typical, to be agreed with an auditor). 28 known exceptions recorded. 26 of 33 control areas have no identifiable owner.
- Verdicts recorded: **Type I — GAPS REMAIN; Type II — GAPS REMAIN.** No attestation claimed.

### 8.3 What the technical fixes added for these frameworks
Access control (server-only writes, ownership, separation of duties), authentication hardening (no shared password, throttling), secrets separation, logging (System Log with hash chain watches SLA changes, policy changes are audited), least privilege (grants, function EXECUTE), input and error handling, dependency patching. These are *design/implementation* evidence (classes A/B), not operating evidence.

### 8.4 What management must supply (examples)
Approved information-security, access-control, backup/recovery, incident-response and change-management policies; named control owners; a monthly access review; change log with approvals; a **restore test of the production backup** (best single piece of evidence to create this week); vulnerability scan + fix records; System Log review notes.

---

## 9. Performance

- **13 Oct audit:** manager's ticket list at 500,000 tickets: 28 s → 1.3 ms after the first remediation (index/visibility work, migrations 156–159).
- **15 Oct (migration 164, 3,000 synthetic tickets, 40 timed calls, P50 before→after):** manager list 4.6 → 4.7 ms, count 3.6 → 3.6, technician own group 4.9 → 4.9, requester own 4.9 → 4.8, attachment rows 2.6 → 2.7, title search 2.5 → 2.0. No measurable regression.
- **Not re-run on the final code:** 100k / 500k tickets with P50/P95/P99, error rate, database CPU/memory, locks, row-security cost, and **System Log hash-chain contention** (every audited ticket change takes one shared lock; the log now records SLA due-date and pause changes too). This is a Phase 5 task and a known risk.
- Migrations 165–169 (more policies, more trigger checks, the activity-log read path through the server, dashboard wrapper) have **not** been measured for performance. The dashboard wrapper adds one extra query and the activity read for requesters now runs server-side.

---

## 10. What is pending (as of 16 Oct 2026)

### 10.1 Open findings (14) — the plan
- **Phase 3B (auth/approvals/mail):** 042 webhook design, 044 approval-link code limits (persist counters, don't cancel an unexpired code), 046 mail-viewer remote content, 052 admin reset/invite to organisation addresses only, 053 OEM contact approved domains, 061 account hygiene, 036 push-notification address validation.
- **Phase 3C (admin/files/exports):** 048 org checks on admin ids, 049 explicit role check on two admin pages, 051 audit every export + per-user limit, 065 upload quota/rate limit and a malware-scan decision, 066 health route cache + `TRUSTED_PROXY_HOPS`, 068 Store Master spreadsheet limits.
- DEP-02 (`uuid` via `exceljs`): accept formally or replace the library.

### 10.2 Partially fixed (3)
019 general staff list readability; 021 storage read rule re-check; 056 mandatory reason on re-classification (needs a screen change).

### 10.3 Management decisions needed (5 + related)
1. **HTTPS** — certificate + reverse proxy, VPN-only, or later (002). Code is ready.
2. **Managers' rights** — company-wide settings, Business Rules, approval workflow steps (007, 008, 009), reviewer's priority choice on e-mail tickets (010). Switches exist; defaults = today. Choose the end state.
3. **Onboarding mode** — random one-time passwords vs invitations (003); both implemented.
4. **HR/Finance confidentiality tier** (earlier audit D-005): managers/admins read every ticket in the organisation. Only preparation exists; no behaviour was changed.
5. **Formal acceptance** of the `uuid` advisory, or replace `exceljs`.
6. Owners for the 33 control areas; approval of the core policies.

### 10.4 Verification not yet done (Phase 4)
Full browser UAT of the *final* code for every role (requester, technician, manager, admin, platform owner, approver); the new Platform Settings card and the requester History tab have **not** been looked at in a browser; direct HTTP/API tests beyond those listed; attachment isolation requester A vs B; double-submit/concurrency on the portal; uploads of 10/15/20/25 MB; multi-organisation isolation with ≥ 2 synthetic organisations; migration chain rehearsal 165–169; mail/WhatsApp mock tests for replay/spoofing/idempotency.

### 10.5 Not yet produced
The 12 deliverables of the remediation program (`security-assessment-2026-10/07-FINAL-REMEDIATION/01 … 12`: executive summary, 70-row closure matrix, changelog, retest results, UAT results, performance, ISO/SOC 2 readiness, open decisions, production release plan, rollback plan, final release gate). **This report replaces drafts of 01–04, 09–11 only partly.** Phases 5–7 (scanners, performance, ISO/SOC 2 updates) are not done.

### 10.6 Production prerequisites (nothing is done on production)
1. Release Next.js 16.3.8 first, alone (branch `release/p0-framework-next-16.3.8`). No database change.
2. **Set the per-purpose secrets** (`APPROVAL_LINK_SECRET`, `CSAT_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN`, cron / worker / log-ingest secrets, etc.; `scripts/check-secrets.mjs` lists what is missing). **Without them the cron jobs, webhooks, approval and rating links stop working**, because the old fallback to `CRON_SECRET` is removed. A temporary switch `ALLOW_SHARED_SECRET_FALLBACK=1` exists for a controlled transition.
3. Set `TRUSTED_PROXY_HOPS`. Confirm on the live login service: sign-up disabled, minimum password length ≥ 8 (`scripts/check-auth-settings.mjs`).
4. Check whether any live account still has the old shared import password and force a reset (do not test by signing in).
5. Back up `ckdesk` and do a **restore test**. Read the live migration table to confirm 156–163 are applied.
6. **Order: application code first (or together), then migrations 164 → 169 in order, then restart PostgREST** (schema cache), then smoke tests. The new code works with the old database; the old code does **not** work with the new migrations (it writes tickets directly; 168 gives a flagged user no access; 169 hides the activity log from requesters' data-API reads). Memory rule of the project: after any migration on the database server, restart the PostgREST service on the app server.
7. Rollback: application — rename the saved `standalone-bak-…` folder back; database — run the matching file in `supabase/rollback/` (newest first: 169 → 164). An application rollback never reverses a database change.

---

## 11. Suggested route to git and production (when you decide)

1. Review this report with a second reviewer. Decide the management questions in 10.3.
2. **Do not push the working folder as it is.** It contains many untracked files: audit reports (useful, but large), design mock-ups, spreadsheets (`Store Master - READY TO UPLOAD.xlsx`), logs, and `security-assessment-2026-10/02-VAPT/work/uat-users.json` (synthetic users, but check it for credentials before committing anything). Decide what belongs in the repository; also `.claude/settings.local.json` and `perf-run.json` show as modified.
3. Push in two steps: (a) the framework-only branch `release/p0-framework-next-16.3.8` → merge to `main` → deploy alone; (b) the remediation branch (after Phases 3B–5 and the production prerequisites) → separate approval → deploy using the order in 10.6.
4. Project rule: "commit and push to git and main" means commit, push `origin main`, then build and deploy to 10.0.1.98 — only on your explicit OK each time. Test only locally; never experiment on production; never ask for or repeat passwords.

---

## 12. Where I could be wrong — please challenge these

1. **The "Now" statuses in section 5 are my own judgement.** In particular check 001 (is every ticket column really server-only?), 006 (all ~20 config tables?), 018 (v22 covers 8 attack cases, not every policy), 032 (throttling depends on the real client address), 058 (only listed update sites were made conditional), 062 (a task assigned to a user can still carry a ticket number the user cannot open, if the link existed before M167).
2. **Browser behaviour is unverified** for the new Platform Settings card, the requester History tab and the changed admin error messages.
3. **Mocks:** server actions are tested with a mocked session client against the real isolated database and real row security; this is stronger than a unit mock, but it is not a browser test. E-mail and WhatsApp are mocks only.
4. **Single organisation:** the audit database has one organisation; cross-organisation findings (021, 048) rest on policy text and partial tests.
5. **Performance:** only 3,000 tickets on the final-ish code; nothing at 100k/500k after migrations 165–169.
6. **Security scanners did not run** (see section 0), so classes of issues those tools find (dependency licence/CVE breadth, DAST) are covered only by `npm audit` and manual review.
7. **Grants (M169):** it keeps existing signed-in access exactly (verified by comparing function privileges before and after) but I cannot see production's current grants. Compare on the real database before applying.
8. **Rules that now refuse things silently:** a Business Rule that tries a forbidden status move is logged as a warning and skipped. Existing production rules may rely on such moves; list them before release.
9. **Statements about production** (what runs, which settings are on) come from the repository, earlier deploy notes and the project documentation; nothing was read from production.
10. **Compliance:** ISO/SOC 2 numbers describe *readiness drafts*. They say nothing about the company's real controls until the owners provide evidence.

---

## 13. Where everything is (file index)

**In the repository root**
- `CITYKART-DESK-FULL-AUDIT-REPORT-2026-10-13.md` — the complete first audit (15 parts, findings SEC-01…57, CQ-01…37).
- `CITYKART-DESK-CURRENT-CODE-FULL-LOCAL-AUDIT*.md`, `…-DEFECT-AND-FIX-REGISTER*.md`, `…-LOCAL-DEPLOYMENT-CANDIDATE*.md`, `…-ROUTE-AND-LAYOUT-COVERAGE*.md` — earlier audit working documents.
- `CITYKART-DESK-UNIVERSAL-REQUEST-FORM-*` and other mock-ups — unrelated design work.
- `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` — production topology, deploy and rollback steps. `docs/CKDESK-BOT-*.md` — deferred assistant plans.

**`audit-2026-10/`** — first audit and first remediation (`reports/`, `remediation/`, `guard/` = isolation gate and egress guard, `seed/`, `evidence/`, `AUDIT-STATE.md`).

**`security-assessment-2026-10/`**
- `01-BASELINE/` — baseline, isolation certification, reconciliation with the earlier audit, control evidence inventory.
- `02-VAPT/` — attack surface, automated assessment, manual penetration tests, authentication/RBAC/RLS, API and workflow, storage/integration security, **`VAPT-MASTER-REGISTER.md` (70 findings, full detail)**, `HTTP-PROBE-CAPTURES.md`.
- `03-ISO27001/` — scope, clause gap, Annex A matrix, risk assessment and treatment, policy register, SoA draft, internal audit and management review readiness.
- `04-SOC2/` — boundary, system description, TSC applicability, Type I design matrix and gap assessment, Type II operation plan, evidence register/calendar, exception register, owner matrix.
- `05-REMEDIATION/` — status table, change log (VAPT fixes), regression, performance, remaining risks.
- `06-MANAGEMENT/` — executive summary, heat-map, compliance dashboard, action plan, release prerequisites, final assessment, combined register.
- `07-FINAL-REMEDIATION/` — logs of every remediation phase (`p1a … p3a`, `rc-framework-*`), `tools/write-inventory.cjs`.
- `VAPT-ALL-TEST-REPORTS-AND-FIXES.md` — the earlier single-file compilation of the 15 Oct reports (about 78 KB).

**Code and tests**
- Migrations `supabase/migrations/…0164 → 0169`, rollbacks `supabase/rollback/164 → 169`.
- Tests: `tests/vapt/*` (exploit and remediation tests 10–90), `tests/remediation/*`, `tests/unit/*` (160 files), `tests/integration/*`; configs `vitest.config.ts`, `vitest.remediation.config.ts`, `vitest.vapt.config.ts`.
- Scripts: `scripts/check-secrets.mjs`, `scripts/check-auth-settings.mjs`.
- How to re-run (only through the gate): `powershell -File audit-2026-10\guard\run.ps1 npx vitest run [--config vitest.remediation.config.ts | vitest.vapt.config.ts]`.

---

## 14. Questions for the reviewing AI model

1. Do the "Fixed" claims in section 5 match what the code and tests actually prove? Pick five at random and trace them.
2. Is the application-first, migrations-second release order in 10.6 safe? Is there any step where users lose access?
3. Are there bypasses left for server-only writes (a server action that writes with a user session on a table that M165 locked)? Search for `.from('<table>').insert/update/delete` with the user's client in `lib/actions/**` and `app/api/**`.
4. Is the allow-list in `lib/activity-public.ts` too tight (breaks the History tab) or too loose?
5. Which of the 14 open findings should come first, and which can be accepted with a documented reason?
6. Is anything in the ISO/SOC 2 readiness documents overstated?
7. What would you test next that this report has not covered?

*End of report.*
