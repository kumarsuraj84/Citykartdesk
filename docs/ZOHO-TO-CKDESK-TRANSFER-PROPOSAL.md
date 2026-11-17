# Moving Zoho tickets into CK Desk — proposal

Status (2026-11-17): **the owner approved every recommendation below. Stages 1, 2 and 3 are built locally and not released** (mapping + preview; the silent move with the full conversation, approvals and attachments; move-everything-that-matches in steps with Pause/Stop and a run record; Moved and From Zoho markers; moved tickets silent in the scheduled jobs until switched on). Nothing is on live.

Changes made after the owner's own mapping table: Zoho **Template → CK Desk Form Template**; Zoho **Template + Category → Service**; Zoho **Sub Category → Category**; Zoho **Item → Sub Category**; Requester, Technician and Status map to their CK Desk equivalents. Priority is not mapped (CK Desk's rule decides it).

## What you asked for (in my words)
1. From the Zoho tab, pick tickets (by requester, status, service/template, technician, ticket number, date …) and **move them into CK Desk**.
2. In the Zoho tab, **mark** every ticket that has been moved.
3. In CK Desk the ticket number is **`ZOHO-` + the Zoho ticket number** (for example `ZOHO-48213`).
4. The **created time stays exactly as in Zoho**. Everything else is worked out by CK Desk: **SLA from that created time**, **technician by CK Desk's own rules**.
5. A **mapping** so each Zoho service/template lands in the right **CK Desk service, category and sub-category**, and Zoho fields land in the right CK Desk fields.

## What I found in the code (why it is possible, and what must change)
| Today | What it means for this feature |
|---|---|
| The Zoho tab is **read-only by design** (own database login that cannot write; "nothing copied into CK Desk"). | Good: Zoho data stays untouched. This feature is the **one deliberate exception**, and it only **writes into CK Desk**, never into Zoho. It changes the rule written in `docs/ZOHO-DATA-TAB.md`, so I need your OK. |
| CK Desk makes ticket numbers itself (`TEAM-000123`) with a database trigger that **always overwrites** any number given. | One small database change: let a ticket keep a number that starts with `ZOHO-`. The number column is already unique, so a ticket can never be moved twice. |
| New tickets are made by one shared routine (`createRequestCore`) that picks category/sub-category, SLA, assignment by Business Rules, **and sends mails/WhatsApp/push**. | We can reuse its logic but must run it in a **silent mode** (no mail, no WhatsApp, no push, no CSAT survey) and with the **Zoho created time**. |
| The Zoho copy holds the whole original record, e-mails, notes, history and attachments (on the NAS). | We can carry the full conversation and files across. |
| My audit found the rule engine costs about **12.5 ms per overdue open ticket per rule per run** (report 11, PERF-004). | Moving **thousands of old open tickets at once** would slow every scheduled run. So: small batches, and old closed tickets moved as closed. |

## How it would work (simple picture)

