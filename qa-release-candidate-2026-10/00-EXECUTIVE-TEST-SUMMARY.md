# 00 — Executive test summary

**Application:** Citykart Desk (CKDesk) · **Date:** 26 Oct 2026 · **Where:** this PC only, on an isolated copy with synthetic data · **Branch:** `qa/release-candidate-2026-10` (local; no push, `main` untouched, no live access) · **Decision: B — LOCAL QA CONDITIONAL** (report 19)

## 1. Testing scorecard (from real runs)

| Category | Executed | Passed | Failed | Blocked | Not tested | Where |
|---|---|---|---|---|---|---|
| Unit | 1,593 tests | 1,593 | 0 | 0 | coverage % not measured | 04 |
| Integration (real DB/auth/storage) | 615 tests (393 project + 181 remediation + 41 new QA) | 615 | 0 | 0 | 18 skipped (WhatsApp, out of scope) | 05 |
| System / end-to-end | 8 journeys, 21 logged steps | 21 (Journey 8 partial) | 0 | 0 | admin create/edit screens by hand | 06 |
| Smoke / sanity | 54 routes + 7 fix checks + probes | all | 0 | 0 | — | 03 |
| Regression | 2,431 tests in one run | 2,413 | 0 | 0 | 18 skipped | 07 |
| UAT (tester acting as each role) | 28 scenarios | 26 (+1 usability comment) | 0 | 0 | 1; **real stakeholder sign-off: pending** | 08 |
| Performance | 3 data sizes (3k / 100k / 500k), 12 reads + 11 workflows each | all ran, 0 errors | 2 observations (D014, D015) | 0 | browser-level load of many users | 09 |
| Security | 386 security tests (205 + 181) + 12 live probes | all | 0 now (4 real defects found and fixed along the way) | 0 | credential attacks, fuzzing | 10 |
| Compatibility | 3 (desktop Chromium, phone size, tablet size) | 3 | 0 | 0 | Edge, Firefox, Safari, real devices, mail clients | 11 |
| Usability / accessibility | 17 pages with axe + journeys | 15 pages clean after fixes | 4 pages show only the grey token (D013) | 0 | screen reader, keyboard-only walk | 12 |
| Automation / workflow | 15 behaviours | 14 | 0 now (D018 fixed; D014 open) | 0 | 4 (alerts job, scheduled rules, field SLA, push) | 13 |
| Failure recovery | 8 fault tests (REST, DB, sign-in, storage, app restart, interrupted jobs, overlap, burst) | 8 (two after a fix) | 0 now | 0 | power cut, disk full, backup restore | 14 |

Feature coverage (report 02): of the 155 features, **141 PASS**, **7 NOT TESTED**, **7 OUT OF SCOPE** (not built yet), **0 FAIL, 0 BLOCKED**.

## 2. Defects (report 15)

| | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| Found | 0 | 1 | 9 | 9 | 19 |
| Fixed and re-tested | 0 | 1 | 8 | 6 | 15 |
| Open (your decision) | 0 | 0 | 1 | 3 | 4 |
| Blocked / reopened / regressions | 0 | 0 | 0 | 0 | 0 |

The ones that matter most:
* **P1 — managers could change category switches** (e.g. switch off CVM approval) through the data interface. Fixed by migration 185 — **must be applied to live**.
* **P2 — password in the web address** on a very early sign-in submit. Fixed.
* **P2 — the audit-log integrity check stopped after 500,000 rows but said "all intact".** Fixed.
* **P2 — round-robin gave a whole burst of tickets to one technician.** Fixed.
* **P2 — AC PMS tickets were not routed to the vendor technician.** Fixed.
* **P2 — two sheet updates at once could clash.** Fixed.
* **P2 — sign-in outage told people "wrong password".** Fixed. (and storage outage said "not found"; vendor phone menu; many accessibility names)
* **P2, OPEN — Next.js has critical security advisories; upgrade to 16.4.3 recommended** (needs your OK).

## 3. What this means for the business (simple language)

* **Daily work is safe.** A store can raise a ticket, a technician can work it, pause its clock, resolve it; the store rates it; the system closes it by itself. Vendors can do the whole repair story — parts, quote, revised price, PO with number and document, report — and every step asks for what it needs. The approver sees the store's earlier requests with quantities before deciding. Numbers on the dashboard agree with the database to the ticket.
* **It copes with breakdowns.** When the database, the data service, the sign-in service or the file store was stopped for a minute, nothing was lost and the system came back by itself. Two messages were wrong during outages ("wrong password", "file not found"); fixed.
* **It handles growth.** Up to 100,000 tickets everything is quick; at 500,000 two screens (manager queue, executive dashboard) become slow. Today's size is far below that.
* **Before going live, three things must be done:** upgrade Next.js (security), apply migration 185 on the live database, and let real users sign off the checklist. A quick look on a real phone, Edge and Firefox is also advised.
* **Nothing was touched on live or on `main`.**

## 4. Open decisions for you

1. Approve upgrade to Next.js 16.4.3? (D005, recommended)
2. Change the grey text colour token a little darker so small grey labels pass the 4.5 : 1 rule? (D013)
3. Add a rule so one approval cannot be decided twice at once (needs a small migration and a clean-up of old duplicate rows on live)? (D014)
4. Tune queue and dashboard for more than 100,000 tickets — now or later? (D015)
5. When to apply migration 185 to the development and live databases, and who signs UAT (report 08).

## 5. Reading order

19 decision → 15 defects → 18 not tested → 10 security → 09 performance → 06 journeys → the rest. Evidence is in `evidence/`.
