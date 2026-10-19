# 06 — Functional UAT

*Run on the isolated audit stack and the audit app (`localhost:3310`), as **synthetic** requester, technician, manager, administrator and platform-owner accounts. No production data, no real notifications. The accounts and the data created are listed in section 6.*

## 1. How the UAT was done (and what each method can and cannot show)

| Method | Used for | Limit |
|---|---|---|
| **Browser UAT** — the built-in browser as the real signed-in user, clicking and typing | sign-in, forms and validation, creating a ticket, comments, the technician's pick-up / start-work flow, an administrator creating an SLA policy, every page for every role, the mobile / tablet / desktop layouts | The browser tool cannot open a native file chooser, so **attaching a file in the browser UI was not clicked**; uploads were instead exercised through the application's own upload action with real files (document 08) |
| **Server-action UAT** — the application's own actions called with real signed-in sessions, row security on, every outcome checked in the database | the whole ticket lifecycle for all five roles, unauthorized and invalid input, concurrency (`tests/remediation/90-uat-lifecycle.test.ts`, 12 journeys) | Not a browser; the screen is covered by the browser method |
| **Existing integration suite** (419 tests, run in full) | approvals, CSAT, reopen, assignment RBAC, nudge, notifications, WhatsApp, intake, OEM, store master upload, copy/PDF, tenant isolation… | Third-party endpoints are stubbed |

## 2. Results by area

| Area | Result | Evidence |
|---|---|---|
| **Sign-in, wrong password** | **Verified.** A wrong password is refused with "Invalid login credentials", no detail leaked | browser |
| **Sign-in, return to the page asked for** | **Defect found and fixed** (UX): a deep link (`/services/it-laptop`) was dropped and the user always landed on Home. Now any in-site path is honoured (open-redirect-safe, D-034). Verified in the browser | browser + `tests/unit/safe-next.test.ts` |
| **Recovery / invitation links** | Redirect target is now in-site only (D-034): `next=//evil.example`, `https://evil.example`, `@evil.example`, `.evil.example` all go to `/home`; verified live against `/auth/callback` | live HTTP check |
| **Request form: required, length, optional, hidden fields** | **Verified.** Empty submit → "Asset tag is required. / Severity is required."; 2-character tag → "Asset tag must be at least 3 characters."; valid submit creates the ticket; the **technician-only** required field is hidden from the requester | browser, mobile screenshots |
| **Hostile text in a ticket** (`<script>`, a spreadsheet formula, SQL, quotes, backslashes) | **Verified.** Stored and shown as plain text; nothing executed; the ticket and table intact | browser + `90-uat-lifecycle` |
| **Ticket number** | New tickets get `CKSD-1099337`-style numbers (past one million after the D-069 fix) | browser |
| **Technician: queue, pick up, assign, start work** | **Verified.** Pick-up assigns (status Assigned, requester notified); "Start Working" is **refused while a technician-mandatory field is empty**, with the clear message "Fill in the required field before changing status: Technician note."; after filling it in, Start Working sets In Progress, stamps the first response and posts the automatic first reply | browser + DB |
| **Status flow** | Waiting-on-user needs a remark, pauses the clock, and the requester's reply resumes work; **Hold due to Purchase from HO** is technician-only, needs a remark, is **not** resumed by a requester reply, and needs its own remark to resume; resolve needs a note; requester can reopen (count incremented) | `90-uat-lifecycle` (12/12) |
| **Internal notes** | Not readable by the requester through row security; a requester cannot post one | `90-uat-lifecycle` |
| **Assignment by role** | Technician of the team, manager, administrator and platform owner can assign (cross-team for the last three); a requester and a technician of another team cannot | `90-uat-lifecycle`, `item6-assignment-rbac` |
| **Collaborators** | Added by a technician; the collaborator can then see the ticket | `90-uat-lifecycle` |
| **Notifications** | The requester is notified on assignment (written after the action returns, so the check waits briefly); bell and counters shown in the browser | `90-uat-lifecycle`, integration |
| **Tasks** | A technician creates, progresses, comments on and deletes a team task; a requester cannot create one | `90-uat-lifecycle` |
| **Approvals, delegation, e-mail approval links** | Covered by the integration suite (approval-bell-list, approval-email-link, approval-first-response-decides, approvals-page-scope, d03/d04 authorization) plus the new D-016 delegation test against the real database | integration + `30-delegate-approval` |
| **SLA** | An administrator **created an SLA policy in the admin screen** (values saved exactly); the service form then showed "72h resolution target"; a new ticket showed the "On track" badge and the deadlines were written (response/resolution due, business-hours aware). This also proves, live, the ticket-creation path changed under regression R-2 | browser + DB |
| **Closure, reopen, CSAT** | `csat-flow`, `resolved-reopen-flow`, `desk-uat-001-reopen`, `d06-duplicate-reopen-notification` — all pass | integration |
| **Categories, templates, master data, roles, teams, users (admin screens)** | **Every admin page loads for administrator and platform owner without error** (section 3). Creating a category / template through the screens was **not** clicked in the browser; the catalog behaviour is covered by `stage3-questionnaire-*` integration tests | page sweep + integration |
| **Reports and dashboards** | Report Builder, analytics, fixed reports and the Smart Dashboard load for every role they should; the requester's Smart Dashboard is correctly scoped to their own tickets ("My Requests Dashboard · 1 ticket"). Figures are reconciled with independent SQL (`dashboard-numbers-audit`, `fixed-reports`) | page sweep + integration |
| **E-mail, WhatsApp, OEM** | Through mocks and stubs only (no real provider can be used in isolation): outbound mail failure does not stop a status change (`91-reliability`); WhatsApp webhook, parity, mandatory-fields flow, media, duplicates and tenant isolation (`stage5-*`, `stage6-*`, `stage7b-*`); OEM routing and rules (`d12`, `d17`, `oem-assign-stores`). The 18 production-catalog UAT tests are **Blocked** (they need the production catalog) | integration |
| **Unauthorized access** | A requester of another team cannot comment on, change or view a ticket; a technician of another team cannot assign, change status or priority; a technician or requester cannot open an admin page (redirected Home) | `90-uat-lifecycle` + page sweep |
| **Invalid input** | Empty comment, non-existent ticket, a transition the role may not make, oversized/empty/fake/SVG upload — all refused, nothing changed | `90-uat-lifecycle`, `91-reliability` |
| **Duplicates and concurrency** | Two technicians changing status at the same instant, and a technician and a manager assigning at the same instant, leave one consistent result and an honest history; two overlapping scheduled-job runs fire a rule once (document 08) | `90-uat-lifecycle`, `91-reliability` |