### 1. Set-up screen (done once, by an administrator) — "Zoho mapping"
| Mapping | Example |
|---|---|
| **Zoho service/template → CK Desk service + category + sub-category** | Zoho "AC Complaint" → CK Desk service "AC", category "Complaint", sub-category "Not cooling" |
| **Zoho field → CK Desk form field**, per service | Zoho "AC number" → CK Desk "AC (CKDESK number)"; "Employee code" → "Employee code" |
| **Zoho status → CK Desk status** | Zoho Closed → Closed; Zoho "On hold" → On hold |
| **Zoho priority → CK Desk priority** | (CK Desk's rules may still set the final priority) |
| **Zoho person → CK Desk user** | matched by e-mail first, then employee code / name; unmatched people are listed so you can fix them |
| **Zoho store code → CK Desk store/location** | from the Store Master, as today |

A ticket whose service or sub-category has **no mapping is never guessed**: it is shown as "cannot move yet — map this service first".

### 2. Move screen — inside the Zoho tab
- Filters: requester, status, service/template, technician, ticket number (one, several or a range), store, date range, "not moved yet".
- A list with tick boxes and a **Preview** button. The preview shows, for each ticket, **what CK Desk will do**: new number `ZOHO-…`, service / category / sub-category, requester, status, which fields did not map, and any problem. **Preview writes nothing.**
- **Move selected** (batch limit, for example 200 at a time). It runs in the background, with a progress bar, then a result list: moved / skipped / failed, each with the reason.

### 3. What comes across, what CK Desk works out
| Comes from Zoho (kept as is) | Worked out by CK Desk (as if it were new) |
|---|---|
| Ticket number (as `ZOHO-…`), **created time**, subject, the store's message | **SLA due times**, counted from the Zoho created time with CK Desk's SLA policy |
| Requester, store, the form answers (through the field mapping) | **Technician / team**, by CK Desk's Business Rules |
| E-mails, replies, notes and history, shown in the ticket as "From Zoho" (read-only) | Priority per CK Desk's rules and sub-category |
| Attachments (copied to CK Desk's file store on the NAS) | Approval steps and routing that apply to the service |
| For closed tickets: Zoho's closed/resolved times and the closure text | |

### 4. Marking in the Zoho tab
Zoho's database must stay read-only, so the marker lives **in CK Desk**: a small table "Zoho transfers" (Zoho number, CK Desk ticket, when, by whom, mapping used). The Zoho tab reads it and shows:
- a green **"Moved to CK Desk as ZOHO-48213 — 17 Nov 2026, by Suraj"** badge in lists and on the ticket page (with a link to the CK Desk ticket);
- a filter **Moved / Not moved yet**, and counts on the Overview ("38,000 of 107,000 moved").
In CK Desk the moved tickets carry a **"From Zoho" badge** and a filter, so they can be found or left out of reports.

### 5. Safety rules
- **Preview first, then move.** Nothing is written on Preview.
- **Never twice:** the same Zoho ticket cannot be moved again (unique number).
- **Silent:** no mail, WhatsApp, push or CSAT survey is sent for a moved ticket.
- **Small batches** with a pause button; a run log is kept (who, when, how many, what failed).
- **Test locally first** with the made-up Zoho data (5 tickets, then 200), then you check, then live only after your explicit OK (as always).
- **Undo:** an administrator can "withdraw" a moved ticket (it is hidden from CK Desk and the Zoho badge goes back to "not moved"); nothing is hard-deleted.

## Things you must decide (my recommendation first)
| # | Question | Recommendation |
|---|---|---|
| 1 | **Old open tickets.** If a Zoho ticket from last year is still open, CK Desk will calculate its SLA from the old created time, so it is already breached. Should that be allowed to start escalation mails? | Move it, show it as breached, but **suppress escalation mails and notifications for moved tickets** until you switch them on. |
| 2 | **Closed tickets.** Move them as **closed** (with Zoho's closed date), and send no survey? | Yes. They are history; reports then include them. |
| 3 | **Requesters who are not in CK Desk** (people who left). | Create them as **inactive** CK Desk profiles from the Zoho name/e-mail (they cannot sign in), so history stays correct. The other choice is one placeholder person "Former employee (Zoho)". |
| 4 | **Technician.** You said CK Desk rules decide. If no rule matches? | Leave it **unassigned** (visible in the unassigned queue), and keep the Zoho technician's name as a note in the history. |
| 5 | **Who may move tickets?** | Administrators only (managers can see the Preview). |
| 6 | **Zoho statuses** (Zoho has more than CK Desk). | I will list every Zoho status with its count and you tick the CK Desk status for each — one short table. |
| 7 | **Numbers:** `ZOHO-` + the Zoho number **exactly as Zoho has it** — zeros kept if Zoho has them, none added if Zoho has none. | **Decided by the owner (2026-11-17).** The Zoho copy stores the number as a whole number (`display_id` bigint), so no leading zeros exist in practice; if one ever does, the number is taken from Zoho's text field `display_key`. |

## How I would build it (stages, each shown to you locally before the next)
1. **Mapping screens + Preview only** (no ticket is written). You can already see what would happen to every Zoho service and which fields do not map.
2. **Move a handful** of made-up tickets locally, check numbers, created times, SLA, assignment, no mail sent.
3. **Move by filters in batches**, the "Moved" badge, filters and counts in the Zoho tab, the CK Desk "From Zoho" badge.
4. **Local QA** (same method as the audit): fail-first tests, silent-mode proof, no-double-move proof, performance with 1,000 and 10,000 tickets.
5. **Live** only on your word: one database migration (number rule + transfers table + mapping tables), deploy, then a first small live batch that you check.

Needs a database migration (numbers, mapping tables, transfer log). Restart of the PostgREST service on 98 after that migration (standing rule).

## Stage 3 addition (decision 1 made real)
Decision 1 said old open tickets are moved **silently**. The move itself sends nothing, but the scheduled jobs would notify about them later, so tickets with a `ZOHO-` number are now **left out of the scheduled Business Rules and the "unassigned" alert** until an administrator switches them on (one switch on the Move page, default OFF). See `docs/ZOHO-DATA-TAB.md`.
