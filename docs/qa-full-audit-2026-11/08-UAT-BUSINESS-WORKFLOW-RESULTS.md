# 08 — UAT and Business Workflow Results

> **Business sign-off for every scenario below: pending owner/business sign-off.** These are technical black-box runs of the business workflows by a test team using made-up people and data. They show that the system does what the business rule says; they are not the business's acceptance.

## Plain summary
Seven real-life stories (A to G) were played through the real screens or the real doors of the system (browser, scheduler call, webhook), as the right kind of person each time. **All 74 checks passed.** Everything ran on the isolated audit copy; mail went to a mail-catcher folder, nothing left the PC.

## Personas used
Store requester (qa11.store / ALC store manager), head-office requester, technician (and a second technician), technician manager, approver (CVM Vishal Kumar demo person), administrator, platform owner, vendor technician, vendor manager, and "another vendor" (to prove they cannot see each other's work). All made-up `@audit.test` addresses.

## Scenario results
| Scenario | Story | Checks | Result | Evidence |
|---|---|---|---|---|
| **A** | Store AC complaint: the store manager picks an AC from their own store's sheet, raises the complaint; routing goes to the OEM mail; ticket number, timeline and audit trail exist; another store cannot open it | 7 (A00–A06) | **PASS** | `evidence/uat/uat-ab-results.json`, screenshots |
| **B** | Fixtures request with quantity → waits for approval → the CVM sees it on the Approvals screen and approves → the ticket moves on (checked that a false "pass" was ruled out) | 4 (B01–B04) | **PASS** | same |
| **C** | SLA escalation: two scheduled rules (80 % → managers told; 100 % → priority Urgent and admin told). 4 tickets: overdue, ~90 %, resolved-but-late, paused. Only the right ones fire; running the scheduler again does nothing twice; wrong or missing secret = 401 | 11 | **PASS** | `uat-c-results.json` |
| **D** | Vendor parts / PO: vendor technician starts the ticket with the OEM number → asks for a PO with quote file → PO approver asks for a revision → vendor sends version 2 → approver approves with PO number, date and document → parts request → received → resolved with remarks and FSR file. Another vendor company cannot open it; the vendor manager sees the technician's ticket; Citykart sees the PO register; every step is in the history | 12 (D00–D11) | **PASS** | `uat-d-results.json` |
| **E** | Zoho history, read-only: overview totals match the database, reports, ticket look-up and search, injection text is plain text, only managers/admins may open it, the report login cannot write (insert/update/delete/truncate/drop/create all refused), outage shows a clear "not connected" message and recovers, Zoho data unchanged | 10 | **PASS** | `uat-e-results.json` |
| **F** | CKOneAI assistant + data API against a stand-in that checks every signature independently: off by default; roles and pilot list enforced; forged identity headers never reach CKOneAI; correct signature and fresh nonce each call; size limit 413; rate limit 429; only metadata audited, never the question text; outage message and recovery; data API read-only, page cap, no secret-looking columns | 18 (2 off + 16 on) | **PASS** | `uat-f-off-results.json`, `uat-f-on-results.json` |
| **G** | WhatsApp intake (Meta webhook, signed): handshake, unsigned/tampered/oversized messages refused, broken-but-signed body gets 200 and creates nothing, replay is idempotent, a stranger's number gets nothing and cannot touch someone else's conversation, no secret in any answer, outbound reply attempts refused by the egress guard | 12 | **PASS** | `uat-g-results.json` |
| **Total** | | **74** | **74 PASS, 0 FAIL** | |

## Gaps and honest limits
- **G**: the full "Hi → choose service → ticket created" conversation could not be played end to end because every real reply goes to graph.facebook.com (refused by the egress guard on purpose). That path is covered by the existing integration suite with only Meta's HTTP call mocked. **BLOCKED for a true end-to-end run.**
- **F**: tested against a stand-in written from the written signing specification, **not** the real CKOneAI machine (10.0.0.82). **NOT RUN** against the real service.
- **A**: the three Google Sheets are read from local sample files, not from Google. The live sheet sync is **NOT RUN**.
- **C**: real mail delivery of the escalation e-mails is not tested (mail-catcher only).
- Required but not played: business-hours / holiday calendar edge cases; delegation chains with three or more approvers (covered by existing unit tests); CSAT rating by the real e-mail link (public token pages were probed for safety only, S07).
- Two earlier script bugs of mine (wrong table names, a false-pass in B04) were corrected before the final runs; the false-pass was tightened so it can no longer pass unless the ticket really leaves Pending Approval.

## Observations from the UAT runs (details in 15/16)
- "Notify managers" rule action reaches **every** manager of the organisation, not only the manager of the ticket's group (needs an owner decision whether that is intended).
- The Zoho "not connected" message shows a server file path and setting names to managers (P3 information leak; see 15).
- The audit database now contains the tickets created by these runs (CKSD-5197xx and the UAT stamps); the disposable stack can simply be reset.
