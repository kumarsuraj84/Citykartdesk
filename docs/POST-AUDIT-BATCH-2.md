# Post-audit batch 2 — what changed, what did not, how to release it

Branch `fix/post-audit-batch-2` (on top of `feature/system-log`). Local only until you say otherwise. Each item has tests; the database
changes are migrations **161, 162, 163** (each with a rollback in `supabase/rollback`).

## Fixed

| Finding | What it was | What it does now |
|---|---|---|
| **D-029** approval links | E-mailed Approve/Reject links never expired | New links work 7 days (the e-mail says so). Links already sent work until the approval is 14 days old. After that the page says "open the request in Citykart Desk". Optional own secret `APPROVAL_LINK_SECRET` (falls back to the old ones) |
| **D-030** self-approval | You could approve a request you raised or sent | Refused on the portal and from the e-mail, with a clear message; another approver must decide |
| **D-060** approval code | The 6-digit code was derived from the clock and reusable | Random, stored hashed, single-use, expires in 10 min, locked after 5 wrong tries (**migration 161**) |
| **REL-1** slow error page | With the API down a page hung ~165 s | No retry after a timeout; a fast-fail breaker per service with one short test call after each hold-off. The outage test went from ~190 s to ~30 s; an action gives up in ~20-25 s |
| **D-040** dashboard load | Executive dashboard / Report Builder re-read everything on every view | Kept 60 s per organization + level + scope; simultaneous identical loads share one query; exports always read fresh |
| **D-048** invite user | A failing later step left a half-made account | The new account is removed again, so the same address can be invited again |
| **D-026** mail server | Settings accepted localhost / 127.x / 169.254.x; a saved password was silently reused for a new server | Those addresses are refused; changing server, port or mailbox requires entering the password again |
| **D-039** big bodies | 30 MB request bodies accepted on login/approve pages | 256 KB cap (413) on the public pages; attachments (signed-in) unaffected |
| **D-047** long id lists | Some screens failed or went blank with hundreds of ids | Queried in batches of 100 (OEM store assignment, bulk reset, projects, tasks, notifications, approvals, bulk export) |
| **D-050** validation | Type errors were ignored by the build; bulk actions took any list | The build fails on type errors; bulk actions take at most 500 real ids |
| **D-038** Docker | Image ran Node 20 (end of life) | Image uses Node 22. **Check the Node version installed on 10.0.1.98** (the live server does not use Docker) |
| **D-055** uploads | Four copies of the upload rules had drifted | One rule set; **bug found:** genuine MP4 files were always rejected (wrong signature) — fixed |
| **D-044** races | Assign, auto-resume and rules overwrote each other; a rule leaving Hold lost the pause time; priority change moved deadlines of finished tickets | Guards on the status read; rules chain correctly; Hold is credited like Waiting; finished tickets keep their deadlines |
| **D-045** half-finished writes | Failed "send for approval" left a blocked ticket; OEM e-mail failure reported as sent; one e-mail could make two tickets | Rolled back; honest note + ticket left open; unique index (**migration 162**, created only if no duplicates exist yet) |
| **D-031** foreign ids | Rules, workflow approvers and services accepted ids from other organizations | Checked on save, and a rule with a foreign group cannot move a ticket |
| **D-028** forged sender | Reply attribution trusted the From line | A message the mail server saw fail DMARC/SPF/DKIM is not attributed. Internal mail with no result is unchanged |
| **D-023** status moves | Only the application enforced the allowed status moves | The database also refuses moves the screens never offer, for direct API writes (**migration 163**) |
| **D-049** duplicated names | Exports showed raw `assigned` / `waiting_user` | One list of status names |
| **D-033** CSP | None | A **report-only** policy; violations go to the System Log (nothing is blocked) |
| Logs | — | The shipper also reads the nightly `backup.log` (a failed backup becomes a critical row) |

## Deliberately not changed

* **D-005** confidential HR/Finance tier, **D-011** default import password, **D-018 / D-037** HTTPS and secure cookies (and HSTS): your decisions / IT.
* **D-036** password rules in the sign-in service: a setting of the auth service on 10.0.1.98 (`CkDeskAuth`), not code. Suggested: minimum length 8+
  and "require re-authentication to change password" (GoTrue: `GOTRUE_PASSWORD_MIN_LENGTH`, `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`; confirm
  the exact names against the installed version).
* **D-022** per-organization ticket numbers: with one organization there is nothing to fix, and changing numbering is risky.
* **D-041** Home dashboard caching: the earlier database work already made it fast (manager counts 28 s -> 80 ms); caching personal queue counts would show stale numbers right after people act.
* Low / Info findings and the Medium items not listed above.

## Release order (only on your instruction)

1. Build and deploy the new app to 10.0.1.98.
2. You run on 10.0.0.205, in order: `160` (System Log), `161`, `162`, `163`. Then restart `CkDeskPostgrest` on 98.
   * `161` can be run before the new build (it only adds a table). Until it is run, "send me a code" shows an error.
   * `162` prints a notice instead of creating the index if some message already has two tickets.
3. Optional in `.env.local`: `APPROVAL_LINK_SECRET` (16+ characters).
4. Re-run `scripts\windows\install-cron-tasks.ps1` (shipper + archive tasks).
5. Smoke test: sign in; create, assign, resolve, reopen a ticket; send for approval and decide it from the e-mail; open **Logs**.

## Behaviour changes people may notice

* Nobody can approve a request they raised or sent.
* E-mailed approval links stop working after 7 days.
* A direct API call that skips a status step is refused (the screens never did this).
* Selecting more than 500 tickets for a bulk action is refused with a message.
* Exports and dashboards use the app's own status names.
* A brief (up to 60 s) delay in the executive dashboard / Report Builder figures.
