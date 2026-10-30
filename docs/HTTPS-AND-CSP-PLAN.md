# HTTPS, security headers, scheduled-task accounts and "must do on live" checks

Plain-words plan. Written 2026-10-29 for the owner. Nothing here has been done on a live server: every step that touches 10.0.1.98, 10.0.0.205 or the router is the
owner's to run. No passwords or keys are written in this file.

Findings covered: A-02 / G-03 / A-03 (plain HTTP site), G-12 (tasks run as SYSTEM), G-05 (fixed seed password), D-12 (open sign-up puts people in the oldest organisation),
G-26 / G-28 (old backup files, retired deployment files), H-28 (server time zone).

---

## 1. Why the site should move to HTTPS

Today people reach the app at `http://182.72.84.10:3210` (the router forwards port 3210 straight to the app on 10.0.1.98). Over plain HTTP anyone on the path between a
person and the server (café Wi-Fi, a hotel network, an ISP) can read the sign-in cookie and the passwords typed on the login page, and can change the page on its way.
The browser also refuses to treat the site as secure, so some protections cannot be switched on at all.

What needs a certificate first, and cannot be done in code:

* The cookie flag `Secure` (the browser then never sends the cookie over plain HTTP).
* The header `Strict-Transport-Security` (HSTS: "always use https for this name").
* An enforced content security policy that includes `upgrade-insecure-requests`.

## 2. What to put in front (the one thing that needs deciding)

A certificate needs a **name**, not an IP address. So first: a name such as `desk.<company domain>` pointing at the public IP (a DNS record the IT team adds).
Then one of these:

