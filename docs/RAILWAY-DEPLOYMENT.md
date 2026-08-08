# Deployment: hosted Supabase + Railway

Citykart Desk runs as an always-on Docker container on Railway, against a hosted
Supabase project (Postgres + Auth + Storage). Locally you run both via Docker on
your own machine (`supabase start`); in production, Supabase is a separate hosted
project and Railway only runs the Next.js app (+ optional cron-runner services).

This doc has two parts, done in order: **1. Supabase** (the database has to exist
before the app can start), then **2. Railway** (the app itself).

Do the account creation, login, and secret-entry steps yourself in your own
browser/terminal — an AI assistant should never see your Supabase DB password,
service-role key, or Railway tokens.

---

## Part 1 — Hosted Supabase project

### 1.1 Create the project

1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Pick an org, a name (e.g. `citykart-desk`), a region close to where Railway
   will run, and set a **strong database password** — save it in a password
   manager, not in this repo or in chat with any AI tool.
3. Wait for provisioning (~2 min).

### 1.2 Get your keys

**Project Settings → API**:
- `Project URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` `secret` key → this is `SUPABASE_SERVICE_ROLE_KEY` — never expose
  this to the browser or commit it anywhere; it bypasses RLS entirely.

Keep this browser tab open — you'll paste these into Railway's env vars in Part 2.

### 1.3 Link the local CLI and push the schema

From this repo, in your own terminal:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # the ref is in the project URL
npx supabase db push
```

`db push` applies every file in `supabase/migrations/` (87 as of this writing,
`20240101000087_index_and_search_path_hygiene.sql` is the latest) in order,
including the schema, RLS policies, indexes, and Storage bucket definitions —
there's nothing else to configure manually for buckets.

### 1.4 Seed reference data — read this before running `seed.sql`

`supabase/seed.sql` was written for **local dev only**. Its "ADMIN ACCOUNT"
section creates the first user by inserting directly into `auth.users` with a
**hardcoded password** (`Password!!`) baked into the file. That's fine on a
throwaway local Docker instance; it is **not safe to run as-is against
production** — anyone who's ever seen this repo's history knows that password.

For production, do this instead:

1. Open `supabase/seed.sql` and run everything **except** the "ADMIN ACCOUNT"
   block (departments, teams, service categories, approval workflows, etc. are
   all safe reference data) — via the Supabase Dashboard's **SQL Editor**, or
   `psql` against the connection string under **Project Settings → Database**.
2. Create your real admin user via **Authentication → Users → Add User** in the
   Supabase Dashboard (or your own sign-up flow, if one exists) — this goes
   through Supabase's real Auth API instead of a raw insert, so it's your own
   password from the start.
3. Elevate that user to owner:
   ```sql
   UPDATE profiles SET role = 'platform_owner' WHERE id = '<the-new-user-id>';
   ```

### 1.5 Auth settings

**Authentication → URL Configuration**:
- Site URL → your Railway app's URL (you'll have this after Part 2; you can
  come back and set it once you know the domain).
- Redirect URLs → add `https://<your-app>/auth/callback` (used by the intake
  module's Gmail/Outlook OAuth flow, if you use it).

**Optional, recommended perf win**: this app currently falls back to a network
round-trip (`getUser()`) to verify sessions because symmetric (HS256) JWT
signing is the default. **Authentication → JWT Keys** → switch to asymmetric
keys lets local JWT verification skip that round-trip entirely on every
request. Not required to deploy — just faster once enabled.

---

## Part 2 — Railway (the app)

### 2.1 Push this repo to GitHub

Railway deploys from a GitHub repo. If you haven't already:

```bash
git push -u origin master
```

### 2.2 How the build works (already set up in this repo)

- `next.config.ts` sets `output: 'standalone'` so the build emits a
  self-contained `.next/standalone` server with only the node_modules it needs.
- `Dockerfile` is a 3-stage Alpine build (deps → builder → runner) that runs as
  a non-root user and starts `node server.js`. Verified locally with `docker
  build` + `docker run` — it builds and serves correctly.
- `railway.toml` tells Railway to build from the Dockerfile and health-check
  `/api/health` (30 s timeout, restart on failure, up to 3 retries).

### 2.3 Create the Railway service

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub
   repo** → pick this repo. Railway auto-detects `railway.toml` and the
   `Dockerfile`.
