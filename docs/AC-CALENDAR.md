# AC Calendar (Smart Dashboard) - built locally 2026-10-23, not pushed

Where: Smart Dashboard (`/dashboards/executive`), view tab **AC Calendar** (also shown in "Full Executive Flow"). Everyone who can open the Smart Dashboard sees it, narrowed to their level (a store: its own ACs; technician / manager: their groups; administrator: all).

## What it shows
- Place picker: **All Citykart / Store / Cluster / Region / State**, plus the exact place.
- Four numbers: total ACs, faulty today, raised this month, fixed this month.
- A month calendar. Each day: ACs still faulty at the **end of that day** ("down"), faults raised (R), faults fixed (F), and the outside temperature (highest/lowest).
- Colour = faulty ACs as a share of the ACs in the place: **green** none, **light green** up to 10%, **yellow** above 10%, **red** above 30%; **grey** for days after today (no numbers). The limits are `YELLOW_ABOVE_PCT` / `RED_ABOVE_PCT` in `lib/reporting/executive/ac-calendar.ts`.
- Click a day: lists the tickets raised, fixed and still faulty that day (links to the tickets).
- **ACs that fail again and again** (by AC serial / number): last 90 days, 4+ tickets = repeat, 2-3 = watch; "came back N times within 30 days of a fix"; who fixed it last (vendor company or technician). Click one to ring its days on the calendar. A small box per AC in a store; "worst stores / clusters / regions / states right now".

## When a ticket is resolved
The day it is resolved shows it under **F**, and from the end of that day the AC no longer counts as faulty, so later days get greener. Earlier days are not changed. A cancelled ticket never counts.
**Known limit:** when a resolved ticket is reopened the system clears its resolved time, so the AC counts as faulty again for the whole time since the ticket was first raised (the in-between "fixed" days are lost). The repeat list is not affected much (it counts tickets).

## Outside temperature
- Source: the free public Open-Meteo service. Only city name and state are sent. Saved in `weather_city_geo` / `weather_city_daily` (migration 182, server only).
- **Collected once a day at 08:00** by the scheduled job `weather-daily` (`/api/weather/daily`, `scripts/windows/add-weather-task.ps1`, also in `install-cron-tasks.ps1`). **Opening the page never calls the service**; it only reads what was saved. Each run re-reads the last 7 days (yesterday's forecast becomes the real value); a new city also gets 120 days of history once.
- Cities: the AC sheet's, plus **for now** the Store Master's city and state (`ALSO_USE_STORE_MASTER_CITIES = true` in `lib/weather/refresh.ts`; set to false when the AC sheet is complete and only the sheet is used).
- A city the service does not know is skipped (retried after 7 days) and listed in the system log line of the run and in the job's answer (`notFound`). Misspellings seen in the Store Master are corrected (`SPELLING_FIXES`); parts of a long name are tried, but only a place in the same state is accepted. A failed city never stops the others, and the calendar works without any temperature.
- On a place with several cities the average of their values is shown ("average of N cities").
- The app server must be able to reach `api.open-meteo.com`, `geocoding-api.open-meteo.com` and `archive-api.open-meteo.com` (https, outbound) before this is released.

## Code
`lib/reporting/executive/ac-calendar.ts` (all the arithmetic), `lib/queries/ac-calendar.ts` (rows), `lib/actions/acCalendar.ts`, `components/executive/AcCalendarSection.tsx`, `lib/weather/*`, `app/api/weather/daily/route.ts`. Tests: `tests/unit/ac-calendar.test.ts`, `tests/unit/open-meteo.test.ts`, `tests/vapt/38-ac-calendar-weather.test.ts`. Local demo data: `local-testing/seed-ac-calendar-demo.sql` (titles start with DEMOCAL; remove with `seed-ac-calendar-demo-cleanup.sql`).

## Follows the dashboard filters (added 2026-10-23)
The calendar uses the same filters as the rest of the Smart Dashboard (group, technician, region, state, cluster, OEM brand, search ...). Choose a group at the top and only that group's AC tickets are in the calendar, the repeat-fault list and the worst-places list; a blue note under the title says which filters are on. The total ACs stay those of the chosen place. The period buttons (30d, 60d ...) do not apply: the calendar has its own month.
