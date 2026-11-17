# 17 — Local Release-Readiness Verdict

## Verdict: **CONDITIONALLY READY FOR OWNER REVIEW**

In plain words: the **local code is in good shape and the small set of fixes (accessibility, the two things you reported in the conversation box, one report fix, test corrections) can go to your review.** It is "conditionally" ready because five things are still open or unproven (below). None of them is a stop-everything problem found in the code, but you should decide on them before or alongside a release. **Business sign-off is pending the owner / business.**

This is a local engineering verdict only. It is **not** a compliance or certification statement. Nothing was committed, pushed, merged or deployed.

## Why not "READY"
| # | Condition | Why it holds the verdict back |
|---|---|---|
| 1 | **Framework advisories** (Next.js 16.3.8 has 2 critical published advisories; also zod, nodemailer/mailparser, sanitize-html) — V-001 (P1) | Not reachable the way the app is set up, but a denial-of-service advisory cannot be ruled out. Needs its own upgrade branch and test pass. |
| 2 | **Real-world integrations were never exercised** | Live mail, WhatsApp, Google/Microsoft mailbox sync, DeskTime, Google Sheet API, Web Push and the real CKOneAI machine were blocked on purpose. |
| 3 | **Other browsers and real phones not tested** | Only Chrome 157, Edge 157 and emulated phone/tablet widths. Firefox, Safari/iOS, real Android: NOT TESTED. |
| 4 | **Live settings could not be read** (no production access) | `TRUSTED_PROXY_HOPS`, whether the live build carries the staff e-mail CSV (F-007), vendor PO approver, mail-failure alerting. Each is a one-minute read-only check that needs your OK. |
| 5 | **Scale** | Fine at today's size. Executive dashboard (18.6 MB) and Admin Reports become slow from about 100,000 tickets and above (PERF-001/002); a bulk import of old open tickets would slow the scheduler (PERF-004). |

## Why not "NOT READY"
- **0 blocker (P0) defects.** No way was found to read another person's data, become an administrator, or run script through typed text (21 black-box probes, a 136-table data-boundary check, 37 API routes).
- The whole existing automated suite passes after the last change (table below), and the new tests pass.
- All 9 business scenarios A–G ran to completion at the software boundary (74 of 77 checks; the rest BLOCKED or NOT RUN with a reason).
- Failure recovery held: database, data gateway, sign-in service and file storage were each stopped on purpose; the app stayed up and recovered by itself (7 of 7).
- 17 items were fixed locally, each with a regression test (fail-first for the product fixes).

## Final regression, after the last code change
| Layer | Result |
|---|---|
| Isolation gate | PASSED 21 of 21 before each run |
| `tsc --noEmit` | 0 errors |
| `eslint` | 0 problems |
| Unit | 2,424 pass, 2 skipped (opt-in speed tests) |
| Integration (real local database) | 402 pass, 18 BLOCKED (need the real WhatsApp catalogue) |
| Remediation | 181 of 181 |
| VAPT | 410 of 410 |
| Browser accessibility regression | 21 of 21 pages clean (run earlier in this audit; no product code has changed since) |

Honest note about the final run: the first time round, 2 integration tests and 4 remediation tests failed. The cause was **my own leftover test data** (100,000 synthetic load-test tickets in the audit database, above the dashboard's 30,000-ticket cap). I removed the synthetic tickets and re-ran: all passed. This is a test-hygiene lesson, not a product defect.

## Open items by importance (full list in 15 and 16)
1. V-001 (P1): plan the framework upgrade and release it separately.
2. P2 open (10): PERF-001, PERF-002, PERF-004, V-002, V-003, V-006, V-008, V-010/SOC-G3, SOC-G1, SOC-G2.
3. P3/P4 open (about 21) and process notes H-1…H-3, F-007, F-008.
4. Owner decisions 1–10 in report 16.

## What I recommend you do next (you decide each step)
1. Read 01 (summary), 15 (defects) and 16 (decisions).
2. Decide whether to take the **small fix set** first (Templates list closing on outside click; paste/drag-and-drop attach; accessibility fixes; report field fix; test corrections) as separate commits — see 18.
3. Ask for the **one-minute read-only checks on live** (item 4 above) if you want them.
4. Plan the framework upgrade branch and a staged integration test with test accounts.
5. Arrange a short manual pass on Firefox, an iPhone and an Android phone.

## Items to be aware of in your own files and folders
- Stray folder **`D:\ANKUR%20AI PROJECTS`** (created by my early smoke screenshots; the safety check refused to delete it — you can delete it).
- The audit database and the folder `evidence/db/` (73 MB snapshot) are local only; do not commit them.
- The audit apps on ports 3310 and 3311 are stopped. The tool side-effects in `audit-2026-10/evidence`, `AGENTS.md`, `tsconfig.json` were restored; re-check `git status` before any commit.
- `npm run verify` runs unit tests only — all four layers should be on the release checklist.