| Option | In words | Effort |
|---|---|---|
| A. A small reverse proxy on 10.0.1.98 (Caddy, or IIS with URL Rewrite + win-acme) that holds the certificate (Let's Encrypt, renewed automatically) and passes traffic to `127.0.0.1:3210` | Everything stays on the one server. The router forwards **443** to it instead of 3210. | Smallest |
| B. The company firewall / load balancer terminates https and forwards to the app | Good if one already exists. | Depends |
| C. A tunnel service in front (for example Cloudflare) | No router change; traffic goes through a third party. | Small, but a decision about trust |

After the change, **close the direct path**: the router must no longer forward 3210, and the Windows firewall rule "Citykart Desk web app (3210)" should allow only the
proxy (127.0.0.1) and the office LAN, otherwise people (and attackers) can still use plain http.

## 3. Settings that change when the address becomes https

Do these together, in this order, on one planned evening. Rebuilding is needed because `NEXT_PUBLIC_*` values are written into the code at build time.

1. **Build** with the new public address: `scripts\windows\build-for-deploy.ps1 -AppUrl https://desk.<company domain> -SupabaseAnonKey <key> -ZipPath <zip>`
   (the Supabase address `http://10.0.1.98:8443` stays: the app server talks to it on the inside).
2. **App `.env.local`** (`app\standalone\.env.local`): `NEXT_PUBLIC_APP_URL=https://desk.<company domain>` and `TRUSTED_PROXY_HOPS=1` (one proxy in front).
   Set `TRUSTED_PROXY_HOPS` **only** when the direct path is closed, otherwise a visitor can invent addresses (the app would believe a made-up `X-Forwarded-For`).
3. **GoTrue** (`services\auth\.env`): `GOTRUE_SITE_URL=https://desk.<company domain>` and add the https address to `GOTRUE_URI_ALLOW_LIST`.
   `API_EXTERNAL_URL` stays on the inside address. Restart `CkDeskAuth`.
4. Replace the public address in the router/DNS notes, in `docs/PRODUCTION-INFRASTRUCTURE-AND-MIGRATION.md` and in the e-mail templates settings, if any show the old one.
5. Deploy as usual (`04-swap-app.ps1`). Then check, from outside the office:
   * the page opens on https and the padlock shows;
   * a sign-in works and the browser's cookie list shows the `sb-...-auth-token` cookie as **Secure**;
   * the response headers include `Strict-Transport-Security: max-age=31536000`;
   * an e-mailed approval link (made after the change) opens on https.

### What the code already does when the address is https (checked 2026-10-29)

The code looks only at whether `NEXT_PUBLIC_APP_URL` starts with `https`; nothing else has to be switched on:

* `proxy.ts` and `lib/supabase/server.ts` mark every cookie they set `Secure`.
* `lib/supabase/client.ts` (browser) now does the same for the cookie the browser writes itself on a token refresh (it used to write it without `Secure`).
* `next.config.ts` sends `Strict-Transport-Security: max-age=31536000`.
* `Secure` on plain http is NOT set (a browser would refuse to keep the cookie), so the same code works for the office LAN address `http://10.0.1.98:3210`
  while it exists. If people keep using the http LAN address, their cookie is not Secure; plan to retire that address after the move.

**Cookie "HttpOnly":** the sign-in cookie is deliberately *not* HttpOnly. The browser-side Supabase client (live pages, uploads, the notification poll) reads the session from
it. Making it HttpOnly means moving every browser-side data call behind server routes: a large change, a separate project. The risk is mitigated by the enforced CSP below
(limits what injected script can do) and by short token lifetimes (`GOTRUE_JWT_EXP=3600`).

**HSTS caution:** once a browser has seen the HSTS header it will refuse plain http for that name for a year. Switch https on and test it fully **before** deploying the
build that sends the header (the header is only sent when the address is https, so this is automatic, but do not point `NEXT_PUBLIC_APP_URL` at https before https works).

## 4. Content security policy: from "report only" to "enforced", step by step

Today the policy is sent as `Content-Security-Policy-Report-Only`: it blocks nothing; browsers report what they *would* have blocked to `/api/csp-report`, which keeps it in
the System Log. It still allows `'unsafe-inline'` and `'unsafe-eval'` for scripts because Next.js needs them without a per-request nonce, so even enforced it only stops
loading code from *other websites*. That is still worth having.

1. **Collect** (at least two weeks of normal use, all roles, all main screens): Admin > System Log, filter the source/action for CSP reports. Every report names the blocked
   address and the rule. Expected: none, or only browser extensions.
2. **Fix** what the reports show: a real page that loads something from another site gets that site added to `lib/http/csp.ts` (images, fonts, frames, connect), or the
   page is changed to stop loading it.
3. **Enforce the current policy**: build with `CSP_ENFORCE=1` (see `.env.example`). The same text is then sent as `Content-Security-Policy`. Roll out, then watch the System Log
   and ask a few people to click through the main screens. Rollback = build again without `CSP_ENFORCE`.
4. **Add `upgrade-insecure-requests`** to the policy once the site is https only.
5. **Tighten the scripts** (separate project): move to a per-request nonce so `'unsafe-inline'` / `'unsafe-eval'` can go. Next.js supports this, but every page must be tested,
   so it is done last and in a branch of its own.

## 5. Scheduled tasks run as SYSTEM (G-12)

The `CitykartDesk-*` tasks run as `SYSTEM` with the highest privileges. If a job or a script file were ever tampered with, it would run with full control of the server.

Do this (owner, on 10.0.1.98, one task at a time; the app keeps working meanwhile):

1. Create a local user with no admin rights, for example `ckdesk-jobs` (a long random password, "password never expires", **not** an administrator, not allowed to sign in
   through Remote Desktop). Type the password yourself; it is never written in a script.
2. Give it: *Log on as a batch job* (Local Security Policy > Local Policies > User Rights Assignment); **Read & execute** on `D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts`
   and on `app\.env.local`; **Modify** on the `logs` folder only if the shipper writes its cursor there (`system-log-shipper-cursor.json`); Node.js is under `C:\Program Files\nodejs` (readable by all).
3. In Task Scheduler open each `CitykartDesk-*` task > Properties > General > "Change User or Group" to that user, tick "Run whether user is logged on or not", enter the
   password when asked. Run the task once (right click > Run) and check "Last Run Result" is `0x0`.
4. **Lock the scripts folder** so a low-privilege account cannot change what SYSTEM-level or admin tasks run:
   `icacls "D:\Citykart_Applications\Citykart_Ckdesk_App\app\scripts" /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "ckdesk-jobs:(OI)(CI)RX"`
   and the same for `app\.env.local` (read only for `ckdesk-jobs`; `CRON_SECRET` lives there). Nobody but administrators may write in it.
5. Repeat the check after the next reboot: all tasks "Ready", last result `0x0`.

`install-cron-tasks.ps1` / `add-*-task.ps1` register tasks as SYSTEM; if the account is changed, edit `New-ScheduledTaskPrincipal` in them (`-UserId 'ckdesk-jobs' -LogonType Password`)
and supply the password at registration time.

## 6. Seed password of the owner account (G-05) - MUST DO ON LIVE

`supabase/seed.sql` (used for local test stacks, and part of the git history) creates `suraj@citykart.org` as `platform_owner` with a fixed password. Anyone who can read the
repository history knows it. If that password was never changed on the live database, that account is open to them.

**Check (read-only; run by the owner on 10.0.0.205, the postgres password is typed by the owner):**

```sql
select count(*) from auth.users
where email = 'suraj@citykart.org'
  and encrypted_password = extensions.crypt('Welcome@citykart@123', encrypted_password);
```

`0` = fine. `1` = the old password still works. The same check is part of `security-assessment-2026-10/07-FINAL-REMEDIATION/live-readonly/live-readonly-check.sql`.

**If it is 1, rotate:**

1. Sign in as that owner on the live site and use *Profile > Change password* (it asks for the current password and ends the other sessions). Choose a new long password
   (the app now wants 10+ characters with 3 of the 4 kinds).
2. Check again with the SQL above: it must now be `0`.
3. Because the old password was public, look at Admin > System Log (audit/security) for sign-ins of that account you do not recognise, and for roles granted since.
4. Consider the same for every other account created from the seed on live. Do not edit `seed.sql` (local stacks use it).

## 7. Open sign-up (D-12) - MUST CHECK ON LIVE

A database trigger (`handle_new_user`) puts **every** new sign-in account into the *oldest organisation*. Only administrators should ever create accounts, so open sign-up
must stay off at the sign-in service:

* `services\auth\.env` on 10.0.1.98 must contain `GOTRUE_DISABLE_SIGNUP="true"`.
  Check: `Select-String -Path D:\Citykart_Applications\Citykart_Ckdesk_App\services\auth\.env -Pattern GOTRUE_DISABLE_SIGNUP`.
* Test from the dev PC or the server (no account is created if it is off): `POST http://10.0.1.98:8443/auth/v1/signup` with the anon key and a made-up address must answer an error
  such as "Signups not allowed", **not** a user object. (Do not run this against live with a real address.)

## 8. Server settings to check once (owner, on the servers)

| Check | Where | Expected |
|---|---|---|
| Database time zone | `SHOW timezone;` on 10.0.0.205 (also in the read-only check) | Any is fine for stored times, but the **app** must run with `TZ=Asia/Kolkata` (the app logs a warning at start otherwise) |
| `PGRST_DB_MAX_ROWS` | `services\postgrest\postgrest.conf` (`db-max-rows`) | A limit exists (for example 1000..10000) so one call cannot return the whole table |
| `GOTRUE_DISABLE_SIGNUP` | `services\auth\.env` | `"true"` |
| `TRUSTED_PROXY_HOPS` | `app\standalone\.env.local` | unset today (direct access); `1` after section 3 |
| Secrets | `node scripts/check-secrets.mjs D:\Citykart_Applications\Citykart_Ckdesk_App\app\standalone\.env.local` | "OK". **`CRON_SECRET` must be at least 16 characters: shorter is refused by the cron routes since this release** |
| Node version | `node -v` on 10.0.1.98 | 22.x to 24.x (`package.json` "engines": `>=22 <25`) |
| Folder rights | `icacls ...\app\scripts` and `app\.env.local` | see section 5 |

## 9. Old files that pile up (G-26 / G-28)

The deploy scripts keep rollback copies; nothing deletes them, and they hold old code and (for `.env.local.bak-*`) old settings.

* `app\standalone-bak-<stamp>` (one per deploy) and `app\standalone-failed-<stamp>`: **keep the newest two** `standalone-bak-*`, remove the rest and every `standalone-failed-*`
  once the new build has run cleanly for a few days. List them: `Get-ChildItem D:\Citykart_Applications\Citykart_Ckdesk_App\app -Directory | Where-Object Name -like 'standalone-*' | Sort-Object Name`.
* `app\scripts-bak-<stamp>` (one per scripts update): keep the newest two.
* `.env.local.bak-*` (copies of the settings file made by hand): they contain secrets. Keep at most the newest one, in a folder only administrators can read; delete the others.
* In the repository, `Dockerfile`, `railway.toml` and `.claude/cron.md` belong to the retired Railway deployment; they carry a "HISTORICAL" note at the top and are kept only as a record.

## 10. `.claude/settings.local.json` (G-18)

This file pre-approves git/docker/npm commands for the AI assistant on one PC and must never be committed. It is now listed in `.gitignore`, but it was committed earlier, so
git still tracks it. **When you next commit, run once:** `git rm --cached .claude/settings.local.json` (this removes it from git only; the file stays on disk).
