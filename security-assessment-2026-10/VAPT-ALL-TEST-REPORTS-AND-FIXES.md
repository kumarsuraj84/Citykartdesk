# CKDesk VAPT — all test reports and fixes in one file

Date: 2026-10-15/16 · Branch `security/vapt-iso27001-soc2-local` (commits 35922ad, 7ee19e0, b6e5a79) · **LOCAL only: nothing is pushed, migrated or deployed; production was not touched.**

This file combines the main test and fix reports. The full 70-row findings table (`02-VAPT/VAPT-MASTER-REGISTER.md`, 132 KB), the ISO 27001 / SOC 2 documents and the raw test logs stay in their own files in this folder.

## Contents
1. Executive summary
2. Regression and retest results (exploit before / after)
3. HTTP probe captures
4. Manual penetration testing log
5. Fixes: change log
6. Status of every finding (fixed / open / decision)
7. Performance
8. Remaining technical risks
9. Release prerequisites
10. Test files and how to run them


---

# PART 1. EXECUTIVE SUMMARY

_Source file: `06-MANAGEMENT/01-EXECUTIVE-SUMMARY.md`_

# 06 / 01 — Executive summary (plain language)

Date 2026-10-15 · Status: DRAFT for management review — internal assessment, **not** an audit report, certification or attestation · Production was not touched. Nothing is pushed, merged, migrated or deployed.

## The short version
1. **One thing is urgent and affects the live system today:** production runs a version of the web framework (Next.js 16.2.9) with published critical security flaws, including one that can let an outsider run code on a **Windows** server (rated 9.0 out of 10). Our server is Windows and reachable from the internet. The fixed version is already in the local code. It should be released first, on its own. (Not exploited or tested against production; rated "hard to pull off" by the publisher, but critical.)
2. We found **70 distinct weaknesses** in total. In the local copy we fixed **29** and proved most of those fixes with a real attack test (the attack worked before, is refused after). **41** are not fully closed: 6 wait for your decision, 6 are partly closed, 27 are open (21 of those are Low), and 2 could not be verified from here.
3. The most important weaknesses were not "outsiders breaking in" but **rules that only existed on the screens**: a technician or manager could still change a ticket's priority and push its deadline a year ahead by talking to the database directly; any employee could create a ticket straight in the database with a forged priority; the start of private internal notes was sent to people who must not read them; a file attached to a private note could be downloaded by the requester; every employee could read every colleague's mobile number; any employee could write on someone else's ticket by e-mail with a guessed ticket number. All of these are fixed locally and tested.
4. **Still open and needs you:** the site runs on plain HTTP (passwords and login cookies are readable on the network), and bulk-imported users start with a shared default password. These are decisions about how the company runs the system, not only code.
5. **Nothing broke.** All existing test suites pass on the final local code (1,760 + 182 + 16 tests, 0 failed; type check clean; lint 0 errors). Speed is unchanged.
6. For ISO 27001 and SOC 2 the honest answer is: the **technology is in decent shape; the management system around it is mostly missing**. No approved policies, no owners, no access reviews, no restore test, no recorded management review exist yet, so nothing can be shown as "operating" yet. We drafted what can be drafted; we did not invent any record.

