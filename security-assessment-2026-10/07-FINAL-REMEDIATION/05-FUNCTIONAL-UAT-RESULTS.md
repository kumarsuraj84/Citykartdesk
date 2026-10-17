# 05 — Functional UAT results (final)

LOCAL ONLY. All browser steps were done on the disposable test copy (`http://localhost:3310` / `127.0.0.1:3310`, built from the final code, database in the **release-path state**: migrations 0–163 + live's rights + 164 → 171) with **synthetic users and synthetic data only**. Nothing was done on the live system, and **no dummy data was added to live**. Test passwords were taken from the project's own test fixtures and are not shown here. The browser pane was narrow (phone width, about 583 px), so every screen below was seen in the **mobile layout**; the desktop layout is covered by the automated suites and the earlier browser pass (see "Not repeated").

Legend: **Pass** = expected result observed · **Pass (auto)** = covered by an automated test that ran green on the final code (named) rather than by hand in the browser · **Not repeated** = verified earlier in this assessment on the previous build of the same code and not re-done on the final build.

## 1. Browser walkthrough on the final build

| # | Role | Action | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Requester | Sign in | Home loads | Home (mobile) with counts, My Requests, quick actions | Pass |
| 2 | Requester | Open My Requests | Only own ticket listed | 1 ticket (own) | Pass |
| 3 | Requester | Open own ticket | Conversation, details; no internal items | Shown; PDF link states internal notes are not included | Pass |
| 4 | Requester | Post a reply | Reply stored, counters update | Posted; Conversations 1; History 1 | Pass |
| 5 | Requester | History tab | Shows "left a comment" with names, no internal items | "D03 Requester A left a comment" | Pass |
| 6 | Requester | Submit a new request, **double-click Submit** | One ticket only | One ticket created (CKSD-004780); the ticket-number counter skipped one number (4779), harmless | Pass |
| 7 | Requester | Edit own name to a technician's name | Refused | Red message: "That name is already used by a member of staff. Please use your own name." | Pass |
| 8 | Technician | Sign in | Queue shows the assigned ticket | My Queue = 1, notification from the requester's reply | Pass |
| 9 | Technician | Open the ticket, "Start Working" | Status → In Progress; automatic public message to requester | Done; message "has started working on your request" posted | Pass |
| 10 | Technician | History tab | Status change recorded with name | "updated the status Open → In Progress" | Pass |
| 11 | Technician | Actions menu | "Send for Approval" available | Present | Pass |
| 12 | Admin | Sign in; home | Dashboard with regional counts | Loaded (North 1544 open etc.) | Pass |
| 13 | Admin | Users | 336 users listed with roles and filters | Loaded | Pass |
| 14 | Admin | Platform Settings | Retention table | Loaded | Pass |
| 15 | Admin | Technician Groups | Groups with member/service counts | Loaded (7 groups + test groups) | Pass |
| 16 | Admin | System Log | Log page with tabs and time filters | Loaded | Pass |
| 17 | Admin | Knowledge Base | Empty list and "New Article" | Loaded | Pass |
| 18 | Admin | Analytics & Reports | KPIs, group filter, tabs, Export, Scheduled | Loaded | Pass |
| 19 | Admin | Intake Intelligence | Counters and pipeline | Loaded (0 / 0 / 0, 1 channel configured) | Pass |
| 20 | All | Console and network during the sweep | No new errors | No new console errors in the fresh sweep; all page requests 200 (aborted prefetches are normal). Earlier errors came from a stale cached page of the previous build (it asked for a style file hash that no longer exists) | Pass |
| 21 | All | Sign-in as each role; sessions separate | Different users on different addresses | Works | Pass |

Observation (not a defect): in the phone-width layout the sign-out control sits in the navigation drawer ("More", bottom-right icon), not on the profile page; it works.

## 2. Journeys covered by automated tests on the final code (all green)

| Journey from the assignment | Covered by | Result |
|---|---|---|
| Login, forgot/reset password, forced password change, invitation | `tests/vapt/25`, `30`, `tests/unit/one-time-password`, `auth-throttling`, default suite | Pass (auto) |
| Ticket creation, forms, service rules, SLA, assignment | default suite (integration), `tests/vapt/20`, `24`, `11` | Pass (auto) |
| Comments, internal notes, attachments, History for requester vs staff | `tests/vapt/10`, `24`, `27`, `22` | Pass (auto) |
| Approvals (e-mail link and code, separation of duties, delegation) | `tests/vapt/21`, `25`, `tests/remediation/110` | Pass (auto) |
| Platform Settings switches, permission matrix, Business Rules | `tests/vapt/23` | Pass (auto) |
| Knowledge Base, reports, exports (audit and limits) | default suite, `tests/vapt/26`, `fixed-reports` | Pass (auto) |
| Projects and tasks, project privacy | `tests/vapt/22`, default suite | Pass (auto) |
| OEM and store routing; e-mail / WhatsApp intake with mocks | default suite (OEM, conversation, inbound tests), `tests/vapt/25` (webhooks) | Pass (auto) |
| System Log writing and hash chain | `tests/remediation/102`, `103`, `tests/vapt/91` | Pass (auto) |
| Double-submit protection, retry, simultaneous updates, 20 simultaneous comments | `tests/vapt/28` | Pass (auto) |
| Webhook replay, spoofing, challenge limits | `tests/vapt/25` | Pass (auto) |
| Upload size limits (10/15/20/25 MB, 26 MB refused) | verified by hand earlier; limit set in `next.config.ts`; unit tests for validation | Not repeated on final build |
| Second organisation sees nothing of the first | `tests/vapt/29` (every table with an organisation id) | Pass (auto) |
| Failure recovery: scanner configured but unreachable → upload refused; e-mail to OEM fails → ticket stays open with a note | `tests/vapt/26`, `tests/remediation/116` | Pass (auto) |

## 3. Not repeated on the final build (done earlier in this assessment, same code)

Platform owner opening Platform Settings and saving a policy switch (saved and written to the audit log); large uploads (10/15/20/25 MB stored, 26 MB refused). These were passed in the browser on the previous build; the code paths have not changed since and their automated tests ran green again. The mandatory reason for re-classification is covered by automated tests only (`tests/vapt/27`, `24`), not by a hand run in the browser.

## 4. Not tested

Desktop-width layout by hand on the final build; manager screens by hand (covered by automated tests); real Gmail/Outlook/WhatsApp; real printing/PDF viewers; any live-system flow (by rule, no test data on live).

## 5. Defects found in this UAT

None in the application. One harness issue (the rehearsal script's empty snapshots) and one release finding (live rights broader than expected → migration 171) were found earlier in the same assessment and are recorded in `02-…` (NEW-004, NEW-005).
