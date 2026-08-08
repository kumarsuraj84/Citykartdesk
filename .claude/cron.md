# NOTE: production scheduling now runs on Railway via `scripts/cron-tick.mjs`,
# not the Vercel `vercel.json` crons this file was originally written for.
# See docs/RAILWAY-DEPLOYMENT.md § "Scheduled jobs" for the current setup
# (all four jobs, including desktime-sync and intake-classify, which the
# original Vercel-era config below doesn't cover). The curl examples and
# `x-cron-secret` header below are still accurate for local testing.

# Escalation Cron Setup

## Vercel: add to vercel.json: crons entry with path /api/escalation/run and schedule */15 * * * *

## Local: curl -H "X-Cron-Secret: dev" http://localhost:3210/api/escalation/run

## Supabase: use pg_cron + pg_net extension to call the HTTP endpoint on a schedule.

# Alerts Cron Setup

## Alerts cron: /api/alerts/run every 30 minutes
## Vercel: add to vercel.json: crons entry with path /api/alerts/run and schedule */30 * * * *
## Local: curl -H "X-Cron-Secret: dev" http://localhost:3210/api/alerts/run

## Daily digest: the daily_digest alert type fires itself at hour 8 check (runs on the 30-min cron but only sends when current hour === 8 and no digest exists today)
## To ensure daily digest fires at 8am add a dedicated cron: 0 8 * * * -> /api/alerts/run

# DeskTime Sync Cron Setup

## DeskTime sync: /api/desktime/sync once daily, pulls the last 3 days for every org with a connected API key
## Vercel: add to vercel.json: crons entry with path /api/desktime/sync and schedule 0 2 * * *
## Local: curl -H "X-Cron-Secret: dev" http://localhost:3210/api/desktime/sync
