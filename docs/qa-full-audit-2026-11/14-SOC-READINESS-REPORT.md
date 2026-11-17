# 14 — SOC Readiness Report

> This is a **readiness review, not a certification.** No claim of ISO 27001, SOC 2 or any other compliance is made. Everything ran locally on the audit stack with made-up accounts.

## Plain summary
Citykart Desk already keeps a **tamper-evident, append-only security log** that cannot be edited or deleted, is readable only by administrators, holds no passwords or tokens, and records sign-ins, failed sign-ins, lock-outs and exports with the person's name. **Three gaps stop a SOC from seeing everything it would want:** the caller's network address is never recorded (setting not applied), people probing admin pages leave no trace, and failed machine-to-machine calls (bad webhook signature, wrong scheduler secret, wrong data-API token) leave no trace.

## Log inventory (`soc/soc-checks.mjs`, 13/13 not failing, 4 NOTE; evidence `evidence/soc/`)
| Log | Where | What it records | Notes |
|---|---|---|---|
| Security / audit / error log | table `system_log` (733k rows in the audit copy), screen Admin > Logs | who, what, before/after, outcome, severity, request id, path, method, IP, user agent | append-only (update/delete refused even for the service key, SOC04); hash chain `prev_hash`/`row_hash`; archive function `system_log_archive_old` |
| Sign-in events | `system_log` actions `auth.login_succeeded/failed/rate_limited/blocked_deactivated/spray_suspected`, `auth.logout`, `auth.password_changed/reset_requested` | person, outcome | typed login names are scrubbed to a fingerprint unless shaped like an e-mail |
| Row-change audit | database trigger on ~40 tables (`requests.update`, `profiles.update`, `approvals.*`, `app_settings.*`, `business_rules.*` …) | before and after values | the service key's changes often carry no named person (SOC-G4) |
| Exports | `data.exported.master_ac` etc. | who exported what, filters, row count, never the contents | rate-limited per person per hour |
| Ticket history | `request_activity` | status, assignment, priority, comments, approvals | per ticket |
| Browser events | `app_event_log` | page views, clicks, JavaScript errors | no secrets |
| Admin trails | `admin_audit_log`, `owner_audit_log`, `intake_audit_log`, `pms_ticket_log`, `conversation_events`, `sla_escalation_events`, `business_rule_events` | domain-specific | |
| Application console log | JSON lines (logger) | errors, startup warnings | |
| Mail log | event log "system" entries per send attempt | | |

## Quality checks
| ID | Check | Result |
|---|---|---|
| SOC01 | Inventory and completeness | **PASS**. App-written sign-in and export entries (n=669): actor present 88 %, outcome 100 %, request id 74 %, **address 0 %**. (The bulk of the 733k rows are database-trigger rows from seeding and load tests, so whole-table percentages are not representative.) |
| SOC02 | Secrets in logs | **PASS** 733,821 entries scanned for passwords, bearer tokens, JWTs, API keys, cookies, private keys: none |
| SOC03 | Tamper evidence | **PASS** chain intact; changing one entry as the database owner is reported as 1 broken link; restored after rollback. Note: the verify function's default window is the first 500,000 records; the Admin screen pages through the whole chain, so use that (not the bare function) in an investigation (SOC-G6, P4). |
| SOC04 | Append-only | **PASS** update and delete refused for an administrator and for the service key |
| SOC05 | Who can read | **PASS** administrator yes; store requester, technician, vendor no |
| SOC12 | Retention/archive | **PASS** archive function and table exist; no explicit retention setting (defaults apply) |

## Local detection replays
| ID | Scenario replayed | Detected? | Result |
|---|---|---|---|
| SOC06 | 6 failed sign-ins in a row | **Yes**: `auth.login_failed` x6 and `auth.login_rate_limited`, request id present, **address missing** | PASS with gap |
| SOC07 | successful sign-in and sign-out | **Yes**, with the person | PASS |
| SOC08 | a store user probing 5 admin pages/APIs | **No entry** (pages just redirect) | **NOTE — GAP SOC-G1** |
| SOC09 | role/profile change by an administrator | direct change through the data API is refused (good); changes by the application are recorded by trigger with before/after, but only 15 of 18,532 profile-change entries name a person | **NOTE — SOC-G4** |
| SOC10 | export of the AC master | **Yes** `data.exported.master_ac`, with the person | PASS |
| SOC11 | webhook with a bad signature, scheduler with a wrong secret, data API with a wrong token | **No entry** | **NOTE — GAP SOC-G2** |
| SOC13 | alert delivery to an operator | alert route exists; delivery URL is blank in the audit setup (nothing may leave this PC) | **NOT RUN** |
CKOneAI abuse (rate limit, forged headers) was checked in UAT F and is audited as metadata only.

## Gaps and recommendations
| ID | Sev | Gap | Recommendation |
|---|---|---|---|
| SOC-G1 | P2 | Forbidden-page and forbidden-API attempts by signed-in users are not logged | log a `security/denied` entry in the shared access guard |
| SOC-G2 | P2 | Rejected machine calls (webhooks, scheduler secret, data API token) are not logged | log with source route and a masked reason; rate-limit the log write |
| SOC-G3 | P2 | The caller's IP is never recorded in the audit copy (`TRUSTED_PROXY_HOPS` not set); per-address limits are also off | confirm the setting on the live server (not verified) |
| SOC-G4 | P3 | Row-change entries made through the service key rarely name the acting person | pass the actor through the server actions that change people, roles, settings |
| SOC-G5 | P3 | Alert delivery path not exercised | test in a staging environment with a test webhook |
| SOC-G6 | P4 | `system_log_verify_chain()` default checks only the first 500,000 entries | document; schedule a full paged verification job |
| SOC-G7 | P3 | Log retention is "defaults apply", not an explicit documented period | state the period (for example 1 year hot + archive) |

## Tabletop drills (paper exercises, **not executed live**)
| Drill | Question | What exists today | Gap |
|---|---|---|---|
| T1 Stolen technician password | How soon is it noticed, and what can the account do? | sign-in success/failure log with person, lock-out, no unusual-location alert (no IP) | add IP (SOC-G3) and an "unusual sign-in" rule |
| T2 Insider downloads many tickets | Who sees it? | export entries with person; per-hour export rate limit | alert when a person exports more than N rows/day |
| T3 Vendor tries to read another vendor's tickets | Is it blocked and visible? | blocked (S12/R03); the attempt itself is not logged | SOC-G1 |
| T4 Mail/SMTP password leaked | Rotation path? | secrets are in the server env file/vault; no secret in logs | document rotation steps and test them |
| T5 Server or NAS ransomware | Recovery? | backups and restore steps documented in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md`; **restore drill not performed in this audit** | schedule a restore drill |
| T6 Scheduler/webhook secret guessed | Detection? | none (SOC-G2) | SOC-G2 |