2. **Variables** tab — set every var from [`.env.example`](../.env.example)
   that applies to you. At minimum, for the app to boot and serve requests:
   ```
   NEXT_PUBLIC_SUPABASE_URL=        # from step 1.2
   NEXT_PUBLIC_SUPABASE_ANON_KEY=   # from step 1.2
   SUPABASE_SERVICE_ROLE_KEY=       # from step 1.2 — mark as a "secret" variable
   NEXT_PUBLIC_APP_URL=             # the Railway-generated URL; update after first deploy
   CRON_SECRET=                     # generate any long random string
   ```
   Leave `RESEND_API_KEY` / `EMAIL_FROM` unset to keep email disabled;
   leave every `INTAKE_*` / `OAUTH_*` var unset unless you're using the
   intake/email-channel module.
3. Deploy. Watch the build logs — first build takes a few minutes.
4. Once it's up, hit `https://<your-app>.up.railway.app/api/health` — you
   should get `{"status":"ok","db":"ok",...}`. If you get `"degraded"`, the app
   can't reach Supabase — double check the 3 Supabase env vars.
5. Go back and set `NEXT_PUBLIC_APP_URL` to the real Railway URL (or your
   custom domain once set up below), then redeploy.

### 2.4 Custom domain

1. Railway → web service → **Settings → Networking → Custom Domain**.
2. Add your domain (e.g. `desk.citykart.org`). Railway shows a CNAME target.
3. At your DNS provider, add the CNAME record pointing at that target.
4. Wait for the cert to provision (Railway shows "Active").
5. Update `NEXT_PUBLIC_APP_URL` to the custom domain and redeploy.

### 2.5 Scheduled jobs (escalations, SLA alerts, DeskTime sync, intake classification)

Four GET endpoints do the scheduled work, all gated by the `x-cron-secret`
header matching `CRON_SECRET` (`/api/intake/cron/classify` additionally
accepts Vercel's `Authorization: Bearer <CRON_SECRET>` convention, kept for
back-compat — `cron-tick.mjs` uses `x-cron-secret` for all four):

- `/api/escalation/run` — escalates requests past their SLA deadline.
- `/api/alerts/run` — fires configured alert rules.
- `/api/desktime/sync` — pulls the last 3 days of DeskTime data for every org
  with a connected API key. Run once daily.
- `/api/intake/cron/classify` — reclassifies any intake messages missing a
  final classification. Run every few minutes.

`scripts/cron-tick.mjs` pings whichever of these are listed in `CRON_JOBS` by
name (`escalation`, `alerts`, `desktime-sync`, `intake-classify` — see the
`JOB_PATHS` map at the top of the script). Set it up as a **separate Railway
service** in the same project:

1. Railway → **New Service → Empty Service** (or deploy the same repo again).
2. **Settings → Deploy → Cron Schedule**: pick a schedule matching the jobs
   this service runs (e.g. `*/15 * * * *` for escalation+alerts, `0 2 * * *`
   for a once-daily desktime-sync service, `*/5 * * * *` for intake-classify).
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

Each job's natural cadence is different, so in practice this means **up to
four separate Railway cron services**, each with its own schedule and
`CRON_JOBS` value — e.g. `CRON_JOBS=escalation,alerts` on a 15-minute
service, `CRON_JOBS=desktime-sync` on a once-daily service, and
`CRON_JOBS=intake-classify` on a 5-minute service (only needed if the intake
module is in use).

### Verifying the jobs

From any machine that can reach the app:

```
curl -i -H "x-cron-secret: $CRON_SECRET" \
  https://YOUR-APP.up.railway.app/api/escalation/run
```

- `200` with a JSON summary → working.
- `401` → the secret header doesn't match `CRON_SECRET`.
- `503` → `CRON_SECRET` isn't set on the web service.

---

## Post-deploy checklist

- [ ] `/api/health` returns `{"status":"ok","db":"ok",...}`
- [ ] You can log in with the admin account you created via Supabase Auth (not
      the seed.sql placeholder password)
- [ ] `NEXT_PUBLIC_APP_URL` matches the real deployed URL
- [ ] At least one cron service is running if you rely on SLA escalation/alerts
- [ ] Custom domain cert shows "Active" in Railway, if used
