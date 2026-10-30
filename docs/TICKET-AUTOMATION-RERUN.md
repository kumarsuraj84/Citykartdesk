# Ticket automation: "Run automation again", automatic retry, Stuck tickets

LOCAL ONLY until released. Migration 190 (rollback in `supabase/rollback/190_request_automation_state_rollback.sql`).

## What it is, in plain words

When a ticket is made, the system does up to three automatic things: (1) the Business Rules give it to a technician, (2) it e-mails the OEM / vendor (a Vendor Program, or the old AC / Genset setting), (3) a category that asks for it sends it to the store's CVM for approval. Sometimes one of them does not happen: the mail server was busy, the sheet had no address yet, the server restarted during a deploy, a rule was fixed later. Three tools handle that, and **all three are for administrators and platform owners only**:

1. **"Run automation again" button on the ticket.** Shown only when something is missing. A checklist (tick / cross) says what worked and what did not; the button does **only the missing steps**. A step that already worked is never repeated (no second mail to the OEM). It asks "are you sure", leaves an internal note on the ticket saying who pressed it and what happened, and cannot be pressed twice within 3 minutes.
2. **Automatic retry every 15 minutes** (Windows task `CitykartDesk-Cron-AutomationRetry`, job `automation-retry`). Tickets made after this release, newer than 3 days and older than 10 minutes. It retries only what is safe by itself (a failed or not-ready mail to the OEM, a CVM approval that was not sent, Business Rules that were interrupted by a restart) AND only steps that were EXPECTED when the ticket was made (recorded at creation), so switching a program on later never mails old tickets. **3 tries at most**, then it stops, writes a note on the ticket and leaves it in Stuck tickets. The button and the retry share one claim, so they can never run together, and a half-finished mail ("may or may not have gone") is left for a person. It takes the least recently looked-at tickets first, so a busy period cannot starve newer broken tickets. It never decides "nobody has this ticket" by itself, and never touches tickets made before this release.
3. **Admin > Stuck tickets.** One list for the last 14 days: "Automation did not finish" (a step failed or never ran), and "Nobody has these tickets yet" (open, and the rules gave them to nobody, which is normal for a team queue). A **Run** button on each row. Tickets made before this release are listed only for their first 3 days and are marked "older ticket - run by hand only".

## What counts as "missing"

Judged from what really exists on the ticket (`lib/automation/diagnose.ts`):

| Step | Done when | Missing when | "Cannot be done yet" (blocked) |
|---|---|---|---|
| Business Rules | the ticket has a person | Open, nobody has it, and a "created" rule exists | - |
| Mail to the OEM / vendor | the ticket has the "Ticket sent to the ... OEM" message | the category has an active program (or the old AC / Genset setting) and no such message | the store is not linked, has no row in the sheet, or the sheet has no address (shown, never run, picked up by the retry as soon as the sheet is fixed) |
| CVM approval | an approval exists / status Pending Approval | the category asks for it, the ticket is Open and nothing was sent | no CVM in the CVM sheet / not an active staff member |

A resolved, closed or cancelled ticket has nothing to run.

## Remembering how far a new ticket got

Table `request_automation_state` (one small row per ticket, server only). The ticket-creation code writes `started_at` when the ticket is made, `rules_ran_at` after the rules, `finished_at` at the end. A ticket that started but never finished (a restart in the middle) shows as **interrupted**.

## Release steps (when released)

1. Database server (205): migration 189 (services: nothing ticked now means admin / platform owner only, existing untagged services get both locations so nothing changes for anyone on the day) and migration 190 (the new table, with the grant for the server's key).
2. App server (98): after the swap, **restart CkDeskPostgrest** (new table), then run `scripts/windows/add-automation-retry-task.ps1` once (as Administrator).
3. Look at Admin > Stuck tickets once after the deploy; this is also the place to catch tickets that were being made while the app was swapped.

## Tests

`tests/vapt/47-ticket-automation-rerun.test.ts` (isolated stack): button works once and sends one mail, only admin / platform owner, blocked until the sheet is fixed, retry gives up after 3 and the button still works, queue vs interrupted rules, resolved ticket.
