# 08 — UAT results and sign-off pack

**Important:** the "tester result" column below is what the QA tester saw while acting as each role with synthetic users. It is **not** acceptance by the business. The sign-off table at the end is **blank on purpose**: real stakeholders must try the scenarios and sign. Nothing here may be shown as "UAT passed by the business".

## Business scenarios, by role

### Store user (requester)

| # | Scenario | Expected | Tester saw | Result |
|---|---|---|---|---|
| S1 | Raise a normal request (IT / Admin) from the New Request page | Request is made, priority from the sub category, mail "Request created" | Done (CKSD-007073, 007078, 507628) | PASS |
| S2 | Raise an AC ticket and choose the AC from the store's own list | Only this store's active ACs are listed; OEM mail goes out; ticket is with the vendor technician | 2 ACs of QSA listed; ticket auto-assigned to the Voltas technician; OEM mail in the conversation | PASS |
| S3 | Reply when asked for information | Ticket goes back to In Progress, clock continues | Yes; paused time credited | PASS |
| S4 | Rate the fix; low rating asks why | 5 stars saved; 1 star asks for a reason | Yes | PASS |
| S5 | Reopen within the window | Possible within the days shown; not after | Auto-close job closed it after the window; reopen covered by tests | PASS (automated for reopen) |
| S6 | See only my own tickets and services meant for my location | Yes | Head-office user did not see the stores-only service; store user saw only own tickets | PASS |
| S7 | Admin pages / dashboards | Not reachable | Redirected to Home | PASS |
| S8 | Required Contact number on the Admin-Requirements form | Clear message | Only the browser's own hint | **Usability comment** |

### Technician (agent)

| # | Scenario | Tester saw | Result |
|---|---|---|---|
| T1 | Pick up → Assigned; Start Working → In Progress with automatic first response | Yes ("Response met") | PASS |
| T2 | Waiting on User / Hold due to Purchase from HO need a remark; leaving the hold needs its own remark | Yes | PASS |
| T3 | Resolve needs a note of 10+ characters | Yes | PASS |
| T4 | Time tracking starts and stops by itself | Yes (automated) | PASS |
| T5 | Admin pages closed | Yes | PASS |

### Vendor technician and vendor manager

| # | Scenario | Tester saw | Result |
|---|---|---|---|
| V1 | Sees only own tickets; two tabs (My tickets, AC PMS tickets) | Yes; other tickets give "not found" | PASS |
| V2 | Start with OEM ticket number; Part required; Parts received | Yes | PASS |
| V3 | Ask for a PO with a quote; revise the price; wait for decision | Yes | PASS |
| V4 | Resolve with the AC resolution and FSR | Yes | PASS |
| V5 | PMS visit with report, no OEM number | Yes | PASS |
| V6 | Phone use | Menu was wrong before QA-D009; fixed | PASS after fix |
| V7 | Vendor manager (view only) | Role exists and is limited by tests (`tests/vapt/36`) | PASS (automated) |

### Approvers (CVM, PO approver)

| # | Scenario | Tester saw | Result |
|---|---|---|---|
| A1 | Approval mail shows earlier requests of the same store and sub-category with Qty | Yes (10 rejected, 4 approved, total approved 4) | PASS |
| A2 | Only the named approver can decide from the link; comment is compulsory | Yes | PASS |
| A3 | PO approver can ask for a revised price, approve with PO number/date/document, or reject | Yes | PASS |
| A4 | Old quote version cannot be approved | "Replaced by a newer version" | PASS |

### Administrator

| # | Scenario | Tester saw | Result |
|---|---|---|---|
| D1 | Sheet Masters page tells in plain words what is wrong and keeps the last good copy | Yes | PASS |
| D2 | Create a vendor login | Done through the form | PASS |
| D3 | Dashboards numbers agree with the data | Yes (report 17) | PASS |
| D4 | Create or change services, forms, categories, rules, permissions through the screens | Not walked by hand | NOT TESTED by hand |

## Access-restriction UAT (negative tests)

Requester, technician and vendor sessions were each pushed at admin pages, queue pages and APIs: all were redirected or refused (report 10, 03). A different user opening someone else's approval link: "You are not authorised".

## Sign-off sheet (to be completed by the business)

| Role | Name | What they tried | Accepted? (Yes / No / With changes) | Signature | Date |
|---|---|---|---|---|---|
| Store user | | S1–S8 | | | |
| Technician | | T1–T5 | | | |
| Vendor technician | | V1–V6 | | | |
| Vendor manager | | V7 | | | |
| CVM | | A1–A2 | | | |
| PO approver | | A3–A4 | | | |
| Administrator | | D1–D4 | | | |
| Head of operations (release owner) | | whole pack + reports 15, 18, 19 | | | |

Status of this pack: **PENDING real stakeholder sign-off.**
