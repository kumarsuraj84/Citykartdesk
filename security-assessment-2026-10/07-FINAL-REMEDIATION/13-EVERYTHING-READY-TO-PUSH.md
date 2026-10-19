# 13 — Everything that is ready to push (one page)

LOCAL ONLY until the owner says "commit, push to git and main". Production today = `main` = `717e5c6` (build 20261015-145217). Nothing below is on main, pushed or deployed. No test or dummy data was added to live.

## The packages

| # | Package | Branch (local) | Commits on top of main | Database changes | Goes live |
|---|---|---|---|---|---|
| **A** | **Security release** (framework + all fixes) | `release/security-remediation-final` | 19 | migrations **164 – 171** | **First.** App first, then migrations 164 → 171 one by one |
| **B** | **OEMs by type: AC and Genset** (new feature) | `feature/oem-by-type` | A + 2 | migration **172** | **Later**, after A has settled. Migration 172 first, then the app |
| C | Framework upgrade alone (Next.js 16.3.8) | `release/p0-framework-next-16.3.8` | 1 | none | Not needed if A goes (A contains it) |

Why B is separate: it is a new feature and its code needs migration 172 to exist. Mixing it into the first release would add risk to a release that is already large. A is made forward-compatible with B (five queries now name the store's AC OEM link explicitly), so B can follow without any gap.

## A. What was fixed and changed (security release)

**70 reported weaknesses: 62 fixed and tested, 2 partly fixed, 6 waiting for your decision, 0 open.** In plain words:
- **Tickets can't be tampered with.** Only the server can write tickets, approvals, settings and priorities (the server checks the rules first). 45 tables lost direct write access for logged-in users; the anonymous role has no table rights at all.
- **Privacy.** Requesters no longer see internal notes, internal-note files, staff lists or other people's details; the History tab is built safely for them; mobile numbers, approval workflows and project data are limited to people who may see them.
- **Accounts.** No shared default password any more (random one-time password or invitation); the first password must be changed and the database enforces it; sessions end on password change; display names can't copy a staff member's name.
- **Approvals.** A requester or sender can never approve their own request (choose, add or delegate); approval codes are locked after wrong guesses; the link page shows nothing before proof.
- **Mail, WhatsApp and webhooks.** Faked, repeated or oversized messages are refused; mail HTML is cleaned; the mail worker checks TLS certificates.
- **Files.** Office files with macros refused; upload limits per person; spreadsheet zip bombs stopped; scanner connector (no scanner installed yet).
- **Abuse limits.** Password guessing and spraying throttled, public endpoints rate-limited from shared counters, exports audited and limited, health route cached.
- **Correct behaviour.** Double-click on Submit gives one ticket; re-classification needs a written reason; duplicate request goes through the normal creation path; errors no longer leak database text.
- **Six owner switches** (global settings, Business Rules, workflow editing, intake priority, outside invitations, report recipients) — all default to today's behaviour; you decide later.
- **Framework.** Next.js 16.2.9 → 16.3.8 removes 9 known serious weaknesses (production audit 0).
- **Database.** 8 migrations (164 – 171), each with an exact tested rollback; migration 171 was added after comparing the live database with my test copy (live gave logged-in users extra write rights on 26 tables).
- **Reports and tools.** 13 reports in `security-assessment-2026-10/07-FINAL-REMEDIATION/` (closure matrix of all 70, retest, UAT, performance, ISO 27001 / SOC 2 readiness drafts, decisions, release plan, rollback plan, release gate), read-only live-check scripts and comparison tools.

**Tested:** default suite 1,820 · remediation 184 · VAPT 130 passed (also on a database laid out like production's real starting point and rebuilt from the live structure file); type check clean; lint 0 errors; browser walkthrough of requester, technician and administrator passed; 100,000-ticket performance run fine.

## B. What the new OEM feature does (separate release)

- Every OEM has a **type: AC or Genset** (all current OEMs become AC). Every store has **one AC OEM slot and one Genset OEM slot**: ALC can have Bluestar for AC and Cummins for Genset, and **cannot** have two AC OEMs (the database refuses it).
- Each **category** gets a setting "auto-send to the store's AC / Genset OEM". A Genset category sends one e-mail to the store's Genset OEM, adds a "sent to OEM" note and moves the ticket to **In Progress**; an AC category does the same for the AC OEM; the AC Issues service works as before; other categories stay normal.
- A store without the needed OEM → ticket stays open with an internal note. Nothing is ever sent to the wrong type of OEM.
- Screens: OEM type on create/edit; "Assign stores" names the stores it would replace and needs a second click; the store form has both OEMs; the Stores tab counts stores without each; Store Master Excel upload has a **GENSET OEM** column. Guide: `docs/OEM-BY-TYPE-GUIDE.md`.
- Tested: 15 new database/action/routing tests + unit tests; VAPT suite 145 passed.

## What is NOT included / still open

HTTPS (parked by you) · malware scanner for uploads · six policy decisions at today's defaults · ISO 27001 / SOC 2 organisation evidence (no certification claimed) · 500,000-ticket test (skipped by you) · ZAP scan · real mail/WhatsApp accounts.

## Push plan (needs your explicit "go")

1. Push **all branches** to GitHub as branches (backup and review): A, B, C.
2. Move **`main` to package A only.** Package B stays on its own branch until A is live and stable.
3. Deploy A to 10.0.1.98 as in `10-PRODUCTION-RELEASE-PLAN.md` (app first with `ALLOW_SHARED_SECRET_FALLBACK=1`, watch a day, then migrations 164 → 171 one by one, restart the REST service after each). Read-only checks only on live.
4. Later: B (migration 172 first, then the app).

## Before the first live step (from you)

Old-shared-password count and live structure file (done: structure matches; count pending) · a backup you have restored once · decide about the 463 accounts with a pending first-password change · your written OK for each step.
