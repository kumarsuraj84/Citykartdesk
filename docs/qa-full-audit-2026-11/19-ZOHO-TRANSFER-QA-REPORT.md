# 19 — Zoho → CK Desk Transfer: Stage 4 Local QA Report

> Local only, on the isolated audit stack with made-up data. **Nothing was committed, pushed, merged or deployed, and the live servers were not changed.** The only live contact was **read-only**: counts on the live Zoho copy and a read-only call of Zoho's API on one real approved ticket (both done earlier in stages 2–3).
> Business sign-off of the transfer rules (mapping, who becomes inactive, which tickets move first) is **pending owner / business sign-off**.

## Verdict: **READY FOR OWNER REVIEW — stage 5 (live) needs your word and four decisions**
Everything the owner asked for works and is proved by tests. QA found and fixed **4 defects** (1 P2, 2 P3, 1 P4). It also confirmed **1 earlier open defect** (role-based alerts send nothing: ALERT-001, an owner decision). No P0 and no P1.

## What was asked, and the proof (traceability)
| # | Owner's requirement | Proof | Result |
|---|---|---|---|
| 1 | Move by requester / status / template / technician / ticket number / dates, singly or everything that matches | filters + "Move everything that matches" (25 at a time, Pause / Stop, run record); `zoho-transfer-run` tests; hostile-filter test; real-browser run | PASS |
| 2 | Mark moved tickets in the Zoho tab | Overview card, "Moved → ZOHO-…" in the list and on the ticket, Moved filter; real-browser check | PASS |
| 3 | CK Desk number = `ZOHO-` + the Zoho number exactly as Zoho has it | unit (5 number cases) + integration | PASS |
| 4 | Created time the same as Zoho | integration: to the second, in UTC | PASS |
| 5 | SLA from that created time, CK Desk rules for the rest | integration (deadline after created time; priority from CK Desk's rule) | PASS |
| 6 | Technician by CK Desk's Business Rules (open tickets) | integration: the rule chose the technician, nobody was told, status stayed as moved | PASS |
| 7 | Template → form template, template + category → service, sub category → category, item → sub category, requester, technician, status | 21 plan tests + real-browser mapping screens; manager sees it read-only | PASS |
| 8 | Conversation, **approvals** (who sent, who approved, when, the comment) as in Zoho | integration: every entry has its Zoho time and its person; approver found by e-mail; reminders and system lines kept out of the approval entries | PASS |
| 9 | Attachments | integration: copied when the folder is set, listed when not or missing | PASS (needs `ZOHO_ATTACHMENTS_ROOT` on 98) |
| 10 | No mail, WhatsApp, push or survey | notifications unchanged and mail trap empty after moving **10,000** tickets; automation recorded as finished so the 15-minute retry never mails | PASS |
| 11 | Old open tickets silent until switched on | scheduled-rule test: 0 notifications while silent, exactly one per open unassigned ticket (4,000) once switched on | PASS |
| 12 | A ticket can never be moved twice | unique claim; two administrators at the same moment | PASS |

## Test categories (this feature only)
| Category | Run | PASS | FAIL | NOT RUN | Notes |
|---|---|---|---|---|---|
| Unit | 44 | 44 | 0 | 0 | number, suggestions, plan (21), coercion (5), approval lines (5), silent guard (3), access rules (6), accessibility guards (4) |
| Integration (real local DB) | 30 | 30 | 0 | 0 | move 9, run 4, hard cases 8, Zoho unreachable 4, scale 5 (runs only with `ZOHO_SCALE=1`; run here). Five of the 30 are only "the demo data is there" checks |
| Real browser (Chrome + Edge) | 106 | 106 | 0 | 0 | 53 checks × 2 browsers: 10 pages × 3 widths (360 / 768 / 1366) with axe WCAG 2.0–2.2 A/AA + best practice, sideways scroll, console errors, three confirm boxes, manager read-only, requester / technician / vendor refused |
| Performance and scale | 5 | 5 | 0 | 0 | see below |
| Security (this feature) | 10 | 10 | 0 | 0 | access rules for all 9 actions × 5 kinds of person (6 cases, nothing touched), hostile filters, read-only Zoho reader, run record of another organisation refused, `ZOHO-` number only by the server (these are also counted in the unit / integration rows). The existing 410 security tests are in the regression row |
| Failure and recovery | 8 | 8 | 0 | 0 | stopped half way, rollback, claim in progress, Zoho unreachable, two at once |
| **Regression — the whole existing suite after the last change** | 3,507 | 3,486 | **1** | 20 | `tsc` 0 errors, `eslint` 0. Unit + integration 2,916 (2,895 pass, 20 skipped = NOT RUN, **1 failed**: a WhatsApp test that is not re-runnable, see H-4; it passes on a clean database), remediation 181 / 181, security 410 / 410 |
| NOT RUN | — | — | — | — | real Zoho attachment files (no real files here), live data, other browsers than Chrome and Edge, real phone |

## UAT H — the real mail path after a move (added after the owner asked "will CK Desk mail as it does for its own tickets?")
Real Chrome against the audit app; every mail goes to the local mail folder only. Script `uat/uat-h-mail-path.mjs`, evidence `evidence/uat/uat-h-mail-path.json` and screenshots. **11 PASS, 0 FAIL**, 3 observations.
| Step | Result |
|---|---|
| The move itself | **no mail, no notification** (counts unchanged); a Business Rule gave the tickets to the technician quietly |
| Ticket that was **In Process** in Zoho (arrives In progress) | **no "Start Working" button** — the technician just carries on |
| Ticket that was **Open** in Zoho | still shows Start Working; pressing it mails the requester ("Request updated: ZOHO-…") and posts the usual "started working" message |
| Technician writes a public comment | mails the requester, **ZOHO number in the subject**, plus a bell notification |
| Requester replies | mails the technician and rings the bell |
| Technician resolves ("Mark Resolved" with a resolution note) | mails the requester ("Resolved: ZOHO-…") |
| A reply to such a mail finds its ticket | unit tests on the real matching code: works for ZOHO numbers of 3–8 digits; a stranger copying the tag is still refused. **Known limit:** numbers of only 1–2 digits (the oldest, long closed tickets) are not recognised |
| **Observation:** a requester who was not in CK Desk (made an inactive profile by the move) | CK Desk **still mails that address** when the technician comments. For a person who left the company this mail may bounce or go nowhere. Owner decision: leave as is (recommended, rare) or stop mailing inactive profiles |
Meaning: after the silent move a moved ticket behaves like any CK Desk ticket for everything people do; only the automatic scheduled alerts stay off until you switch them on.

## Speed with a large set (made-up Zoho set of 10,000 tickets, audit stack on a fast PC)
| Step | Result |
|---|---|
| "Check what would move": read and plan **10,000** tickets | **0.3 s** |
| The preview query (200 tickets) | **15 ms** |
| **Move all 10,000 for real** (silent, with conversation, notes, history, approvals) | **6.8 minutes** — 41 ms per ticket, **about 1,470 tickets a minute**, 0 failed |
| One step of 25 tickets | typical 1.0 s, slowest 2.4 s |
| Database growth for 10,000 tickets | 34 MB (59,667 conversation entries) |
| Notifications / mail sent by the move | **0 / 0** |
| Scheduled rule run with 4,000 moved open tickets | **silent: 6.7 s, nobody told · switched on: 47 s, 4,000 notified** (about 12 ms a ticket) |
| Screens with 10,000+ tickets behind them (development mode) | overview 1.0–1.3 s · mapping 0.9–1.0 s · find a ticket 0.9–1.1 s · **preview of 200 tickets 2.5 s** |
Meaning: moving the whole live backlog is a matter of minutes, not days; the slowest part of using it is the 2.5 s preview. The live server is weaker than this PC, so expect it to be slower; run the same test once on live-like hardware before quoting a figure to the business.

## Defects found by this QA
| ID | Sev | Defect | Root cause | Fix and proof |
|---|---|---|---|---|
| QA-001 | **P2** | A server that stopped between taking a ticket and making it left the ticket **locked for ever** ("already moved" with no ticket behind it) | the claim row has no ticket until the end of the move | a claim with no ticket and **older than 10 minutes** is released (and shown as moved only while recent); `zoho-transfer-qa` test **failed first**, passes now |
| QA-002 | P3 | The three confirm boxes did not move keyboard focus into themselves and did not close on Escape | plain `<div role="alertdialog">` | `useAlertDialog` (focus on the harmless button, Escape closes, focus returns); browser check 3 × PASS; unit guard. *Found while writing the check; fixed before its first run, so there is no "failed first" log* |
| QA-003 | P3 | "N open" on the Zoho overview was amber-600 on white (contrast about 3.2:1, WCAG 1.4.3) | colour choice in the earlier Zoho tab | amber-700; browser check **failed first** (1 serious), passes now |
| QA-004 | P4 | Navigation landmarks had no names (32 moderate findings, app-wide) | `<nav>` without `aria-label` | "Main menu", "Quick links", "Zoho sections"; browser check **failed first**, passes now |
| H-4 | P4 (test hygiene) | `tests/integration/stage5-outbound-failure.test.ts` fails on its **second run** in the same database (it counts audit-log rows of a conversation that keeps the same id, so the previous run's row makes two). Not caused by this feature; passes on a clean database. Left unchanged | the test should delete its own audit rows (add to the release checklist: run it on a clean audit database) |
| (mine) | — | Two wrong expectations in my own number-list test and one false alarm in my browser script (a hidden form field) | test mistakes | corrected; not product defects |
Still open from earlier: **ALERT-001** (role-based alerts notify nobody; fixing it starts alerts on live: your decision, report 16).

## Not tested / limits
Real Zoho attachment files and the NAS path; live-hardware speed; browsers other than Chrome and Edge; a real phone; Zoho's real data (only the live **counts** and one read-only API call were looked at, no ticket was copied); what happens at the owner's real mapping (the audit mapping is a demo).

## What stage 5 (live) needs — only on your word
1. Decide: (a) when to switch moved tickets on for alerts and rules (default OFF), (b) the technician for finished tickets later, (c) ALERT-001, (d) pull Zoho's approval API too (optional).
2. Run migrations 196, 197, 198 on 205, restart CkDeskPostgrest on 98, deploy the app, set `ZOHO_ATTACHMENTS_ROOT` on 98 (if attachment files should come).
3. You do the real mapping on the Mapping screen, then move a **small batch**, look at it, then the rest.
Evidence: `evidence/perf-zoho/scale.json`, `page-timing.json`, `evidence/ui/ui-zoho.json` and `ui-zoho-edge.json`, `evidence/final/s4-*.log`.
