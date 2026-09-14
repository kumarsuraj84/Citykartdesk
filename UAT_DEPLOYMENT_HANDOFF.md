# UAT DEPLOYMENT HANDOFF

For whoever has (or can get) a Railway account and permission to create a hosted Supabase project. This repository already has a complete, working deployment pattern — this document does not invent a new one, it points you at the existing one (`docs/RAILWAY-DEPLOYMENT.md`) and calls out exactly what's needed for a **UAT/staging** environment specifically (not production). No secret values are provided or requested here.

---

## Recommended: A Dedicated UAT Environment, Not Production

Create a **separate** Supabase project and Railway service for UAT — do not point the pilot at the production database. This keeps pilot test traffic, pilot participant mobile numbers, and any pilot-only configuration completely isolated from real production data.

## 1. Hosted Supabase Project (UAT)

Follow `docs/RAILWAY-DEPLOYMENT.md` Part 1 exactly:
1. Create a new Supabase project (e.g. named `citykart-desk-uat`).
2. From **Project Settings → API**, note the Project URL, anon key, and service_role key (keep these in your own password manager — never paste them into this repo or any AI chat).
3. Link the local CLI and push the schema: `npx supabase login`, `npx supabase link --project-ref <uat-project-ref>`, `npx supabase db push`.
4. Seed reference data using `supabase/seed.sql`, **skipping the "ADMIN ACCOUNT" block** (it has a hardcoded local-dev-only password) — run the rest via the SQL Editor, then create your real UAT admin user through Supabase's own Authentication → Users → Add User, and elevate them to `platform_owner` via the one-line SQL update `docs/RAILWAY-DEPLOYMENT.md` already shows.
5. **Authentication → URL Configuration**: set Site URL to your Railway UAT URL (you'll get this in step 2 below — you can come back and fill this in).

### Schema Verification Checklist

After `db push`, confirm these exist (via the Supabase Table Editor or a `psql` connection) before continuing:
- `profiles`, `services`, `requests`, `request_attachments`
- `intake_channels`, `intake_audit_log`
- `request_conversations`, `conversation_events`, `conversation_attachments`
- Functions `intake_store_credential` and `intake_read_credential` (Database → Functions)
- Storage bucket `request-attachments` (Storage tab) — created automatically by the migrations, `public=false`

Do not proceed to the app deployment if any of these are missing — re-run `npx supabase db push` and check for migration errors first.

## 2. Railway Deployment (UAT)

Follow `docs/RAILWAY-DEPLOYMENT.md` Part 2 exactly:
1. Push this repo to GitHub if not already there.
2. Railway → New Project → Deploy from GitHub repo → this repo. Railway auto-detects `railway.toml` and `Dockerfile` — nothing new to configure here.
3. **Variables** tab — set (at minimum, for a UAT environment scoped to this pilot):
   ```
   NEXT_PUBLIC_SUPABASE_URL=        # from step 1.2 above (UAT project)
   NEXT_PUBLIC_SUPABASE_ANON_KEY=   # from step 1.2 above
   SUPABASE_SERVICE_ROLE_KEY=       # from step 1.2 above — mark as a Railway "secret" variable
   SUPABASE_URL=                    # same value as NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_APP_URL=             # the Railway-generated URL — update after first deploy, see below
   TZ=Asia/Kolkata
   CRON_SECRET=                     # any long random string you generate yourself
   ```
   Leave `RESEND_API_KEY`/`EMAIL_FROM` unset (email stays disabled — fine for a WhatsApp pilot). Leave every WhatsApp-specific credential (access token, app secret, verify token) **out of environment variables entirely** — those are entered per-channel through the DESK UI and stored in Supabase Vault instead (see `META_OPERATOR_HANDOFF.md`), never as env vars.
4. Deploy. Watch the build logs.
5. Once up, hit `https://<your-uat-app>.up.railway.app/api/health` — expect `{"status":"ok","db":"ok",...}`. If it says `"degraded"`, double-check the 3 Supabase variables above.
6. Go back and set `NEXT_PUBLIC_APP_URL` to the real Railway URL, then redeploy.

### Public Reachability Verification

Once deployed, from any machine (yours is fine — this doesn't need to be from inside the app):
```
curl -i https://<your-uat-app>.up.railway.app/api/health
curl -i https://<your-uat-app>.up.railway.app/api/intake/webhook/whatsapp
```
Expect: the first returns `200 {"status":"ok",...}`. The second returns **`403 Forbidden`** (not a redirect to a login page) — this is the webhook route correctly rejecting a request with no `hub.mode`/`hub.verify_token` query parameters, which is exactly right at this stage (you haven't registered it with Meta yet). **If the second one instead redirects you to `/login`, something has regressed — that exact defect was found and fixed during Stage 8.1 (`proxy.ts`); confirm you're running a build that includes that fix before going further.**

## 3. Intake Module for the UAT Org

Once you've created your UAT admin account and organization, enable the Intake module for **that org only**:
```sql
UPDATE org_module_access SET enabled = true WHERE org_id = '<your-uat-org-id>' AND module = 'intake';
```
(If the row doesn't exist yet, insert it instead.) Do not run this against any other/production org.

## 4. Scheduled Jobs (Optional for a Short Pilot)

If the pilot runs long enough that SLA escalation/alerts matter, set up at least the `business-rules` and `alerts` cron services per `docs/RAILWAY-DEPLOYMENT.md` § "Scheduled jobs." For a short, closely-monitored pilot this can reasonably be deferred — the WhatsApp ticket-creation flow itself doesn't depend on these jobs running.

## 5. Health Checks Summary

| Check | Expected result |
|---|---|
| `GET /api/health` | `{"status":"ok","db":"ok",...}` |
| `GET /api/intake/webhook/whatsapp` | `403 Forbidden` (not a `/login` redirect) |
| Log in as your UAT admin | Succeeds with the real password you set via Supabase Auth |
| `NEXT_PUBLIC_APP_URL` | Matches the real deployed URL exactly |

Once all of the above are green, hand this URL to whoever is completing `META_OPERATOR_HANDOFF.md` — they'll need it for the webhook callback registration step.
