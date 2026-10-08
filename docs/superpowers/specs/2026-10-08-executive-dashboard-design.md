# Executive Dashboard — design (2026-10-08)

Approved by the user after reviewing `CITYKART-DESK-INTERACTIVE-DASHBOARD-MOCKUP.html` ("looks good, please build").
Local build only; nothing is pushed or deployed without the user's "commit and push to git and main".

## What it is
A new page, **Executive Dashboard** (`/dashboards/executive`), for leadership and managers. Every number, bar, name and day is
clickable: a click filters the whole page (cross-filtering), and a ▸ / "Breakdown" link opens a popup in which the viewer can
drill several levels (Group → Technician → Category → Location → Priority → Status → Backlog age → individual tickets → one
ticket's detail and timeline). The existing dashboards (`/admin/reports`, `/dashboards`) stay as they are.

## Decisions (defaults, to be changed on request)
* **Who:** the same people as Report Analytics — admin / platform owner see every technician group, managers and technicians
  only the groups they belong to (`selectableGroups`). Requesters never see it. Module `requests` must be enabled.
* **Where:** sidebar → Analytics → "Executive Dashboard".
* **Periods:** 7 days, 30 days, 90 days, This FY (1 Apr), plus a click on a trend bar to zoom to one day/week. "Compare with
  previous period" compares with the equally long period just before.
* **Measures (7):** Created, Resolved, Open backlog, SLA breaches, SLA compliance, Avg resolution, CSAT.
* **Data:** the server sends one compact row per ticket (last 800 days, plus every still-open ticket), already limited to the
  groups the viewer may see. The browser computes every figure from those rows, so each click reacts instantly. A cap of
  30,000 rows protects the page; if it is hit the page says so.
* **SLA breach:** resolved after `resolution_due_at`, or still open past it (no due date = not breached) — the same rule the
  existing dashboards use.
* **Location** = the requester's store, else their location.
* **Ticket detail popup:** loaded on demand by a server action that re-checks the viewer's group access, and returns the
  ticket's facts plus its activity timeline (`request_activity`).

## Structure
* `lib/reporting/executive/engine.ts` — pure functions (windows, filters, measures, buckets, deltas, ranking). Unit-tested.
* `lib/queries/executive-dashboard.ts` — loads the compact rows for a viewer.
* `lib/actions/executiveDashboard.ts` — `getExecutiveTicketDetail(id)`.
* `components/executive/*` — the client dashboard (cards, trend, rankings, compare table, heatmap, list, drill popup).
* `app/(app)/dashboards/executive/page.tsx` — access checks and data load.

## Out of scope for this first version
The Report Analytics reports (tried inside the dashboard and removed at the user's request; they stay on their own pages), saved views, scheduled e-mail of the dashboard, tasks / projects / approvals panels (the existing dashboards still cover those).
