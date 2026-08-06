# Railway Deployment & Cutover

CognixDesk runs as an always-on container on Railway (no serverless cold
starts). This replaces the previous Vercel serverless deployment.

## Why Railway

Measured production TTFB after the move (RSC navigation fetches):

| Metric                | Vercel        | Railway   |
| --------------------- | ------------- | --------- |
| Avg RSC TTFB          | ~350–450 ms   | ~199 ms   |
| Slowest request       | 2007 ms       | 902 ms    |
| Requests over 1 s     | 2             | 0         |

The win is the always-on container — TTFB is no longer dominated by cold starts.

## How the build works

- `next.config.ts` sets `output: 'standalone'` so the build emits a
  self-contained `.next/standalone` server with only the node_modules it needs.
- `Dockerfile` is a 3-stage Alpine build (deps → builder → runner) that runs as
  a non-root user and starts `node server.js`.
- `railway.toml` tells Railway to build from the Dockerfile and health-check
  `/api/health` (30 s timeout, restart on failure).

## Environment variables (web service)

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase → Project Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # same page
SUPABASE_SERVICE_ROLE_KEY=        # same page (keep secret)
NEXT_PUBLIC_APP_URL=              # the Railway public URL (set after first deploy)
CRON_SECRET=                      # shared secret for the scheduled jobs
# Email is currently disabled — leave RESEND_API_KEY / EMAIL_FROM unset.
```

## Custom domain

1. Railway → web service → **Settings → Networking → Custom Domain**.
2. Add your domain (e.g. `app.cognix.com`). Railway shows a CNAME target.
3. At your DNS provider, add the CNAME record pointing at that target.
4. Wait for the cert to provision (Railway shows "Active").
5. Update `NEXT_PUBLIC_APP_URL` to the custom domain and redeploy.

Keep the Vercel deployment around as a fallback until the domain has been
serving from Railway cleanly for a few days, then decommission it.

## Scheduled jobs (escalations + SLA alerts)

Two GET endpoints do the scheduled work, both gated by the `x-cron-secret`
header matching `CRON_SECRET`:

- `/api/escalation/run` — escalates requests past their SLA deadline.
- `/api/alerts/run` — fires configured alert rules.

`scripts/cron-tick.mjs` pings both (Node 18+, no dependencies). Set it up as a
**separate Railway service** in the same project:

1. Railway → **New Service → Empty Service** (or deploy the same repo again).
2. **Settings → Deploy → Cron Schedule**: `*/15 * * * *` (every 15 minutes).
3. **Settings → Deploy → Start Command**: `node scripts/cron-tick.mjs`
4. Set its env vars:
   ```
   CRON_SECRET=        # identical to the web service value
   CRON_TARGET_URL=    # the web service URL (Railway internal or public)
   # optional: CRON_JOBS=escalation,alerts   (this is the default)
   ```
5. A Railway cron service runs the start command on schedule, then exits.
   A non-zero exit (any job returned non-2xx) shows up as a failed run in the
   Railway dashboard.

To run escalations and alerts on *different* schedules, create two cron
services and set `CRON_JOBS=escalation` on one, `CRON_JOBS=alerts` on the other.

### Verifying the jobs

From any machine that can reach the app:

```
curl -i -H "x-cron-secret: $CRON_SECRET" \
  https://YOUR-APP.up.railway.app/api/escalation/run
```

- `200` with a JSON summary → working.
- `401` → the secret header doesn't match `CRON_SECRET`.
- `503` → `CRON_SECRET` isn't set on the web service.
