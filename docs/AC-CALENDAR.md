# Ticket Calendar (Smart Dashboard) - built locally 2026-10-23, not pushed

Where: Smart Dashboard (`/dashboards/executive`), view tab **Ticket Calendar** (also in "Full Executive Flow"). The calendar is named after the group chosen at the top: **IT Group -> "IT Ticket Calendar"**, ADMIN GROUP -> "ADMIN Ticket Calendar", and so on; no group chosen -> "Ticket Calendar".

## Who sees what (rights)
The calendar only ever uses the tickets the Smart Dashboard already loaded for the viewer (a store: its own; technician / manager: the groups they belong to; administrator: everything), and the machine lists use the same scope on the server. The group list at the top offers only groups that have tickets in the viewer's scope, so nobody can open another group's calendar without having rights to its tickets. Tested: a technician of group A never receives a ticket of group B (`tests/vapt/38-ac-calendar-weather.test.ts`).

## What to look at (top bar, each list narrows the next)
Group -> Service -> Category -> Sub category (new filters in the top bar and in the Filters pop-up), plus Technician, Region, State, Cluster, Store type, OEM brand, Status, SLA. Inside the calendar: **All Citykart / Store / Cluster / Region / State** with a box for the exact place.

## Two ways of counting (automatic)
- **Machines (AC, Genset)** - when everything in view is AC or genset work (for example ADMIN GROUP + category ADMIN AC ISSUE). Colour = faulty machines at the end of the day as a share of the machines in the place: green none, light green up to 10%, yellow above 10%, red above 30%. A "Count" switch lets the viewer see open tickets instead. Repeat-fault list by AC serial / genset, per-AC boxes for a store, worst places, temperature.
- **Tickets** - for everything else (IT, HR, Finance, VM, ...), which have no asset list. Colour compares the day with the view's own usual level over the last 90 days: green nothing open, light green up to the usual level (median), yellow above it, red above the level only the busiest 15% of days reach. Side panels: **Break it down by** Technician / Cluster / Region / State / Store / Category / Sub category (open now, raised, fixed), **What the tickets are about** (top categories and sub categories), **Same issue again** (same store + same sub category / category, 2+ in 90 days: 4+ repeat, 2-3 watch; "came back within 30 days of a fix").
- Grey = days after today, no numbers. Click a day for the tickets raised, fixed and still open that day.
- Only AC and genset tickets count as machine work: a category is machine work when its `auto_oem_kind` is `ac` or `genset` (other tickets of the same service, such as stationery, are not).

## When a ticket is resolved
The day it is resolved shows it under F, and from the end of that day it no longer counts as open / faulty. Earlier days are not changed. Cancelled tickets never count. **Known limit:** reopening a resolved ticket clears its resolved time, so it counts as open again for the whole time since it was first raised.

## Outside temperature (machine work only)
- Free public Open-Meteo service; only city name and state are sent. Saved in `weather_city_geo` / `weather_city_daily` (migration 182, server only).
- **Collected once a day at 08:00** by the scheduled job `weather-daily` (`/api/weather/daily`, `scripts/windows/add-weather-task.ps1`, also in `install-cron-tasks.ps1`). Opening the page never calls the service. Each run re-reads the last 7 days; a new city also gets 120 days of history once.
- Cities: the AC sheet's, plus for now the Store Master's city and state (`ALSO_USE_STORE_MASTER_CITIES = true` in `lib/weather/refresh.ts`; set it to false when the AC sheet is complete).
- A city the service does not know is skipped (retried after 7 days) and listed in the job's answer (`notFound`) and its system-log line. Known misspellings are corrected (`SPELLING_FIXES`); parts of a long name are tried but only a place in the same state is accepted. The calendar works without any temperature.
- The app server must be able to reach `api.open-meteo.com`, `geocoding-api.open-meteo.com` and `archive-api.open-meteo.com` (https, outbound) before release.

## Code
`lib/reporting/executive/ac-calendar.ts` (machine arithmetic), `lib/reporting/executive/issue-calendar.ts` (ticket-volume arithmetic, title), `lib/queries/ac-calendar.ts` (machine tickets and lists), `lib/actions/acCalendar.ts`, `components/executive/TicketCalendarSection.tsx`, `lib/weather/*`, `app/api/weather/daily/route.ts`; filters in `components/executive/CommandBar.tsx` and `lib/reporting/executive/engine.ts`. Tests: `tests/unit/ac-calendar.test.ts`, `issue-calendar.test.ts`, `open-meteo.test.ts`, `tests/vapt/38-ac-calendar-weather.test.ts`. Local demo data: `local-testing/seed-ac-calendar-demo.sql` (titles start with DEMOCAL; remove with `seed-ac-calendar-demo-cleanup.sql`).