## What we did
- Read the whole application and the earlier audit (75 earlier findings re-checked against today's code: 53 verified fixed, 9 still vulnerable, 7 need a decision).
- Built an isolated, disposable test copy (fake users, fake tickets, no e-mail, no WhatsApp, no route to production), certified it with a 21-point check, and ran every attack there.
- Five independent code reviews + our own attack tests + dependency and secret checks. Six scanner tools you named were **not installed** here, so they were replaced by manual checks; we did not pretend otherwise.
- Fixed confirmed problems in LOCAL only, added tests, re-ran everything.
- Drafted the ISO 27001 and SOC 2 readiness documents from facts in the repository.

## Numbers (VAPT)
| Severity | Found | Fixed locally | Not fully closed |
|---|---:|---:|---:|
| Critical | 1 | 1 | 0 |
| High | 3 | 0 | 3 (1 partly closed, 2 need your decision) |
| Medium | 34 | 18 | 16 |
| Low | 32 | 10 | 22 |
| **Total** | **70** | **29** | **41** (2 of them not verifiable from here) |
"Fixed" means fixed **in the local copy** and proven on the test copy; production has none of it until you approve a release.

## ISO 27001 and SOC 2 in one paragraph each
- **ISO 27001 (internal readiness):** of the 93 Annex A controls, 14 are designed, 16 implemented, 7 tested (on the local copy), 10 not implemented, 46 not verified (people and physical controls need organisational evidence), **0 operating with evidence**. Of the 25 management-system clauses, none is operating; most are not implemented. A certification body would very likely not recommend certification today.
- **SOC 2 (internal readiness):** Type I (design): of 38 criteria, 0 are shown as suitably designed, 33 have a design gap, 5 are not verifiable from the repository. Type II (operation): 131 pieces of evidence would be needed; 3 exist in the repository, 24 partly, 59 are not collected, 45 cannot exist until controls have run for a period. 26 of 33 control areas have no identifiable owner. No attestation is claimed; only an independent CPA firm can issue one.

## What I need from you (decisions)
HTTPS (yes / VPN-only / later), the default-password policy, whether managers may write Business Rules and approval steps, who owns global settings, whether HR/Finance tickets need a confidentiality tier, owners for the control areas, and approval to release the framework upgrade first. Details: `04-ACTION-PLAN.md`, `05-RELEASE-PREREQUISITES.md`.

## Is the local build ready for your review?
Yes for **security review**: it passes all local checks and the weaknesses we could test are fixed or listed. It is **not** a certification of production, and not ready to release without the prerequisites in `05-RELEASE-PREREQUISITES.md` (a database migration, configuration checks, a restore-tested backup).

---

# PART 2. REGRESSION AND RETEST RESULTS

_Source file: `05-REMEDIATION/02-REGRESSION-AND-RETEST-RESULTS.md`_

# 05 / 02 — Regression and retest results (actual runs, final local code)

Environment: disposable audit stack only, through `audit-2026-10/guard/run.ps1` (isolation gate 21/21 before every run). Raw logs: `05-REMEDIATION/final-*.log`.

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 errors** |
| Lint (`npm run lint`) | **0 errors, 5 warnings** (earlier baseline: 6 warnings) — plain `eslint .` is not the project script and also scans build folders |
| Production-mode build (`next build --webpack`, Next.js 16.3.8) | **built**; `/api/health` ok; app started and used in the browser |
| Default suite (unit + integration, 238 files) | **234 passed, 4 skipped files; 1,760 tests passed, 18 skipped, 0 failed** |
| Remediation suite (post-audit, 33 files) | **182 tests passed, 0 failed**. One run showed a fixture-teardown error in `110-approval-hardening` (a background write raced the cleanup); on two clean re-runs the file passed 10/10 |
| VAPT suite (exploit + regression, 4 files) | **16 passed, 0 failed** |
| Earlier flaky tests | `stage5-outbound-failure` / `stage6` (5 s timeouts under load) failed once in an early full run and passed on re-run; `approval-email-link` passed 11/11 on the final code |
| Skipped / blocked | 18 integration tests are skipped by design (they need a real mailbox, WhatsApp or provider: blocked on the isolated stack); 4 files skipped |
| Not executed | scanners (Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei, Burp: not installed); full multi-role browser UAT (see below); a real Gmail/Outlook/WhatsApp round trip; load tests beyond the bounded latency check |

## Exploit → fix → retest (each pair run on the isolated stack)
| Finding | Before the fix | After the fix |
|---|---|---|
| VA-DB-01/TKT-01 priority | technician and manager changed priority through the data API | refused (T11, 2 tests) |
| VA-DB-01 SLA dates | technician pushed deadline +365 days and paused-time to 999,999,999 ms | refused (T11) |
| VA-DB-02 forged ticket | requester inserted an "urgent" ticket into another group's queue | refused (T11) |
| VA-DB-03 config | manager changed services, SLA policies, SLA config | refused; admin still can (T11) |
| VA-INT-01 internal-note file | requester could list/download it | hidden (T10) |
| VA-INT-03 notifications | collaborator received the note text | no note text sent (T10) |
| VA-INT-13 mobile numbers | requester read a colleague's number; manager attached a number | refused (T10) |
| VA-INT-10 direct upload | requester uploaded into the task store | refused (T10) |
| VA-API-02 reset flag | user switched it off | stays on (T10); server clears it after a real password change (remediation test) |
| VA-INT-02 e-mail reply | any employee/OEM accepted | participants only (T12, logic level) |
| VA-DB-11 code guesses | 20 parallel guesses all counted as tries | ≤ 4 accepted, then locked (unit) |
| zip bomb | fully unpacked | refused at the size limit (unit) |
| log flood | 120 forged reports → 120 rows | 30 rows (HTTP probe) |
| login CSRF | cross-site POST processed | 403; same-origin works (HTTP probe) |

## Functional regression (existing business flows)
Covered by the existing suites that passed: employee ticket creation and mandatory fields, technician queues and assignment, SLA pause/resume and reopen (status races, SLA tests), approvals (portal and e-mail link), notifications, e-mail reply sync, attachments, reports/exports and dashboards (including the dashboard-number-equals-pop-up parity test), System Log, WhatsApp mock flows, the full multi-role UAT lifecycle (`tests/remediation/90-uat-lifecycle`), bulk actions. Browser UAT on the final build: signed in as a synthetic technician, opened a ticket, pressed "Start Working" (status → In Progress), priority shown as a plain badge, no console errors. A multi-role browser pass (requester creating a ticket, manager views) was **not** done in the browser (the pane is narrow and each sign-in is manual); the same flows are covered by the automated UAT suite above.

## Things found while retesting (disclosed)
- The dashboard parity test failed once because my own browser-UAT ticket was still in the database; after removing it the test passed (test contamination, not a defect). Two stale fixture users remain in the disposable audit database (referenced by old activity rows).
- A "300-second background command finished" notice came before the suite ended on two occasions; the final numbers above are from the finished logs.

---

# PART 3. HTTP PROBE CAPTURES

_Source file: `02-VAPT/HTTP-PROBE-CAPTURES.md`_

# HTTP probe captures (LOCAL audit app only)

Date 2026-10-15. Target: the disposable audit application on `127.0.0.1:3310` (egress guard on, isolation gate 21/21), built from this checkout. "OLD" = the build made with Next.js 16.3.8 but before the application fixes; "NEW" = the final build. All probes used `curl` against loopback; no credentials were used except where stated. Output below is copied from the terminal, trimmed to the relevant lines.

## H1 — Next.js image optimizer (framework advisory GHSA-2xp9-vwfh-vxw4, AVIF RCE; SSRF advisories)
```
GET /_next/image?url=%2Fcitykart-desk-icon.png&w=64&q=75   Accept: image/avif,image/webp  -> 200 image/webp
GET /_next/image?url=%2Fcitykart-desk-icon.png&w=64&q=75   Accept: image/avif            -> 200 Content-Type: image/png   (AVIF is not produced: it is not enabled in next.config.ts)
GET /_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75                           -> 400   (remote images refused: no images.remotePatterns)
GET /_next/image?url=http%3A%2F%2F127.0.0.1%3A55421%2Fauth%2Fv1%2Fhealth&w=64&q=75        -> 400
```
Reading: the AVIF image-processing condition of that advisory is not met in this configuration, and remote image fetching is refused. The Windows file-system advisory (GHSA-p293-qw3h-jr36, CVSS 9.0) does not depend on the image route and applies to the production host until Next.js is upgraded there.

## H2 — page-looking paths ending in .png (VA-API-04)
```
OLD  GET /requests/x.png (no cookie)  -> 307 http://127.0.0.1:3310/login?retry=1       (the proxy skipped its session check; the page layout redirected)
OLD  GET /home.png                    -> 404
NEW  GET /requests/x.png (no cookie)  -> 307 http://127.0.0.1:3310/login?next=%2Frequests%2Fx.png   (proxy gate applies)
NEW  GET /citykart-desk-icon.png      -> 200   (real root-level file still served)
```
Reading: it was never a login bypass (the page's own check held); it was a gap in the first line of defence and in the body-size guard.

## H3 — body-size guard on public forms, 3 MB POST with a Server-Action header
```
OLD  /login 413 · /approve/abc 413 · /approve/abc.png 404 · /requests/abc.png 404 · /csat/abc.png 404
```
Reading: the oversize POST to image-looking paths was not reached by the action (404), so no memory-pressure effect was shown; the guard gap was closed anyway.

## H4 — forged browser-security reports (VA-API-07 / VA-INT-08 / VA-ADM-08)
```
OLD  120 POSTs to /api/csp-report, each with a different X-Forwarded-For and blocked-uri:  system_log rows security.csp_violation: 0 -> 120
NEW  the same 120 POSTs:                                                                    rows added: 30   (global cap 120/min, per-address cap 30/min)
```

## H5 — login CSRF on /auth/confirm (VA-API-08)
```
OLD  POST /auth/confirm  Origin: http://evil.test  token_hash=abc&type=recovery  -> 303 http://localhost:3310/forgot-password?expired=1   (the token was processed)
NEW  POST /auth/confirm  Origin: http://evil.test                                -> 403
NEW  POST /auth/confirm  Origin: http://localhost:3310 (the site's own origin)   -> 303 .../forgot-password?expired=1  (legitimate form still works)
NEW  POST /auth/confirm  (no Origin header: not a browser)                       -> 303
```

## H6 — response headers (VA-API-14, VA-API-01)
```
OLD  GET /login: X-Content-Type-Options: nosniff; X-Frame-Options: SAMEORIGIN; Referrer-Policy: strict-origin-when-cross-origin;
     Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...; X-Powered-By: Next.js
     (no Strict-Transport-Security)
NEW  X-Powered-By absent. Strict-Transport-Security is sent only when NEXT_PUBLIC_APP_URL starts with https (not the case here).
```
Browser check on the final build, signed in as a synthetic technician: the Supabase login cookie (`sb-…-auth-token`) was readable by page scripts (`document.cookie`), i.e. not HttpOnly, over `http:`. This is how the Supabase browser client works and is why transport security (HTTPS) matters (VA-API-01, decision D-018/D-037).

## H7 — build/start
The audit app was built with `next build --webpack` (the production build mode) and run with `next start`; `/api/health` answered `{"status":"ok","db":"ok"}`; the build step downloads web fonts from Google and executes no application code (documented in `work/build-and-start-audit-app.ps1`).

---

# PART 4. MANUAL PENETRATION TESTING LOG

_Source file: `02-VAPT/03-MANUAL-PENETRATION-TESTING.md`_

# 03 — Manual Penetration Testing Log (VAPT of Citykart Desk, CKDesk)

Date: 2026-10-15
Status: DRAFT for management review — internal readiness assessment, not an audit report or attestation

## How to read this

This is a case-by-case log of the 15 attack scenarios the assignment ranked highest. For each one it says: what the safe behaviour should be, how it was checked, what happened, and where the proof is. "Penetration test" here means we tried to do the harmful thing ourselves, on a **disposable copy only**, never on production.

Three kinds of check are used and every case says which:
- **Exploit test, before and after (L-before / L-after).** We wrote a test that does the harmful thing. It succeeded on the old code and database, then failed (the attack was refused) after the fix. This is the strongest evidence (class A).
- **Read-only database check.** We read the real rules (policies, triggers, grants) from the audit database and, in a few cases, ran a read-only simulation as a given role. No data was changed (class A for the fact read, but it is not an attack).
- **Source review only.** We read the code and reasoned about it (class B). Nobody ran the attack. These are marked "source review only" and are weaker.

Plain wording for results: **Exploit worked before the fix** means the attack succeeded on the unfixed LOCAL stack. **Blocked** means the attempt was refused. **Not testable here** means the audit stack could not show it (for example it needs a real Gmail mailbox or Meta account, or a second company in the data).

Nothing here is deployed. Production runs build `20261015-145217` (main `717e5c6`) and does **not** contain the fixes. Nothing here tested production.

*Naming note:* the finding status table and a comment in `next.config.ts` call this log `02-VAPT/04-MANUAL-PENETRATION-TESTING.md`. This deliverable is numbered 03. They mean the same file.

---

## 1. Test environment and rules

| Item | Value |
|---|---|
| Application under test | local build of this checkout, port 3310 (Next.js 16.3.8 for the fixed build) |
| Database / API | disposable Postgres `supabase_db_ckdesk_audit`, API on 127.0.0.1:55421, 3,000 synthetic tickets, 336 synthetic profiles, **one** organisation |
| Mail | local mail trap only; no mail leaves the PC; no mailbox, WhatsApp or OAuth channel configured |
| Safety gate | isolation gate passed 21 of 21 checks before dynamic work; an egress guard refuses any non-loopback connection |
| Not touched | production 10.0.1.98, 10.0.0.205, 10.0.0.25, retired 10.0.1.12, public 182.72.84.10 |

Test files (all under the repository root):

| Short name | File | Tests |
|---|---|---|
| **T10** | `tests/vapt/10-confidentiality-exploits.test.ts` | 5: internal-note file (VA-INT-01); internal-note notification text (VA-INT-03); mobile numbers (VA-INT-13); direct upload to the task-files store (VA-INT-10); clearing the "must change password" flag (VA-API-02) |
| **T11** | `tests/vapt/11-integrity-exploits.test.ts` | 6: technician changes priority; manager changes priority; technician pushes the deadline a year ahead; requester creates a ticket straight in the database; manager changes SLA policy or service; admin still can (positive control) |
| **T12** | `tests/vapt/12-email-reply-participant.test.ts` | 4: who may reply to a ticket by e-mail (logic level) |
| **TU** | `tests/unit/vapt-hardening-units.test.ts` | mail-server address forms; public storage path dot; proxy static-file rule; code-level rules (flag, subject, server-only creation); who may change whom (VA-ADM-05) |
| **TB** | `tests/unit/approval-code-burst.test.ts` | 2: 20 simultaneous wrong guesses; the right code still works |
| **H** | HTTP probes against the audit app on 3310 | section 4 |
| **M164** | `supabase/migrations/20240101000164_vapt_security_hardening.sql` | the database fix that the exploit tests check |

Latest saved run of T10 + T11 + T12: **15 of 15 pass** on the fixed stack (`05-REMEDIATION/regress-vapt-2.log`). Each test states the secure behaviour. Before M164 and the code fixes the exploit tests failed, which is how each finding was shown to be real.

---

## 2. Summary of the 15 scenarios

| # | Scenario | Result in one line | Check type | Findings |
|---|---|---|---|---|
| 1 | Requester reads another person's ticket | **Blocked**; no way found | read-only DB check + source review | none open for this path |
| 2 | Requester reads internal notes | Direct note blocked; **two side paths worked before the fix** (files, notification text), now blocked; one Low path open | exploit before/after (T10) | VA-INT-01, VA-INT-03 fixed; VA-TKT-20 open |
| 3 | Technician reaches management reports | **Blocked** by scope rules; no exploit found | source review only | VA-ADM-13, VA-ADM-15 Low open |
| 4 | Manager exceeds their visibility | Org-wide reading is **by design**; **configuration writes worked before the fix** for 4 tables, now blocked; ~20 tables still open | exploit before/after (T11) + unit (TU) | VA-DB-03, VA-ADM-05 (fixed part); VA-DB-03 rest, VA-ADM-03, VA-ADM-06 decisions open |
| 5 | Bypass mandatory fields | Direct database insert **worked before**, now blocked; technician-only keys fixed by code; some skips remain | exploit before/after (T11) + source review | VA-DB-02, VA-TKT-08 fixed; VA-TKT-10, VA-TKT-01 rest open |
| 6 | Modify priority through the API | **Worked before the fix** for technician and manager (priority and deadlines); now refused | exploit before/after (T11) | VA-DB-01/VA-TKT-01 fixed (part); VA-TKT-02, VA-ADM-09, VA-TKT-12 open |
| 7 | Change the service of a ticket | **Blocked** at the database already | read-only DB check + source review | none for the update path; creation path fixed under #5 |
| 8 | Unauthorised approval | Main path **blocked**; code-guessing budget flaw fixed; **side doors open** | exploit before/after (TB) + source review | VA-DB-11/VA-TKT-13 fixed; VA-TKT-07, VA-ADM-06 open |
| 9 | Download another person's attachment | Request files **blocked** by row rules; internal-note file **worked before**, now blocked | exploit before/after (T10) + source review | VA-INT-01 fixed; VA-TKT-09 (task files) open |
| 10 | Manipulate report filters | **No widening path found**; one field-hiding gap fixed by code | source review only | VA-ADM-04 fixed (CODE); VA-ADM-15 open |
| 11 | Forged webhook | Authentication **holds on reading**; public log endpoint was floodable (fixed) | source review + HTTP probe (H) | VA-API-07 fixed; VA-API-12 open |
| 12 | Replayed request / duplicate ticket | Replays **blocked** where a unique key exists; portal double-submit **not examined** | source review (+ TB for codes) | VA-API-12, VA-TKT-10 open; double-submit Not Verified |
| 13 | Invoke an admin server action directly | Every admin action re-checks the role; **manager-allowed list is wide**; front-door bypass fixed | source review + unit (TU) + HTTP probe (H) | VA-API-04 fixed; VA-ADM-03/05/06/13 |
| 14 | Modify configuration through the database API | **Worked before the fix** for 4 tables (T11); ~20 tables still writable by managers | exploit before/after (T11) | VA-DB-03 |
| 15 | Malicious content against an AI feature | No model creates or changes tickets; two optional model uses give **suggestions to a human** | source review only | none open that depends on a model |

---

## 3. The 15 cases

Each case lists: **Expected** (safe behaviour) · **How checked** · **Result** · **Evidence**.

### Case 1 — A requester tries to read another person's ticket

- **Expected:** a requester sees only their own tickets (plus tickets they collaborate on, approve, or that belong to their direct reports where that view exists). A stranger's ticket id returns nothing, over the screens, the PDF, the attachments and the database API.
- **How checked:** (a) read-only catalog check of `requests_select` and the policies for comments, activity, approvals and attachments (all begin with the organisation test and limit non-staff to their own tickets); (b) read-only role simulation in the audit DB as an ordinary requester with no tickets: no rows from `requests`, `request_comments`, `tasks`, `notifications`; as `anon`: zero rows from every table; (c) source review of the PDF route (viewer's RLS on every query) and the attachment routes. No new HTTP exploit test was written for this case.
- **Result:** **Blocked.** No path found. Related weakness found on the way and fixed: a manager could make any chosen person someone's "line manager", which opens the subordinate's tickets to that person (VA-ADM-05, fixed in LOCAL, unit-tested). The "submit for approval" route that made unrelated people approvers (and so readers) of a ticket was also fixed (VA-TKT-05).
- **Not testable here:** cross-company reading, because the audit DB has one organisation. Those statements rest on the policy text.
- **Evidence:** class A (read-only simulation) and B. `vapt-2026-10/work/review-database-rls.md` §2 "Isolation of tickets for requesters"; `review-ticket-actions.md` §2.

### Case 2 — A requester tries to read internal notes

- **Expected:** internal notes, and anything derived from them (files, notification text, e-mail, PDF, history), are staff-only.
- **How checked:** read-only check of `comments_select` (internal notes hidden from requesters); T10 exploit tests for the two side paths below, run before and after the fix.
- **Result:**
  - The note itself: **blocked** at the database.
  - A file attached to an internal note: **exploit worked before the fix.** The system stored it as a normal file, so the requester could list and download it (and its name appeared in the PDF and history). After M164 and the upload fix the requester cannot list or download it (T10 test 1). Old rows were back-filled by the migration.
  - The start of an internal note sent by bell or e-mail to a collaborator who is not staff, or to an @mentioned colleague who cannot open the ticket: **worked before**; after the fix recipients are filtered (T10 test 2).
  - Still open (Low): the requester can read the ticket's activity rows through the database API, which can include rule names and copied e-mail addresses (VA-TKT-20). The Report Builder review also noted that a comment count may include internal notes; the status table's fix covers technician-only form fields, so treat the count as unconfirmed.
- **Evidence:** class A. T10 tests 1 and 2; `lib/actions/attachments.ts`, `lib/actions/requests.ts`; M164 (file-store read rule). Findings VA-INT-01, VA-INT-03 (file 06), VA-TKT-20 (file 05).

### Case 3 — A technician tries to reach management reports

- **Expected:** a technician sees only the tickets of their own group(s), not company-wide figures, not the management dashboards, not the admin area.
- **How checked:** **source review only.** `authorizeReportAccess` / `resolveReportAccess` decide own, group or all by role; non-ticket report entities are manager and above; fixed reports limit groups to the viewer's memberships and ignore other picks; the admin layout redirects every role except admin, manager, platform owner. No dynamic request was made as a technician.
- **Result:** **Blocked on reading; no exploit found.** Low open items: two admin pages have no check of their own (VA-ADM-13, only reachable through the layout; reads go through RLS; "plausible", needs a crafted request); several exports are not recorded in the audit log and have no per-user limit (VA-ADM-15).
- **Evidence:** class B. `review-admin-report-actions.md` §2 "Reports and analytics scope".

### Case 4 — A manager tries to exceed their visibility

- **Expected:** by design a manager reads every ticket in the organisation (open decision D-005: no confidentiality tier for HR or Finance). A manager must **not** be able to edit configuration reserved for administrators, edit an administrator or platform owner, attach a mobile number to someone else's account, or give themselves technician-group membership.
- **How checked:** read-only simulation (a manager in one group reads all 3,000 tickets: confirmed, by design); T11 exploit tests on configuration tables (before and after); TU unit tests of the "who may change whom" guard; source review for the app-level gates.
- **Result:**
  - Org-wide reading: **confirmed, by design**, recorded as a decision (D-005).
  - Database configuration writes (services, SLA policies, global SLA settings, field SLA overrides): **exploit worked before the fix** (manager PATCH accepted); **refused after M164** (T11 test 5); the administrator can still write (T11 test 6, positive control).
  - Editing administrators, attaching phone numbers, setting reporting lines, adding self to groups: **possible before**; after the LOCAL fix `targetGuardError` covers profile, phone and team edits and the last two are administrator-only (TU). This is a unit-level proof of the guard, not a click-through of the screens.
  - Still open: about 20 other configuration tables are writable by managers in the database; managers can edit global settings through the app (business hours, holidays, priorities, settings) although the database reserves them for the platform owner; managers can author Business Rules and edit approval-workflow steps. These need an owner decision (VA-DB-03 rest, VA-ADM-03, VA-TKT-02, VA-ADM-06).
- **Evidence:** class A (T11 tests 5-6, TU) and B. Files 04 and 05.

### Case 5 — Someone tries to bypass mandatory fields

- **Expected:** a ticket exists only if the service's form was completed (mandatory fields, requester-only versus technician-only fields), priority and deadlines come from the sub-category, and a resolution needs a proper note.
- **How checked:** T11 test 4 (a requester inserts a ticket straight into the database with an urgent priority and another group's service and team); source review of `create-request-core.ts` for technician-only keys; source review of the status-change gate.
- **Result:**
  - Direct insert: **worked before the fix** (the ticket was created with the forged priority and no deadlines). **Refused after M164** (T11 test 4).
  - Technician-only form keys sent by a requester: **possible, by reading the code** (the technician's mandatory-field gate could be pre-satisfied and the SLA tier influenced). Fixed in code to accept only requester-settable fields (CODE; no dynamic test was run).
  - Still open: "Duplicate request" builds a ticket with the server key and skips the creation checks (VA-TKT-10, Low). The database does not enforce the "resolution note exists" rule; it lives in the server action only, so a technician talking to the database directly can move a ticket to resolved without a note (part of VA-TKT-01 rest, Partially Fixed).
- **Evidence:** class A (T11 test 4) and B. VA-DB-02 and VA-TKT-08 (file 05).

### Case 6 — Someone tries to change priority through the API

- **Expected:** nobody, not even a manager or admin, sets a ticket's priority or deadlines by hand. Priority comes from the sub-category and its SLA, or from a Business Rule. This was the owner's recent decision, built into the screens.
- **How checked:** T11 tests 1 to 3 against the data API with real technician and manager logins, before and after M164. The test sends an update straight to the database service (as the browser can), not through the screens.
- **Result:** **Exploit worked before the fix** in all three cases: a technician of the group changed priority; a manager changed priority; a technician pushed the resolution and response deadlines a year ahead and inflated the paused-time ledger (so a late ticket looks on time). The database review also found, by reading, that deadline-only changes left **no System Log row**. **After M164** the database refuses each with error 42501 and the stored values are unchanged; deadline changes are now watched by the System Log. The finding was High because the rule was only a screen rule.
- **Still open:** three legitimate-looking routes to change priority remain, all waiting on an owner decision: a manager writing a Business Rule that sets priority or status (VA-TKT-02); the intake reviewer choosing a priority when making a ticket from an e-mail (VA-ADM-09); changing the sub-category after creation, which recomputes priority and deadlines (VA-TKT-12, Low). A technician or manager can still change `assigned_to`, `description`, `form_data`, `resolved_at`, `closed_at`, `reopen_count` and the category through the data API until column-level rights are designed (VA-TKT-01 rest).
- **Evidence:** class A. T11 tests 1-3; M164 (`guard_request_client_write`); `tests/unit/no-priority-change.test.ts` for the screen side.

### Case 7 — Someone tries to change the service of a ticket

- **Expected:** nobody can change a ticket's service (every service has its own mandatory form). Category and sub-category can still be changed.
- **How checked:** read-only catalog check of `requests_update` (its WITH CHECK calls `request_identity_unchanged(id, org_id, requester_id, service_id, team_id)`, which freezes organisation, requester, service and team); source review confirms the app action `reclassifyRequest` was removed in the earlier release. No separate VAPT exploit test was written because the update path was already closed.
- **Result:** **Blocked** at the database for updates. The only service-related hole was on **creation** (a direct insert with any service or team), fixed under Case 5.
- **Evidence:** class A (policy text read from the audit DB) and B. `review-database-rls.md` §1 VA-DB-01 evidence and §2.

### Case 8 — Someone tries an unauthorised approval

- **Expected:** only the named approver can decide; the person who raised or sent the request cannot; an e-mailed link alone never decides; the one-time code is random, single use and limited to five wrong tries.
- **How checked:** TB burst test (20 simultaneous wrong guesses, before and after the fix); TU rule that the code is never in the subject; source review of `lib/approvals/decision.ts`, `email-link.ts`, `email-code.ts`, `approvalEmail.ts`; integration tests for the e-mail-link flow exist (see the caution on the saved logs in file 02 §5).
- **Result:**
  - Main decision path: **blocked** (identity per step, requester and sender barred, decision unique per step, compare-and-set update; decisions cannot be inserted by clients).
  - Code guessing: **exploit worked before the fix**: parallel wrong guesses were counted as one try (**20 of 20 accepted before; at most 4 after**, then lock). Class A (TB).
  - Code printed in the e-mail subject and therefore copied into the Event Log: **was the case before** (found by reading the code); the code is now in the body only and a unit test checks that the subject never carries it (TU).
  - "Submit for approval" picked any workflow and a requester could start it: **fixed in code** (VA-TKT-05, CODE).
  - **Open:** the "separation of duties" rule is closed only on the decide step; delegating, adding approvers and the other submit path let one person arrange who approves (VA-TKT-07); a manager can edit the live approver on a waiting step (VA-ADM-06, decision).
- **Evidence:** class A (TB) and B. Files 05 (approvals) and 06.

### Case 9 — Someone tries to download another person's attachment

- **Expected:** a file is downloadable only by people who can see the ticket, and internal files only by staff. A path from another ticket must not work.
- **How checked:** source review of the download routes (RLS read with the caller's session on every fetch; path must start with the ticket's own folder; content type from a fixed table; `nosniff`); T10 test 1 for the internal-file case; T10 test 4 for direct upload to the task-files store.
- **Result:** Ordinary request files: **blocked** by the row rules (reading). Internal-note file: **worked before, blocked after** (T10 test 1). Direct upload into the task-files store by an ordinary user: **worked before, refused after M164** (T10 test 4). Open: a user could forge a "file record" for a task they own pointing at another task's file path and read it; this needs the exact path (long random id), practical risk low (VA-TKT-09/VA-DB-10, Open).
- **Not testable here:** cross-company download. No dedicated "requester B downloads requester A's file over HTTP" test is recorded in the material I was given; the result for that case is from policy text and route code.
- **Evidence:** class A (T10) and B. File 06.

### Case 10 — Someone tries to manipulate report filters

- **Expected:** filters (group, assignee, store, date, pivot settings) can narrow what a person sees, never widen it beyond their role.
- **How checked:** **source review only.** `getFilteredRequests` re-derives scope from the session; `narrowScopeToGroups` validates ids and intersects with allowed groups; fixed reports and the executive dashboard re-apply scope; report recipients are re-validated at send time.
- **Result:** **No widening path found.** One related gap found by reading, not by a test: the Report Builder showed technician-only form fields to the requester for their own tickets (VA-ADM-04). Fixed in code (filtered for own and reports scopes). The browser rendering was not run. Open (Low): the pivot configuration from the browser is not validated, and exports are not all audited (VA-ADM-15).
- **Evidence:** class B. `review-admin-report-actions.md` §2.

### Case 11 — Someone sends a forged webhook

- **Expected:** a call to the WhatsApp, Gmail, Outlook or log-ingest address without the right signature or secret is refused and changes nothing.
- **How checked:** **source review** of the signature and token checks (WhatsApp HMAC-SHA256 on the raw body with constant-time compare; token compare for Gmail and Outlook; Outlook `clientState` per notification; ingest secret of 16+ characters). **HTTP probe H** for the public CSP-report endpoint (forged reports, see section 4). No forged Meta or Google call was made, and no real signature could be produced without their secrets.
- **Result:** the signature and token checks **hold on reading** (missing secret fails closed). The unauthenticated CSP-report endpoint was **floodable before the fix** (120 forged reports from invented source addresses made 120 System Log rows; **30 after**). Open (Low): the Gmail hook relies on one token in the URL and does not verify Google's signed token; the Outlook and WhatsApp hooks have no replay or timestamp guard; the WhatsApp verification page can be called repeatedly to cause database work (VA-API-12).
- **Not testable here:** real Meta/Google/Microsoft traffic.
- **Evidence:** class B for the checks, class A for the CSP probe. File 06 (webhooks) and file 05 (log flooding).

### Case 12 — Someone replays a request or creates a duplicate ticket

- **Expected:** sending the same message twice must not create two tickets, two comments or two approvals.
- **How checked:** source and catalog review of the unique keys: one ticket per intake message (`requests_one_per_intake_message`, migration 162), WhatsApp `UNIQUE(org_id, channel_type, external_message_id)`, e-mail claim row with unique Message-ID, approval code claimed by an update that needs `used_at IS NULL`, survey rating single-use through `submitted_at IS NULL`, one pending approval per ticket, one decision per approval step. TB covers the approval-code replay. The WhatsApp integration suites exist and ran in the default run; no replay-specific test was added in this assessment.
- **Result:** replays are **blocked where a unique key exists**. Gaps: a replayed Outlook notification has no timestamp guard (idempotent downstream, not re-proven); a replayed signed WhatsApp payload is de-duplicated but still re-sends the last prompt to the user (bounded by 30 messages per minute per sender; observation, not a finding).
- **Not examined (Not Verified):** whether an ordinary portal submit (double click on "Create request") has an idempotency key. The reviews looked at e-mail and WhatsApp creation, not at double submission in the portal.
- **Evidence:** class B, TB for codes (class A).

### Case 13 — Someone invokes an admin server action directly

- **Expected:** an admin action called by an ordinary user, by a script, or through a path the screen never links must refuse, because each action checks the caller's role itself (the page redirect is not a protection).
- **How checked:** source review of all 54 action files (file 01 §4.4); TU and `tests/unit/target-guard.test.ts` for the target guard; H probe for the side door in the proxy. **Not done:** posting a real Next.js action id to an admin action as a requester and reading the answer. No such test is recorded.
- **Result:** every admin action reads the caller's profile and rejects roles outside its list. Findings: the lists are **wider than the database or the screens intend** in several places (managers allowed on settings, Business Rules, workflow steps, org lists; VA-ADM-03, VA-TKT-02, VA-ADM-06, decisions open); two admin pages rely on the layout only (VA-ADM-13); five actions rely on row rules only (no explicit sign-in check). The proxy side door (any path ending `.png` skipped the session check and the public-form size cap, so actions could be posted to such an address) is **fixed** in LOCAL (VA-API-04, section 4).
- **Evidence:** class B and TU/H (class A). Files 01, 05.

### Case 14 — Someone tries to modify configuration through the database API

- **Expected:** a configuration table the screens reserve for administrators cannot be written by a manager, even with their own valid login and the public key (the browser holds both).
- **How checked:** T11 tests 5 and 6 (before and after M164).
- **Result:** **Exploit worked before** for `services`, `sla_policies`, `global_sla_config` and `field_sla_overrides` (a manager's PATCH changed them). **Refused after M164**; the administrator can still write. **Not fixed:** about 20 further configuration tables (for example form templates, categories, stores, OEMs, assignment rules, alert rules, approval workflows) stay writable by managers in the database (Requires Decision, VA-DB-03 rest). The reverse gap also exists: global settings are database-reserved for the platform owner, but app actions let managers and admins edit them (VA-ADM-03).
- **Evidence:** class A. T11 tests 5-6; M164.

### Case 15 — Malicious content against an AI feature

- **Expected:** hostile text in a ticket or e-mail ("ignore your instructions and ...") must not make any automated system change data, leak data, or act for the attacker.
- **What exists (from the code):** **no language model reads, creates or changes tickets.** Two optional uses exist and both are off unless a model key (`INTAKE_LLM_API_KEY`) is set: (1) a reviewer-only e-mail summary in the web app (`lib/actions/intake/brief.ts`; role check, first 2,000 characters in, output shown as plain text, no tools); (2) an optional second-stage mail classifier in the separate intake worker (`api/src/intake/classify/local-model-classifier.ts`) whose output is a suggestion (type, priority) placed in a human review queue; a person must click to create the ticket. The "Catch me up" ticket summary is built from the ticket's own history by fixed rules, with no model.
- **How checked:** **source review only.** No model key is configured on the audit stack and no connection to a model provider is allowed, so nothing could be run.
- **Result:** hostile text can at most distort a suggestion or a summary that a person then reads. There is no tool call or write path for a model to abuse. Whether the key is set in production is not known from the repository (data request below). Related, and not model-based: the mail viewer shows e-mail HTML in a sandbox without scripts, but its "block remote images" step is incomplete and a mail can redirect its own frame (VA-INT-12, Low, open).
- **Evidence:** class B. `review-uploads-email-whatsapp.md` §2.

---

## 4. HTTP probes (H) against the audit app

Made by the lead tester against the audit app on 127.0.0.1:3310 (old build = before the fixes; fixed build = Next.js 16.3.8 with the fixes). The raw request and response captures were **not among the files given to me**; the facts below are as reported in the task brief. They are class A as reported, and should be backed by saved captures before an auditor sees this.

| # | Probe | Old build | Fixed build | What it tells us |
|---|---|---|---|---|
| H1 | The image optimizer (`/_next/image`) with different formats and remote URLs | serves **only webp and png**; **remote image URLs are refused with 400** | same | The conditions for the AVIF remote-code-execution advisory and the image-optimizer SSRF advisory are not met by our configuration (file 02 §3.3). It does not remove the need to upgrade |
| H2 | An unauthenticated request to `/requests/x.png` (a page-looking path ending in `.png`) | redirected by the **page layout** (not the proxy) | now decided by the proxy: the unit test expects a 307 to `/login` (an HTTP result on the fixed build was not separately reported) | The old proxy side door (VA-API-04) did **not** give a stranger access to a ticket. The finding was **defence in depth**, not a login bypass. The proxy rule is now root-level files only (TU + `header-trust` test) |
| H3 | 120 forged CSP reports posted with invented `X-Forwarded-For` values | **120** System Log rows | **30** System Log rows | Anyone could fill the System Log; now capped (VA-API-07, VA-INT-08, VA-ADM-08) |
| H4 | A cross-site POST to `/auth/confirm` (login CSRF) | processed (**303**) | refused (**403**); a **same-origin** POST still works | Fixed with an `Origin` / `Sec-Fetch-Site` check (VA-API-08) |
| H5 | Response headers | `X-Powered-By` present | `X-Powered-By` **absent** | Framework banner removed (VA-API-14) |

Not probed: HTTPS, cookie flags on the real site, rate limits per address (needs the production proxy chain), and anything on production.

---

## 5. What this testing did not and could not show

- Everything that needs a real Gmail mailbox, Meta WhatsApp account, Microsoft or Google OAuth: logic was tested, not the live service (details in file 06).
- Cross-company behaviour: the audit database has one organisation.
- Production configuration (HTTPS, login-service self sign-up, cookie flags, firewall). VA-DB-08 stays **Not Verified**.
- Concurrency at scale, denial-of-service by large or crafted files (the spreadsheet preview issue VA-API-06/VA-INT-04 is still open), and the 10-25 MB upload size change (**Not Verified** dynamically; confirm with a 20 MB upload in acceptance testing).
- Social engineering, physical access and the servers themselves.

## Open questions / evidence requests for management

1. Please decide the open policy questions that decide whether Cases 4, 6, 8, 13 and 14 end as "blocked": may managers write Business Rules, approval-workflow steps, global settings and the other configuration tables? Owner name to be assigned by management.
2. Please decide whether the intake reviewer may still choose a ticket's priority when creating a ticket from an e-mail (VA-ADM-09).
3. Please confirm whether `INTAKE_LLM_API_KEY` is set on the production app server or intake worker, and which provider (Case 15).
4. Please authorise a short acceptance test of a 20 MB attachment upload on the local stack after the next build.
5. Please arrange a one-off test of a portal double submit (Case 12) and an HTTP-level test of requester B downloading requester A's attachment, both on the local stack.
6. Please provide, if an external assessor will rely on this log, the saved raw captures of probes H1 to H5 (the lead tester to save them into `02-VAPT/work/`).

---

# PART 5. FIXES — CHANGE LOG

_Source file: `05-REMEDIATION/01-CHANGE-LOG.md`_

# 05 / 01 — Change log (LOCAL only, branch `security/vapt-iso27001-soc2-local`, commit `35922ad`)

Nothing here is pushed, merged or deployed. Production (build `20261015-145217`, main `717e5c6`) does **not** contain any of it.
56 files changed, 1,611 insertions, 703 deletions (includes new tests and the test updates listed in section 4).

## 1. Database — one new migration, with rollback
`supabase/migrations/20240101000164_vapt_security_hardening.sql` (idempotent, one transaction) and `supabase/rollback/164_vapt_security_hardening_rollback.sql`.
Applied to the disposable audit database only; applied → rolled back → re-applied during testing (before/after evidence).
| Block | What it does | Finding |
|---|---|---|
| requests guard trigger | refuses a hand-made change of `priority`; refuses a change of SLA due dates / paused-time ledger unless the status changes in the same update | VA-DB-01, VA-TKT-01 |
| requests insert | direct INSERT by a signed-in user removed (the server creates tickets) | VA-DB-02 |
| System Log watch list | SLA due dates and pause ledger now audited | VA-DB-01 |
| internal-note attachments | back-fill `is_internal`; file-store read rule now needs the organisation and hides internal files from the requester | VA-INT-01, VA-DB-06 (part) |
| `task-attachments` | direct-upload policy removed | VA-INT-10, VA-DB-05 (part) |
| mobile numbers | read: own row or staff; write: admin / platform owner | VA-INT-13, VA-DB-07 (part) |
| must-change-password flag | column right removed; trigger refuses any client change | VA-API-02, VA-DB-04 |
| config tables | services, SLA policies, SLA config, field SLA overrides: admin / platform owner only | VA-DB-03 (part) |
| privileges | TRUNCATE / TRIGGER / REFERENCES revoked from `anon`, `authenticated` | VA-DB-12 (part) |
**Not run on production.** Before any production use: back up, apply in a maintenance window, restart PostgREST (schema cache), run the rollback rehearsal. See `06-MANAGEMENT/05-RELEASE-PREREQUISITES.md`.

## 2. Dependencies
- Next.js 16.2.9 → **16.3.8** (exact), `eslint-config-next` → 16.3.8, `npm audit fix` (non-breaking). Production-dependency vulnerabilities 9 (1 critical, 5 high, 3 moderate) → 2 moderate (uuid via exceljs: only fix is a breaking downgrade; the vulnerable call is not used). One new lint rule of the upgraded plugin was satisfied with a documented disable in `AnalyticsDashboard.tsx` (browser-only localStorage read).

## 3. Application code (what changed and why, in plain words)
| Area | Files | Change |
|---|---|---|
| Tickets are created by the server only | `lib/actions/requests.ts` | `useAdminForWrites: true` (identity and service checks unchanged) |
| Files on internal notes | `lib/actions/attachments.ts` | file copies the note's internal flag; history entry has no file name for internal files |
| Internal-note alerts | `lib/actions/requests.ts` | alerts and @mentions only reach people who may read the note |
| E-mail replies | `lib/email/inbound-participant.ts` (new), `inbound.ts`, `inbound-auth.ts` | sender must take part in the ticket; auto-replies skipped; DMARC pass must match sender domain; two From lines = no sender |
| Outgoing mail | `lib/email/send.ts`, `lib/actions/approvalEmail.ts` | `Auto-Submitted` headers; approval code only in the body |
| Approvals | `lib/actions/requests.ts`, `approvals.ts`, `lib/approvals/email-code.ts` | submit-for-approval: staff only, no random workflow, sender recorded; ad-hoc names without ticket titles; parallel wrong guesses counted |
| Front gate | `proxy.ts`, `next.config.ts` | only root static files skip the session check; no `X-Powered-By`; upload body limit matches 30 MB; Secure cookies + HSTS when the URL is https |
| Log intake | `app/api/csp-report`, `app/api/events` | trusted address, global cap, size check first, 50-event cap |
| Login | `app/auth/confirm`, `lib/actions/auth.ts`, `lib/rate-limit.ts`, `lib/queries/profiles.ts` | Origin check; server clears the reset flag; password change limited and ends other sessions; inactive profile = signed out; rate-limit key cap |
| Users and admin | `lib/admin/target-guard.ts`, `lib/actions/admin/users.ts` | who-may-change-whom rule extended to details, phones, groups; reporting line and phones admin-only; audit rows for phone changes |
| Mail server settings | `lib/validation/mail-host.ts`, `lib/actions/intake/channels.ts` | shortcut spellings of local addresses refused; changing host/user needs the password again |
| Intake | `lib/actions/intake/rules.ts`, `communication.ts` | regex length cap and nested-repeat refusal; notes need reviewer role |
| Reports | `lib/queries/reporting.ts`, `lib/forms/sections.ts` | technician-only fields hidden from requester-type viewers |
| Forms | `lib/requests/create-request-core.ts` | requester answers only requester-settable fields |
| Previews | `components/admin/RichEmailEditor.tsx`, `lib/attachments/xlsx-preview.ts`, `lib/storage/publicPath.ts` | preview built from clean editor HTML; spreadsheet really unpacked with a hard limit; path regex fixed |
| Misc | notifications / profile / push / knowledge-base actions; approval reminder route | database error text sanitised; `sampleTo` only at the company mail domain |

## 4. Tests changed (not weakened) and tests added
Old assertions that encoded the old rules were updated to the new rules with the reason in the test name: `20-db-critical` (ticket creation is by the server; only the server clears the reset flag), `40-db-high` (technician cannot set priority; can still edit), `118-status-transitions-db` (a non-status edit uses description), `113`, `114`, `90` (priority actions removed earlier), `header-trust` (image-looking nested paths now need a session), `csp-report` (mock), `approval-email-link` / `110` (code read from the body). Nothing was deleted to turn a result green.
Added: `tests/vapt/10`, `11`, `12`, `90` (exploit tests, e-mail participant, performance), `tests/unit/vapt-hardening-units`, `approval-code-burst`, `xlsx-zip-bomb`, `no-priority-change` (earlier), plus the support scripts in `tests/vapt-support/` (UAT users).

## 5. Tooling added
`vitest.vapt.config.ts` (runs only through the isolation gate), `security-assessment-2026-10/02-VAPT/work/build-and-start-audit-app.ps1`.

---

# PART 6. STATUS OF EVERY FINDING

_Source file: `05-REMEDIATION/00-FINDING-STATUS-TABLE.md`_

# 00 — Authoritative status of every finding (maintained by the lead tester; the master register is generated from this)

Evidence key: **L-before/L-after** = reproduced on the isolated audit stack before the fix and blocked after it (test file named) · **CODE** = proven by reading code/catalog, fix verified by test or review · **LOGIC** = proven at function level (no mailbox/Gmail available) · **NOT-VERIFIED** = could not be verified here.
Test files: `tests/vapt/10-confidentiality-exploits.test.ts` (T10), `tests/vapt/11-integrity-exploits.test.ts` (T11), `tests/vapt/12-email-reply-participant.test.ts` (T12), `tests/unit/vapt-hardening-units.test.ts` (TU), `tests/unit/approval-code-burst.test.ts` (TB), HTTP probes against the rebuilt audit app (H, logged in `02-VAPT/04-MANUAL-PENETRATION-TESTING.md`), migration `supabase/migrations/20240101000164_vapt_security_hardening.sql` (M164).

## A. Found by this assessment, fixed in LOCAL
| ID(s) | Severity | Plain-language problem | Fix | Evidence |
|---|---|---|---|---|
| VAPT-DEP-01 (framework) | **Critical** | The web framework (Next.js 16.2.9) has 16 published security advisories incl. unauthenticated remote code execution on Windows hosts (GHSA-p293-qw3h-jr36, CVSS 9.0, fixed in 16.3.3) and an image-optimizer RCE (AVIF; not reachable here: AVIF not enabled, remote URLs refused — H). Production is a Windows host reachable from the internet. | upgraded to 16.3.8 (+ `eslint-config-next`, `npm audit fix`): production-dependency criticals 1 → 0 | `npm audit --omit=dev`: before 9 (1 critical, 5 high, 3 moderate) → after 2 moderate (exceljs→uuid, no fix without downgrade); tsc/lint/unit/build OK |
| VA-DB-02 / VA-TKT-01 (insert part) | High→Medium | A signed-in user could create a ticket straight in the database with any priority, service and team, skipping the form and SLA. | M164 drops direct INSERT; the server creates tickets (`useAdminForWrites: true`) | T11 L-before/after |
| VA-DB-01 / VA-TKT-01 (priority + SLA part) | **High** | The "nobody may change priority" rule was only in the screens; a technician or manager could set priority or push SLA deadlines a year ahead with one direct call. | M164 trigger refuses priority change, and SLA/pause-ledger change unless the status changes in the same update; due dates now in the System Log | T11 L-before/after (3 exploit tests) |
| VA-INT-01 / VA-TKT-04 / VA-DB-06 (part) | Medium | A file attached to an internal note was stored as normal: the requester could list/download it (and see its name in PDF/history). | `uploadAttachment` copies the internal flag; M164 back-fills old rows and tightens the file-store read rule (org + internal) | T10 L-before/after |
| VA-INT-03 / VA-TKT-03 | Medium | The start of an internal note was sent by bell/e-mail to collaborators of any role and to @mentioned colleagues who could not open the ticket. | recipients filtered to staff for internal notes; mentions only to people who may read | T10 L-before/after |
| VA-INT-13 / VA-DB-07 (mobile numbers) | Medium | Every employee could read all colleagues' mobile numbers; a manager could attach a number to anyone. | M164: own row or staff; writes admin/platform owner only | T10 L-before/after |
| VA-INT-10 / VA-DB-05 (upload) | Low-Med | Any signed-in user could upload files straight into the task-attachments store, skipping the app's checks. | M164 drops the direct-upload policy | T10 L-before/after |
| VA-API-02 / VA-DB-04 / VA-ADM-02 (flag part) | High→Medium | A user could switch off their own "must change password" flag. | M164 removes the column right and the trigger refuses any client change; the server clears it after a real password change | T10 L-before/after; remediation tests updated |
| VA-DB-03 (4 tables) | Medium | The database let a manager change services, SLA policies, global SLA config and field SLA overrides, which the screens reserve for administrators. | M164: admin/platform owner only | T11 L-before/after |
| VA-INT-02 | Medium | An e-mailed reply was accepted from any employee (or any staff of any OEM) for any ticket number. | sender must take part in the ticket (requester, assignee, collaborator, its group, manager, or the OEM it was sent to) | T12 LOGIC |
| VA-INT-05 / VA-ADM-07 | Medium | OEM e-mail template preview rendered raw stored HTML (stored XSS from manager to admin). | preview built from the editor's schema-clean HTML | CODE (browser render not run) |
| VA-INT-06 | Low-Med | The approval one-time code was in the e-mail subject and therefore in the Event Log. | code only in the body | TU + updated integration tests |
| VA-INT-09 | Low | No protection against automatic replies / loops. | outbound `Auto-Submitted`/`X-Auto-Response-Suppress`; inbound auto-replies skipped | CODE |
| VA-API-04 | Medium | Any path ending .png/.svg skipped the proxy's session check and body-size guard. | root-level static files only | TU + `header-trust` test + H |
| VA-API-07 / VA-INT-08 / VA-ADM-08 | Medium | Unauthenticated callers could flood the System Log through `/api/csp-report` (forged X-Forwarded-For). | trusted address only, global cap, size check first; events capped to 50 | H: 120 forged reports → 120 rows before, 30 after |
| VA-API-08 | Low | Login CSRF on `/auth/confirm`. | Origin/Sec-Fetch-Site check | H: cross-site POST processed before (303), refused after (403); same-origin works |
| VA-API-09 | Low | Deactivated person's open session kept working in the app until token expiry. | app treats inactive profile as signed-out; password change ends other sessions (DB already denied RLS access: `current_org_id()` requires is_active) | CODE |
| VA-API-10 | Low | `?sampleTo=` could mail real approval links to any outside address. | only the company mail domain | CODE |
| VA-API-14 / VA-INT obs. 3 | Info | `publicPath.ts` regex lost its backslash (`.` matched any character); framework header `X-Powered-By` sent. | `String.raw`; `poweredByHeader:false` | TU, H |
| VA-DB-11 / VA-TKT-13 (counter) | Low | Parallel wrong guesses of the approval code were counted as one try. | counted atomically; losing the race = lock | TB (20 parallel guesses: 20 accepted before → ≤4 after) |
| VA-ADM-01 | Medium | The saved intake-mailbox password could be redirected to any server by changing the host. | host change/port/user change needs the password again; host validated | CODE |
| VA-ADM-04 | Medium | Report Builder showed technician-only form fields to the requester. | filtered for own/reports scopes | CODE |
| VA-ADM-05 | Medium | A manager could edit administrators, attach mobile numbers, set reporting lines and add anyone to technician groups. | `targetGuardError` extended (profile/phone/teams); reporting line and phones admin-only; audit rows | TU |
| VA-ADM-10 | Low-Med | Admin-typed regex run on stranger mail could hang the worker (ReDoS). | length cap + nested-repeat refusal | CODE |
| VA-ADM-11 | Low | Any signed-in user could add notes to intake mail threads. | reviewer roles only | CODE |
| VA-ADM-14 / earlier D-026 | Low | `127.1`, `0177.0.0.1`, `0x7f.0.0.1` passed the mail-server check. | stricter numeric-form check | TU |
| VA-TKT-05 | Medium | "Submit for approval" picked any workflow (often another ticket's ad-hoc route) and a requester could start it. | no default workflow; staff only; `requested_by` recorded | CODE |
| VA-TKT-06 (name) | Medium | Ad-hoc workflow names contained ticket titles. | name is now "Ad-hoc approval <ticket no>" | CODE (reading rights of all employees: see B) |
| VA-TKT-08 | Medium | A requester's new ticket stored any form keys, incl. technician-only fields (bypassing the technician gate / SLA tier). | requester-settable fields only | CODE |
| earlier D-039 | Medium | 256 KB cap on public forms skipped for .png-like paths. | fixed with VA-API-04 | TU |
| observation (upload size) | Medium (plausible) | With `proxy.ts`, Next buffers request bodies up to 10 MB by default; a 10–25 MB attachment may be cut. | `proxyClientMaxBodySize: '30mb'` | NOT-VERIFIED dynamically (config change; confirm with a 20 MB upload in UAT) |
| VA-API-06 / VA-INT-04 | Medium | A crafted spreadsheet could declare 1 KB in its zip header but unpack to gigabytes when previewed (memory exhaustion of the single app process). | the preview now really unpacks each entry with a hard output limit shared by the whole file | `tests/unit/xlsx-zip-bomb.test.ts`: before the fix the file was fully unpacked by the spreadsheet reader (result "unreadable"); after: refused as too large without unpacking past the limit |
| VA-INT-07 | Low | The inbound-mail sender check accepted a DMARC pass for a different domain, and a message with two From lines could be attributed to the wrong person. | DMARC pass must match the sender's domain; two From headers = no sender | TU (LOGIC) |
| VA-TKT-16 | Low | Database error text (table/column names) was shown to the browser in notification, profile, push and knowledge-base actions. | `sanitizeError` used everywhere | CODE |
| VA-API-01 (part) | High | (HTTP/cookie flags need HTTPS — see B.) The code is now ready: session cookies are marked Secure and HSTS is sent as soon as the site URL starts with https; nothing changes over plain http. | proxy.ts, lib/supabase/server.ts, next.config.ts | CODE; login cookie confirmed readable by page scripts and non-Secure over http in the browser (H) |
| VA-API-03 (part) | Medium | Rate-limit keys unbounded; password-change check not limited. | key cap 200; change-password limited 5/10 min | CODE |

## B. Open, partially fixed, needs a decision, or not verified
| ID(s) | Severity | Status | Why / what is needed |
|---|---|---|---|
| VA-API-01 (+ D-018, D-037) HTTP, non-Secure cookie, report-only CSP | High | **Requires Decision** | needs HTTPS in front (reverse proxy + certificate) — a deployment decision; then `Secure` cookies, HSTS, enforced CSP |
| VA-API-02 / VA-ADM-02 (D-011) default password `<shared default password>` | High | **Requires Decision** | flag-clearing fixed; the default password and server-side enforcement beyond the page layout need an owner decision (random one-time passwords or invitation e-mails). **Production check: see whether any live account still has it.** |
| VA-TKT-01 / VA-DB-01 (rest) | Medium | Partially Fixed | a technician/manager can still change `assigned_to`, `description`, `form_data`, `resolved_at`, `closed_at`, `reopen_count`, category via the data API. Needs column-level grants (server-only writes) — design decision |
| VA-TKT-02 / VA-ADM-06 / VA-ADM-09 | Medium | **Requires Decision** | managers can author Business Rules (set priority/status/team) and workflow steps; intake reviewer can set priority at creation — conflicts with "nobody sets priority by hand" only if the owner wants it that way |
| VA-DB-03 (rest) / VA-ADM-03 | Medium | **Requires Decision** | ~20 other config tables writable by managers; global settings (business hours, holidays, priorities, app settings) writable by managers/admins through the app although the database says platform-owner only |
| VA-DB-06 (rest) / VA-DB-07 (rest) | Medium | Open | org test on comment/attachment INSERT policies; requesters can read org-wide staff list, team members, alert rules, workflows |
| VA-TKT-07 | Medium | Open | separation of duties closed only on the decide step (delegate / add approvers side doors) |
| VA-TKT-09 / VA-DB-10 | Medium | Open | project members, tasks insert, task attachment records: role-only policies |
| VA-DB-08 | Medium | **Not Verified** | self sign-up setting of the LIVE login service (local config enables it; production template disables it); every new account would land in the first organization |
| VA-API-05 | Medium | Open | one secret (`CRON_SECRET`) is the fallback for many purposes and can reach Microsoft in a URL; set dedicated secrets (deployment config) |
| VA-ADM-18 | Low | Open | Store Master upload parses a 5 MB spreadsheet in the web process (the same unpack limit should be applied there) |
| VA-API-03 (rest) | Medium | Partially Fixed | per-address limit needs `TRUSTED_PROXY_HOPS` set in production; lock-out policy is a design choice |
| VA-INT-11, VA-INT-12, VA-API-11, VA-API-12, VA-ADM-12, VA-ADM-13, VA-ADM-15/16/17, VA-TKT-10…12, 14, 15, 16, 17, 18, 19, 20, VA-DB-09, VA-DB-12 (rest), earlier D-025 | Low | Open | listed with fixes in the master register; none gives an outsider access to data |
| npm residual: uuid via exceljs | Moderate | Open (accepted) | only fix is a breaking downgrade of exceljs; vulnerable call (`uuid` v3/v5/v6 with a caller-supplied buffer) is not used by the app |
| Missing tools | — | Not Verified | Semgrep, Gitleaks, OSV-Scanner, ZAP, Nuclei, Burp are not installed; replaced by `npm audit`, targeted greps and the source reviews |

---

# PART 7. PERFORMANCE

_Source file: `05-REMEDIATION/03-PERFORMANCE-RESULTS.md`_

# 05 / 03 — Performance and stability (LOCAL, bounded synthetic workload)

Method: `tests/vapt/90-performance.test.ts` — 40 timed calls per operation after one warm-up, as real signed-in synthetic users against the audit stack (PostgREST with row security on), 3,000 synthetic tickets in one organisation. The same test was run with the previous database rules (rollback of migration 164 applied) and with the new rules. Raw: `perf-before-164.json`, `perf-after-164.json`. Milliseconds.

| Operation | P50 before → after | P95 before → after | P99 before → after |
|---|---|---|---|
| manager: list 1000 tickets | 4.6 → 4.7 | 6.0 → 6.6 | 7.1 → 6.8 |
| manager: count all tickets | 3.6 → 3.6 | 4.2 → 4.2 | 4.3 → 4.4 |
| technician: list own group tickets | 4.9 → 4.9 | 5.8 → 5.8 | 6.4 → 6.5 |
| requester: list own tickets | 4.9 → 4.8 | 5.5 → 5.1 | 6.3 → 5.3 |
| technician: edit a ticket (update trigger path) | 4.3 → 4.1 | 5.6 → 6.0 | 5.6 → 6.3 |
| requester: read attachment rows of a ticket | 2.6 → 2.7 | 3.6 → 3.3 | 4.0 → 3.5 |
| manager: title search | 2.5 → 2.0 | 3.1 → 2.5 | 3.5 → 2.7 |

Reading: no measurable regression; differences are within run-to-run noise (about ±1 ms). The extra trigger comparisons and the stricter policies cost nothing visible at this size.
Limits (stated honestly): one organisation, loopback network, 40 samples, no concurrent users, no file transfers, no authentication timing, no production load. The System Log now also records SLA due-date and pause-ledger changes on ticket updates (more audit rows on every resume/pause): the earlier audit warned that every audited ticket change takes one shared lock in the log chain, which could return as contention under heavy concurrency; this needs a load run on a production-like machine before release. The upgrade to Next.js 16.3.8 was not benchmarked separately (page rendering was not measured).

---

# PART 8. REMAINING TECHNICAL RISKS

_Source file: `05-REMEDIATION/04-REMAINING-TECHNICAL-RISKS.md`_

# 05 / 04 — Remaining technical risks (after the LOCAL fixes)

Source: `00-FINDING-STATUS-TABLE.md` section B (and the master register). Plain language; severity as the assessor's rating.

## A. Needs a management decision (cannot be fixed by code alone)
1. **The site is on plain HTTP** (High, VA-API-01, earlier D-018/D-037). Passwords and login cookies cross the network unencrypted. Needs a certificate and reverse proxy (or VPN). The code is now ready: once the site URL starts with https, cookies become Secure and HSTS is sent.
2. **Default import password** (High, VA-API-02, earlier D-011). A user can no longer switch the "must change" flag off, but bulk-imported users still start with one shared password. Decide: random one-time passwords or invitation e-mails. **Production check needed: whether any live account still has it** (only the owner can check; never test it against production).
3. **Priority / SLA writes for technicians and managers are only partly closed in the database** (Medium). They can no longer change priority or deadlines, but can still change the assignee, description, form answers and some timestamps through the data API. The clean fix is server-only writes for those columns (design work).
4. **Managers can author Business Rules and approval workflow steps; intake reviewers can set priority at creation** (Medium, VA-TKT-02, VA-ADM-06, VA-ADM-09). Whether that is intended is a business decision.
5. **About 20 other configuration tables, and global settings (business hours, holidays, priorities), are writable by managers/admins** (Medium, VA-DB-03 rest, VA-ADM-03). Decide who owns them.
6. **Confidentiality tier for HR/Finance tickets** (earlier D-005): managers and admins read every ticket in the organisation.

## B. Open technical items (fixes known, not yet built)
Medium: separation of duties through delegate / add-approver side doors (VA-TKT-07); project/task/task-file role-only policies (VA-TKT-09, VA-DB-10); org tests on comment/attachment insert policies and requester reading of org-wide staff data (VA-DB-06/07 rest); one secret used for many purposes and sent to Microsoft in a URL when no dedicated token is set (VA-API-05); sign-in throttling per address needs `TRUSTED_PROXY_HOPS` (VA-API-03).
Low: Store Master spreadsheet parse limit (VA-ADM-18); webhook design items; reset-mail timing; unaudited exports; home dashboard trusts caller flags; excess `anon` grants; web-push address check at the database; intake mail viewer remote-image blocking.
Accepted: `uuid` moderate advisory through `exceljs` (no non-breaking fix; vulnerable call unused).

## C. Could not be verified here
- **Self sign-up on the live login service** (VA-DB-08): the local config enables it; the production template disables it. If it were on in production, any stranger could create an account in the first organisation. Needs a read-only check of the live GoTrue setting by the owner.
- **Uploads of 10–25 MB**: Next.js buffers request bodies at 10 MB by default behind `proxy.ts`; the fix is a configuration change, not exercised with a real 20 MB upload.
- **Real e-mail/WhatsApp/OAuth behaviour** (reply spoofing against real Gmail headers, webhooks): proven at logic level only.
- **Production configuration** (Node version, `APPROVAL_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN`, `TRUSTED_PROXY_HOPS`, firewall exposure of the database/storage ports on the 8443 proxy).

## D. The most important production fact
Production still runs **Next.js 16.2.9**, which has published critical advisories (an unauthenticated remote-code-execution flaw on Windows servers rated 9.0, fixed in 16.3.3). Nothing from this assessment is deployed. This is the first thing to release (see `06-MANAGEMENT/05-RELEASE-PREREQUISITES.md`).

---

# PART 9. RELEASE PREREQUISITES

_Source file: `06-MANAGEMENT/05-RELEASE-PREREQUISITES.md`_

# 06 / 05 — What must happen before anything from this assessment goes to production

Status: DRAFT for management. Nothing in this folder has been pushed, merged, migrated or deployed. I will not do any of the steps below without your explicit approval for each one (project rule: test locally, get the owner's OK before every push/deploy).

## Step 0 — the urgent one (can be done on its own, before everything else)
**Upgrade the web framework on production (Next.js 16.2.9 → 16.3.8).** Why: the version in production has published critical flaws, including an unauthenticated remote-code-execution advisory for Windows servers (CVSS 9.0) — and production is a Windows server reachable from the internet. Conditions for that specific flaw are rated "high complexity" and no public exploit was tested here, but it should not wait for the rest of the work. This is an app-only release (no database change). It rides on the same normal release route used for the last deployment (build, zip, swap folder, health check, rollback folder kept). Because the upgrade is already inside commit `35922ad` together with the other fixes, you can either (a) release everything in Step 1–3, or (b) ask me to prepare a **separate, framework-only branch** (package files only) for an immediate release. Recommended: (b) first, then the rest.

## Step 1 — before the database migration
1. Take a fresh backup of `ckdesk` (`CK_Backup_CKDESK` or a manual `pg_dump -Fc`) and note its file name. (The earlier release used this procedure.) A restore test of that backup has never been recorded — do one on a spare machine if you can; it is also the best SOC 2 / ISO evidence you can create this week.
2. Read the live migration table on the database server (`auth.schema_migrations`) and confirm migrations 156–163 are applied (the repository cannot prove it). Migration 164 must go on top of 163.
3. Review `supabase/migrations/20240101000164_vapt_security_hardening.sql` and `supabase/rollback/164_vapt_security_hardening_rollback.sql` with the person who owns the database. The migration is idempotent and runs in one transaction; the rollback restores the previous rules.
4. Choose a quiet time. The migration removes the right to insert tickets directly (the server does it), the right to upload straight into the task-attachment store, and tightens several policies. **The new application code must be live before or together with the migration** (old code inserts tickets as the user and would fail after the migration). Release order: app first only if the old app keeps working with the old database (it does); then migration; then restart PostgREST (the schema cache) as in the earlier release notes. If you prefer one step: stop the app, run the migration, deploy, start.
5. Tell users nothing changes for them; do a smoke test with a test account: create a ticket, add an internal note with a file, resolve it, approve by e-mail link.

## Step 2 — release the application
Normal procedure in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` §4 (build with the production script, copy zip, swap the standalone folder, keep the rollback folder, check `/api/health` and `/api/version`). Extra checks for this release: sign in as a technician and confirm priority is a plain badge; send a test e-mail approval (code arrives in the mail body, not the subject); upload a 15–20 MB attachment to confirm the upload-size setting works (never fully tested here).

## Step 3 — configuration changes that are not code
- Set `TRUSTED_PROXY_HOPS` correctly (so sign-in is limited per address), and set separate `APPROVAL_LINK_SECRET`, `CSAT_LINK_SECRET`, `INTAKE_WEBHOOK_TOKEN` values (so one leaked secret does not open everything).
- Confirm on the live login service that self sign-up is **disabled** (`GOTRUE_DISABLE_SIGNUP=true`) and the minimum password length is at least 8.
- Decide HTTPS (a certificate and a reverse proxy, or keep access to the LAN/VPN only). When the site URL becomes https, set `NEXT_PUBLIC_APP_URL` to the https address and rebuild: cookies become Secure and HSTS is sent automatically.
- Check whether any live account still uses the shared default import password and force a reset if so (do not test it by signing in; ask the user admin to check the user list or reset those accounts).

## Rollback
Application: rename the saved `standalone-bak-…` folder back and start the service. Database: run `164_vapt_security_hardening_rollback.sql` (it restores the previous rules; it does not undo the harmless TRUNCATE/TRIGGER/REFERENCES revoke or the internal-flag back-fill). An application rollback never reverses a database change.

## Decisions I need from you before the release
HTTPS (yes/no/VPN), the default import password policy, whether managers may author Business Rules and workflow steps, and whether the remaining partly-closed ticket-edit rights should be tightened in this release or a later one (see `05-REMEDIATION/04-REMAINING-TECHNICAL-RISKS.md`).

---

# PART 10. TEST FILES AND HOW TO RUN THEM

| Test file | Proves |
|---|---|
| `tests/vapt/10-confidentiality-exploits.test.ts` | internal-note files and alerts, mobile numbers, direct uploads, reset flag |
| `tests/vapt/11-integrity-exploits.test.ts` | priority, SLA dates, forged tickets, config tables |
| `tests/vapt/12-email-reply-participant.test.ts` | who may reply to a ticket by e-mail |
| `tests/vapt/90-performance.test.ts` | latency before/after |
| `tests/unit/vapt-hardening-units.test.ts`, `approval-code-burst.test.ts`, `xlsx-zip-bomb.test.ts` | pure-code regressions |
| raw logs | `05-REMEDIATION/final-*.log`, `perf-*.json` |

Run (always through the isolation gate): `powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10/guard/run.ps1 npx vitest run --config vitest.vapt.config.ts` (also `vitest.remediation.config.ts`, or no config for the default suite).