## 3. Page sweep — every route as every role

38 routes (the application's pages) were requested as each role, in the real app, and each response was checked for status, redirect target and error text (a "NEXT_REDIRECT" marker is a deliberate redirect, not an error).

| Role | Pages that open | Redirected (by design) | Errors |
|---|---|---|---|
| Requester | 8 | 30 | **0** |
| Technician | 11 | 27 (all admin pages, Projects, Tasks, Intake → Home) | **0** |
| Manager | 25 | 13 | **0** |
| Administrator | 35 | 3 (landing redirects) | **0** |
| Platform owner | 35 | 3 | **0** |

Observation for the owner (not changed): a **manager** can open many administration screens (users, roles, settings, teams, audit, business rules, desktime, org, task config). Authorization of the *actions* on those screens is enforced in the server actions (and the target-role guard added for D-009), so this is a design question about which screens a manager should see, not a hole found here.

## 4. Defects and observations found during the UAT

| # | Type | Description | Status |
|---|---|---|---|
| UAT-1 | UX defect | Login dropped the page the person was heading to | **Fixed** and verified |
| UAT-2 | UI defect | At 375 px the header search had a fixed width and pushed the notification, approvals, theme and avatar icons off-screen (document 07) | **Fixed** and verified |
| UAT-3 | Accessibility | Unlabeled search box and comment box; global-search target 20 px; low-contrast empty-state text (document 07) | **Fixed** and verified |
| UAT-4 | Reliability | With the API layer down, a screen hangs about 165 s before the error screen appears (document 08) | **Open** — recommendation recorded |
| UAT-5 | Observation | After "Start Working" the technician's screen took ~3 s (dev mode) to show the new status; a stale edit form was visible meanwhile | Not a defect in production mode; not changed |
| UAT-6 | Observation | The first rejected "Start Working" click showed its inline message for less than 3 s; a second click showed it persistently. The message itself is clear | Recorded, not changed |

## 5. What was **not** done

* Attaching a file through the browser file chooser (tool limitation); uploads were tested through the application action with real PNG bytes instead.
* Creating categories, form templates, master data or roles through the admin screens (the pages load; the behaviour is covered by integration tests).
* Real e-mail, WhatsApp, Gmail/Graph, DeskTime and OEM provider calls (cannot be made in isolation).
* The 18 production-catalog integration tests (need the production catalog).

## 6. Data created for the UAT (all in the disposable database)

Synthetic accounts `*@audit.test` (requesters `staff1..9`, `store1..`, technicians `agent1..20`, managers `manager1..5`, administrators `admin1..3`) and a synthetic platform owner `platformowner1@audit.test` created for this UAT; the seeded bootstrap platform-owner account was not used. For the browser UAT the service "Laptop issue" temporarily got a four-field form and an SLA policy; **both were removed afterwards** and the two UAT tickets deleted, returning the database to its 3,000-ticket synthetic state.
