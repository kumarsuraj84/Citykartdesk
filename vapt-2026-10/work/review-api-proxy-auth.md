# VAPT source review: proxy, authentication, and all route handlers (prefix VA-API)

Scope: `proxy.ts`, `lib/auth/*`, `lib/http/*`, `lib/supabase/*`, `lib/rate-limit.ts`, `lib/cron-auth.ts`, `lib/secure-compare.ts`, `next.config.ts`, `lib/actions/auth.ts`, and all 27 files from `find app -name route.ts` (24 under `app/api`, 2 under `app/auth`, plus `app/api/version`). Read-only. The only database use was catalog reads (`pg_policies`) on `supabase_db_ckdesk_audit`. Nothing was run and no host was contacted.

Next.js is 16.2.9 (`node_modules/next/package.json`). The `proxy.ts` convention is used.

Summary: no Critical finding. The earlier Critical/High fixes in this area (D-001 forged header, D-034 open redirect, D-051/052/053/054 storage, D-058/059 OAuth state, D-061/062 WhatsApp) are present and correct in the current code. The most serious remaining items are transport and cookie security (VA-API-01), the shared default password with a UI-only forced reset (VA-API-02), and weak sign-in throttling (VA-API-03). A proxy bypass through file-extension paths (VA-API-04) and a few secret-reuse and unauthenticated-write issues follow.

---

## 1. Candidate vulnerabilities

### VA-API-01  Sign-in and session cookies travel over plain HTTP and are readable by JavaScript (D-018 / D-037, re-verified open)
- **Severity:** High. The production URL is `http://182.72.84.10:3210` (CLAUDE.md), reachable from the internet through a port forward. Passwords, access tokens and refresh tokens cross the internet in clear text. A 400-day refresh cookie that scripts can read makes any future XSS or network sniffing a full account takeover.
- **Module:** proxy / session cookies / headers
- **Evidence:**
  - `proxy.ts:103-111`: `setAll` copies the `options` from `@supabase/ssr` straight onto the response (`supabaseResponse.cookies.set(name, value, options)`). There is no override that adds `secure`, `httpOnly` or a shorter `maxAge`.
  - `lib/supabase/server.ts:18-24`: the same pass-through.
  - `lib/supabase/client.ts:5-11`: a browser client is used. For `@supabase/ssr` browser clients the cookie must be readable by script, so it is not HttpOnly.
  - `next.config.ts:72-87`: no `Strict-Transport-Security`. The comment says HSTS is "deliberately NOT set".
  - `next.config.ts:84`: CSP is only `Content-Security-Policy-Report-Only`. `lib/http/csp.ts:14` allows `'unsafe-inline' 'unsafe-eval'` for scripts, so it would not stop XSS even if enforced.
  - The only cookie code that sets `secure` is the approval-verified cookie, `lib/actions/approvalEmail.ts:98-101` (`secure: ...startsWith('https')`).
- **Plain language:** The site is served without encryption. Anyone on the same network path (Wi-Fi, ISP, a compromised router) can read employee passwords and session cookies as they travel. The login cookie is also readable by page scripts and lives for over a year.
- **Exploit scenario:** An attacker on the network path (a store's Wi-Fi or the office LAN) captures the login POST or any later request and replays the `sb-...-auth-token` cookie to be signed in as that person, including an admin.
- **Prove on the LOCAL stack:** Run the local app on `http://localhost:3210`. Sign in as a fixture user from `tests/setup/fixtures.ts`. In DevTools > Application > Cookies, check `HttpOnly`, `Secure` and `Expires/Max-Age` for the Supabase auth cookie (expected: HttpOnly off, Secure off, about 400 days). Check the response headers for `Strict-Transport-Security` (expected: absent) and `Content-Security-Policy` (expected: only `-Report-Only`).
- **Minimal fix:**
  - Put TLS in front (a reverse proxy with a certificate).
  - Then set `secure: true` and a bounded `maxAge` in the `setAll` options, and add HSTS.
  - Move the CSP from report-only to enforced once reports are clean, ideally with nonces to drop `unsafe-inline` and `unsafe-eval`.
  - Do not expose port 3210 to the internet in the meantime without a VPN.
- **Confidence:** CONFIRMED-BY-CODE that no override exists. PLAUSIBLE for the exact default cookie attributes, which need one dynamic look.

### VA-API-02  Shared default password `<shared default password>` for bulk-created users; forced reset is enforced only by a page layout (D-011, re-verified open)
- **Severity:** High. Every bulk-imported account that has not yet changed its password has a password known to anyone who reads this repository or guesses the pattern. Account names are employee e-mail addresses, so they are easy to guess. The import accepts roles up to admin and platform_owner (the import-side role guard was not reviewed here).
- **Module:** auth / `lib/actions/admin/users.ts`, `lib/actions/auth.ts`, `app/(app)/layout.tsx`
- **Evidence:**
  - `lib/actions/admin/users.ts:522`: `const DEFAULT_BULK_PASSWORD = '<shared default password>'`. Used at `:699`: `row.password?.trim() || DEFAULT_BULK_PASSWORD`.
  - `lib/actions/admin/users.ts:718`: `must_reset_password: true`.
  - The flag is read in only one place that enforces anything: `app/(app)/layout.tsx:37-39` (`redirect('/reset-password')`). A grep of `lib app proxy.ts` finds no other enforcement. Route handlers (`/api/*`) and Server Actions do not run that layout.
  - Migration `156_post_audit_critical_security.sql:83` and `:108` let a signed-in user set their own `must_reset_password` to false (only a change to TRUE is blocked). So a user can keep the default password and clear the flag directly through PostgREST.
  - `lib/actions/auth.ts:22`: the sign-in throttle is 10 tries per minute per account (see VA-API-03).
  - `supabase/config.toml:182`: `minimum_password_length = 6`. A user can bypass the app's 8-character rule by calling GoTrue directly (D-036, open).
- **Plain language:** New users created in bulk all start with the same password. The site only nags them to change it by redirecting page views. Someone who calls the server directly, or simply never opens a page, is never forced. Anyone who knows an employee's e-mail can try the default password.
- **Exploit scenario:** From any browser or script, sign in with `<employee email>` and `<shared default password>` against a bulk-created account that never logged in. Then call `/api/*` or Server Actions directly. The "must reset" redirect never triggers because no layout runs.
- **Prove on the LOCAL stack:**
  1. Use `bulkCreateUsers` (or the admin client) to create a synthetic user without a password.
  2. Sign in as that user with `<shared default password>`.
  3. Call `GET /api/notifications/new` with the session (expected 200, despite `must_reset_password=true`).
  4. Use the user's token to `PATCH /rest/v1/profiles?id=eq.<self>` with `{"must_reset_password": false}`; the 156 trigger allows it.
- **Minimal fix:**
  - Generate a random one-time password per user, or send invitations only (the invite flow already exists).
  - Enforce `must_reset_password` in the proxy or in `getCurrentProfile()` for every request type, not only in the layout (allow only `/reset-password` and the sign-out action).
  - Make the column un-clearable by the user (clear it only inside `resetPassword` through the admin client).
  - Raise GoTrue `minimum_password_length` to 8 or more.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-API-03  Sign-in and password-reset throttling is per account only, in memory, and easy to turn against users
- **Severity:** Medium. There is no limit on how many different accounts one attacker can try, and a stranger can lock a named user out. There is no lockout policy, no CAPTCHA and no second factor.
- **Module:** `lib/rate-limit.ts`, `lib/actions/auth.ts`
- **Evidence:**
  - `lib/actions/auth.ts:20-28`: the limits are `login:${email}` 10 per minute and, only when the address is trusted, `login-ip:${ip}` 60 per minute.
  - `lib/rate-limit.ts:49-54`: `getClientIp()` returns `null` unless `TRUSTED_PROXY_HOPS >= 1`. The documented production path is a port forward straight to the app (no reverse proxy), so the per-address limit is off. This is correct as a fail-safe, but it means one attacker can spray one password across every account at the speed the server allows.
  - `lib/rate-limit.ts:6-15`: the store is a process-local `Map` capped at 50,000 keys. Over the cap, the oldest keys are evicted first. About 50,000 requests with random e-mail strings flush a victim's counter. The key is the raw submitted string, unbounded in length.
  - `lib/actions/auth.ts:68-72`: `forgot:${email}` 3 per hour. Anyone can use up a colleague's three resets and block them for an hour.
  - The same limiter state is lost on every restart or deployment.
  - `supabase/config.toml:197-209` (local) rate limits GoTrue per IP. In production all sign-ins reach GoTrue from the app server's single address, so those per-IP numbers behave as a global limit (this needs a dynamic check against the real GoTrue settings).
- **Plain language:** The login page slows repeated guesses on one account, but it does not slow someone who tries one common password on all accounts. It also lets a stranger repeatedly block a named person from signing in.
- **Exploit scenario:**
  - Password spraying: for each of the known user e-mails, send one request with `<shared default password>` or `Citykart@2026`. Each account sees only 1 try per minute and nothing is limited.
  - Targeted lockout: send 11 bad passwords for `victim@company` every minute. The victim's sign-in returns "Too many login attempts" the whole time.
- **Prove on the LOCAL stack:** Start the local app with `TRUSTED_PROXY_HOPS` unset. Post `signInWithPassword` for 100 different synthetic e-mails in a minute (all succeed in reaching GoTrue, none limited). Then post 11 attempts for one e-mail and see the 11th refused, followed by a correct password also refused for the rest of the minute.
- **Minimal fix:**
  - Rate-limit by address once the real proxy chain is known (set `TRUSTED_PROXY_HOPS`).
  - Add a progressive per-account delay (not a hard block) with a check on the known device.
  - Cap the key length and hash the key.
  - Alert (System Log security event) on many different accounts failing from one source.
  - Consider TOTP for admin and platform_owner.
  - Consider a per-address cap on forgot-password.
- **Confidence:** CONFIRMED-BY-CODE for the design. PLAUSIBLE for the eviction bypass and for the GoTrue per-IP effect.

### VA-API-04  Any path ending in `.png`/`.jpg`/`.svg`/... skips the proxy's session check and the public body-size guard
- **Severity:** Medium (defence-in-depth gap; becomes High only if some page, route or action relies on the proxy as its only gate).
- **Module:** `proxy.ts`, `lib/http/public-body-limit.ts`
- **Evidence:**
  - `proxy.ts:35-39`: `isPublicAsset = ... || /\.(svg|png|jpg|jpeg|gif|webp|ico)$/.test(pathname)` returns `passThrough(request)` before anything else. This runs before the `publicActionBodyTooLarge` check at `:42` and before the session check.
  - Dynamic routes accept dotted values, for example `/requests/[id]`, `/approve/[token]`, `/csat/[token]`, `/api/requests/[id]/pdf`. So `/requests/x.png` is matched by the app router but never inspected by the proxy.
  - Server Action IDs are global (an action can be posted to any matched URL with a `Next-Action` header), so the 30 MB body allowance (`next.config.ts:55-57`) applies to such requests.
  - Body guard `lib/http/public-body-limit.ts:7-15` only covers the page prefixes `login|auth|forgot-password|reset-password|approve|csat`.
  - Effect on identity: `passThrough` strips the verified-user headers (`proxy.ts:21-22`), so `getCurrentProfile()` falls back to `supabase.auth.getUser()` (`lib/queries/profiles.ts:19-28`). Identity is not forgeable this way, which is why this is not a bypass of authentication by itself.
- **Plain language:** The login gate has a side door for image-looking addresses. It does not let a stranger act as someone else, but it does let a stranger reach pages and server actions without the usual redirect and without the small-upload limit that protects the public forms.
- **Exploit scenario:** An unauthenticated client POSTs a 29 MB body to `/approve/x.png` (or `/requests/x.png`) with a `Next-Action` header copied from the public login form. The proxy does not return 413 or redirect, so the server buffers the body before the action runs (memory pressure and CPU on a single Node process).
- **Prove on the LOCAL stack:** Compare `POST /login` and `POST /approve/x.png` (both with the same large body and a copied `Next-Action` header, no cookie). Expect 413 for the first and no 413 for the second. Also `GET /requests/anything.png` without a cookie: expect a render attempt or layout redirect, not the proxy's `/login?next=` 307.
- **Minimal fix:** Remove the extension regex. Serve real static files from `public/` through the existing exclusions in `config.matcher` (add the specific filenames there if needed). Apply the body-size guard before any fast path, and apply it to every non-authenticated POST. A default-deny allowlist of file names is safer than a suffix rule.
- **Confidence:** CONFIRMED-BY-CODE for the bypass of the proxy. PLAUSIBLE for the action-body consequence (needs one dynamic request).

### VA-API-05  One secret (`CRON_SECRET`) is the fallback key for many unrelated purposes, and it can be sent to a third party
- **Severity:** Medium (blast radius and disclosure risk, not an exploit by itself).
- **Module:** `lib/cron-auth.ts`, webhooks, OAuth, signed links, `lib/auth/verified-user.ts`
- **Evidence:** each of these falls back to `CRON_SECRET` when its own secret is unset:
  - `lib/auth/verified-user.ts:14` (the signing key of the verified-user header is `SUPABASE_SERVICE_ROLE_KEY || CRON_SECRET`).
  - `lib/intake/oauth.ts:55` (OAuth state key).
  - `lib/approvals/email-link.ts:19` (approval-link and code key: `APPROVAL_LINK_SECRET || CSAT_LINK_SECRET || CRON_SECRET`).
  - `lib/csat/token.ts:11` (CSAT link key).
  - `app/api/intake/webhook/gmail/route.ts:30` and `outlook/route.ts:37`: `INTAKE_WEBHOOK_TOKEN ?? INTAKE_WORKER_SECRET ?? CRON_SECRET`.
  - `app/api/system-log/ingest/route.ts:16`.
  - Disclosure: `app/api/intake/oauth/callback/route.ts:81` picks `INTAKE_WEBHOOK_TOKEN ?? INTAKE_WORKER_SECRET ?? CRON_SECRET`, then `:98` builds `.../webhook/outlook?token=<that secret>` and `:102` sends the same value as `clientState` to Microsoft Graph. If the dedicated token is unset, the cron secret is stored in Microsoft's subscription and appears in query strings/log files.
  - `lib/cron-auth.ts:17-25`, the Gmail and Outlook webhooks and `ingest` (the ingest route requires 16+ characters, the others do not): no minimum length is enforced for `CRON_SECRET` on cron routes or webhooks.
- **Plain language:** If only one shared secret is configured, learning it opens the cron endpoints, the mail webhooks, the signed approval/rating links and the OAuth state. The Outlook connection also hands that secret to Microsoft.
- **Exploit scenario:** A log, a backup of the Graph subscription, or any exposed `x-cron-secret` header gives an attacker `CRON_SECRET`. They can call every cron endpoint (including `?sampleTo=`, see VA-API-10), forge webhook calls, and sign approval/CSAT links for any ID they know.
- **Prove on the LOCAL stack:** Set only `CRON_SECRET` in the local env, run the mailbox-connect flow against a stub, and see the secret appear in the `notificationUrl` the app sends. Then compute an approval-link signature with the same secret.
- **Minimal fix:** Require separate, 32-byte-or-longer values for each purpose and fail closed when missing (remove all `?? CRON_SECRET` fallbacks). Never place a secret in a URL that a third party stores. Use the Graph `clientState` only, or sign the callback URL with a per-subscription random value.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-API-06  XLSX preview checks the size declared in the zip header, which an attacker controls
- **Severity:** Medium (authenticated denial of service of the single Node process).
- **Module:** `app/api/storage/attachment/request/[id]/preview/route.ts`, `lib/attachments/xlsx-preview.ts`
- **Evidence:**
  - `lib/attachments/xlsx-preview.ts:30-46` reads `uncompressed` from the zip central directory (`buf.readUInt32LE(offset + 24)`) and `:71-74` rejects only on those declared numbers.
  - `:78` then lets ExcelJS decompress and parse the real contents. A crafted file can declare small sizes and inflate far larger.
  - The route gate is only `file_size > MAX_PREVIEW_FILE_BYTES` where `file_size` is a stored column (`preview/route.ts:32`) and `mime_type` equal to the xlsx type (`:29`). Both columns are set at upload time by the uploader. The actual buffer length is checked at `xlsx-preview.ts:68`.
- **Plain language:** The preview limits how big an uploaded spreadsheet may become when opened, but it believes the file's own claim about its size. A crafted file can make the server use huge memory when anyone previews it.
- **Exploit scenario:** A low-privileged requester attaches a small crafted `.xlsx` (under 5 MB, claims 1 MB inflated) to their own ticket and opens the preview, or asks a technician to. The Node process runs out of memory and every user is disconnected.
- **Prove on the LOCAL stack:** Build a decompression-bomb xlsx whose central-directory sizes are falsified (use a throwaway local script that you run outside the repo; do not commit). Upload it as a requester fixture and call `GET /api/storage/attachment/request/<id>/preview`. Watch memory of the local app process.
- **Minimal fix:** Inflate with a hard output cap (streaming unzip with a running byte counter, abort at the limit) or run the parse in a worker/child process with a memory limit and timeout.
- **Confidence:** PLAUSIBLE (needs the dynamic check; the code path is unambiguous).

### VA-API-07  Unauthenticated `/api/csp-report` (and the signed-in `/api/events`) can flood and forge System Log rows
- **Severity:** Medium. Disk growth and log pollution reachable by anyone who can reach the port; admins may be misled by forged "security" rows.
- **Module:** `app/api/csp-report/route.ts`, `app/api/events/route.ts`, `lib/syslog/*`
- **Evidence:**
  - `app/api/csp-report/route.ts:16`: the rate-limit key uses the first `x-forwarded-for` entry as sent by the caller (`(req.headers.get('x-forwarded-for') ?? '').split(',')[0]`), unlike the careful `getClientIp()` used for sign-in. Rotating the header value gives a fresh bucket for every request.
  - `:21-22`: `await req.text()` reads the whole body first and checks `text.length > MAX_BODY` afterwards, so a very large body is fully buffered before being refused.
  - `:40`: the flood key is built from attacker-controlled `directive|blocked|page`, so every distinct value is a distinct key and bypasses the "10 per minute" collapse in `lib/syslog/writer.ts:42-72` (the writer keeps only 2000 keys).
  - `:34-36`: rows are stored as `action: 'security.csp_violation'`, `severity: 'warning'`, with attacker text in the message.
  - `app/api/events/route.ts:27-29` has the same read-then-check pattern. `:51-67`: the loop writes a System Log row for every `js_error` event in the body, not only the first 50 that `lib/events/record.ts:16` accepts. Message, path, stack and click target are free text from the signed-in user.
- **Plain language:** Anyone who can reach the server can keep sending fake "browser blocked something" reports, each stored as a database row, and make the admin log screens fill with invented warnings. A signed-in user can do the same with fake browser errors.
- **Exploit scenario:** A script posts thousands of reports per minute to `/api/csp-report` with a random `X-Forwarded-For` and random `blocked-uri`. Each creates a row; the System Log table and the writer spool grow, and real incidents are hidden in the noise.
- **Prove on the LOCAL stack:** Send 500 POSTs to `/api/csp-report` with distinct `X-Forwarded-For` and `blocked-uri` values and count new `system_log` rows with action `security.csp_violation` (read-only `SELECT count(*)` on the audit DB afterwards).
- **Minimal fix:**
  - Use `getClientIp()` and a global cap (for example 60 rows per minute for the whole route).
  - Reject by `Content-Length` before reading.
  - Slice `body.events` to 50 before the loop.
  - Key the flood limit on `directive` only (a small fixed set).
  - Add a size and row-count ceiling for the whole `source: 'browser'` category.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-API-08  `/auth/confirm` POST has no origin check (login CSRF)
- **Severity:** Low
- **Module:** `app/auth/confirm/route.ts`
- **Evidence:** `:42-56`: the POST handler reads `token_hash` and `type` from a form and calls `verifyOtp`, which sets the session cookie. Route handlers do not get the Server Actions Origin/Host comparison, and there is no CSRF token.
- **Plain language:** A web page controlled by an attacker can submit a form to this endpoint using the attacker's own reset token. The victim's browser then becomes signed in as the attacker's account (the `/reset-password` page follows), and anything the victim then types in is recorded under the attacker.
- **Exploit scenario:** The attacker requests a password reset for their own account, extracts `token_hash` from the e-mail, and hosts a form posting it to `https://<app>/auth/confirm` with `type=recovery`, `next=/home`. A colleague visits that page.
- **Prove on the LOCAL stack:** From a different origin (a local static HTML file served on another port), post the form with a fixture user's `token_hash`. Expect a `Set-Cookie` and a 303 to `/reset-password`.
- **Minimal fix:** Reject the POST when the `Origin` (or `Sec-Fetch-Site`) is not the app's own origin. SameSite on the existing cookies does not cover this because the cookie is being set, not sent.
- **Confidence:** CONFIRMED-BY-CODE. The impact is Low because the attacker needs their own valid token and gains nothing from the victim directly.

### VA-API-09  A deactivated user, or one whose sessions should be revoked, keeps working until the access token expires
- **Severity:** Low (up to the access-token lifetime, 1 hour in `supabase/config.toml:165`).
- **Module:** `proxy.ts`, `lib/actions/admin/users.ts`, `lib/actions/auth.ts`
- **Evidence:**
  - `proxy.ts:122`: `getClaims()` verifies the JWT locally when asymmetric signing keys are in use and does not ask GoTrue whether the session still exists (the comment at `:117-121` says so).
  - `lib/actions/admin/users.ts:122`: deactivation sets `ban_duration`, which blocks sign-in and refresh, but does not revoke the session that already exists.
  - `app/(app)/layout.tsx` and `lib/queries/profiles.ts` do not check `is_active`. RLS policies reviewed in the audit DB depend on role and org, not `is_active`.
  - `lib/actions/auth.ts:133`: `updateUser({ password })` does not end other sessions. `adminSetPassword` (`users.ts:~885`) does not call a sign-out for the user.
- **Plain language:** When an administrator turns a person off, that person's already-open session keeps working for up to an hour. The same applies to a changed password: someone holding a stolen session stays in.
- **Exploit scenario:** An employee is deactivated at 10:00 and keeps raising and reading tickets until about 11:00 (or longer if the production GoTrue is configured with a longer expiry).
- **Prove on the LOCAL stack:** Sign in as a fixture user, call `toggleUserActive(userId, false)` as an admin, then repeat `GET /api/notifications/new` with the user's original cookie. Expect 200 until the token expires.
- **Minimal fix:** On deactivation also call `admin.auth.admin.signOut(userId, 'global')` (or delete the user's rows from `auth.sessions` through a controlled function). Check `is_active` in `getCurrentProfile()` and return `null` when false. Do the same after `adminSetPassword`.
- **Confidence:** PLAUSIBLE (depends on the production signing-key type and expiry; the code does not check).

### VA-API-10  `?sampleTo=` on the approval-reminder cron can mail live Approve/Reject links to any address
- **Severity:** Low (needs `CRON_SECRET`, see VA-API-05).
- **Module:** `app/api/approvals/reminders/route.ts`, `lib/approvals/reminders.ts`
- **Evidence:** `route.ts:15-16` accepts any syntactically valid e-mail address as `sampleTo`. `lib/approvals/reminders.ts:101-110` builds the real approver's list with `approvalLinkUrls(w.approvalId, p.id)` (signed approve and reject links) and `:125-128` sends it to `sample`. The e-mail is also composed from real data for the approver "with most waiting".
- **Plain language:** A test option lets whoever holds the cron secret send a real approver's approval buttons to any outside address.
- **Exploit scenario:** With a leaked `CRON_SECRET`, an attacker calls `GET /api/approvals/reminders?sampleTo=attacker@example.com`. The mail contains working approval links for a named approver. The attacker still needs the e-mail code, or the approver's login, to use them (`lib/actions/approvalEmail.ts:32-47`), so the immediate impact is information disclosure of ticket titles and requester names.
- **Prove on the LOCAL stack:** Call the route with the local `CRON_SECRET` and `sampleTo=test@localhost.test` against a local mail sink (never a real address). Read the captured message.
- **Minimal fix:** Restrict `sampleTo` to the company domain or to an allowlist, strip the Approve/Reject links from sample mails, and log it as a security event.
- **Confidence:** CONFIRMED-BY-CODE.

### VA-API-11  Account-existence signals and a reset-mail flood path on forgot-password
- **Severity:** Low
- **Module:** `lib/actions/auth.ts`, `lib/email/auth-mail.ts`
- **Evidence:**
  - `lib/email/auth-mail.ts:59-62`: for an unknown address the function returns early and no mail is sent, so the response time is shorter than for a known address (it also generates a link and sends a message).
  - `lib/email/auth-mail.ts:54-56`: the reply "Email is not set up yet..." reveals a configuration state to anyone.
  - `lib/actions/auth.ts:68-72`: three resets per hour per address, and with no trusted address, no per-caller limit. An attacker can send up to three reset mails to each of thousands of employees per hour from the company mailbox.
  - `lib/actions/auth.ts:42-43` returns a specific "deactivated" message, but only after a correct password, so it is not an enumeration path.
  - Sign-in error text for an unknown user vs. a wrong password is the same generic message (`sanitizeError`, `lib/actions/auth.ts:34`).
- **Plain language:** The page says the same thing for every address, but a stopwatch tells known from unknown addresses, and the form can be used to send unwanted reset mails to staff.
- **Prove on the LOCAL stack:** Time 50 requests each for a fixture user and a random address through `forgotPassword`; compare the medians. Count messages in the local mail sink after submitting a list of fixture addresses.
- **Minimal fix:** Do the same amount of work for both cases (queue the send in the background and return at once). Add a global per-hour cap for reset mails.
- **Confidence:** PLAUSIBLE for timing; CONFIRMED-BY-CODE for the missing global cap.

### VA-API-12  Webhook design weaknesses (low individually)
- **Severity:** Low
- **Module:** `app/api/intake/webhook/gmail|outlook|whatsapp/route.ts`
- **Evidence:**
  - Gmail (`gmail/route.ts:28-33`): the only authentication of the Pub/Sub push is a static token in the URL query string. Google's signed OIDC JWT is not verified. Query strings end up in proxy and access logs.
  - Outlook (`outlook/route.ts:23-33`): the unauthenticated `GET` echoes any `validationToken` as `text/plain`. This is safe in practice because `nosniff` is global (`next.config.ts:80`), but it makes the endpoint an open echo.
  - Outlook POST (`:35-49`): `?token=` is checked first, then each notification's `clientState` again (`:77`). Neither has a replay or timestamp guard; a replay of a captured POST re-triggers a worker sync (idempotent downstream, not re-verified here).
  - WhatsApp POST (`whatsapp/route.ts:54-72`, `lib/whatsapp/signature.ts:13-25`, `lib/whatsapp/webhook-handler.ts:300-310`): the signature is correct (raw body, HMAC-SHA256, `timingSafeEqual`, missing secret or channel fails with 401, mixed phone numbers refused). There is no timestamp; replay protection is whatever `processConversationInbound` does for a repeated message id (the `duplicate` flag in `webhook-handler.ts:198,206`; the dedup was not read to the end here). The per-caller limit (`:56`) is off when `TRUSTED_PROXY_HOPS` is unset.
  - WhatsApp GET challenge (`whatsapp/route.ts:18-29`, `lib/whatsapp/config.ts:92-104`): unauthenticated, no rate limit, and each call reads the Vault secret of every active WhatsApp channel (one RPC each) before comparing. An attacker can generate steady database and Vault load, and the loop compares channel by channel, which leaks little but costs a lot.
- **Plain language:** The mail and WhatsApp hooks check the right things, but the Gmail one relies on one URL secret, and the WhatsApp verification page can be hammered by anyone to make the server do database work.
- **Prove on the LOCAL stack:** Send 200 `GET /api/intake/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y` and count `intake_read_credential` RPC calls in the PostgREST/DB log (audit DB only). Re-post a captured signed WhatsApp body twice and check that only one conversation row is written.
- **Minimal fix:** Verify the Pub/Sub OIDC token (audience = the push URL). Rate-limit the GET challenge and cache the verify tokens in memory for a minute. Reject WhatsApp events older than a few minutes if Meta's payload carries a timestamp.
- **Confidence:** CONFIRMED-BY-CODE for the missing limits and the URL-token design; PLAUSIBLE for the replay behaviour.

### VA-API-13  Approval e-mail code: guessing budget grows with each new code request
- **Severity:** Low (needs a valid signed link first)
- **Module:** `lib/actions/approvalEmail.ts`, `lib/approvals/email-link.ts`
- **Evidence:** `email-link.ts:84-87`: 6-digit random code, `CODE_MAX_ATTEMPTS = 5` per code. `approvalEmail.ts:59` allows 3 new codes per 10 minutes and `:87` allows 8 verifications per 10 minutes, both with in-process counters that reset on every restart. Over the 7-day link life this is about 15 guesses per 10 minutes, roughly 15,000 guesses, around 1.5% of the code space for a determined attacker who holds the link. Each new code also e-mails the real approver.
- **Plain language:** Someone who has the approver's e-mail link could, over several days, keep asking for new codes and guessing. The odds are small but not zero, and the approver would be mailed repeatedly.
- **Prove on the LOCAL stack:** Use a fixture approval and link. Call `requestApprovalCode` and `verifyApprovalCode` repeatedly and count how many wrong guesses are accepted per hour across restarts.
- **Minimal fix:** Persist the attempt counters in the database per approval and lock the approval's e-mail path for a few hours after, say, 20 total failures. Notify the approver of failures.
- **Confidence:** PLAUSIBLE.

### VA-API-14  Hygiene items (Info)
- `lib/storage/publicPath.ts:44-45`: the shape regex is built in a template literal with `\.` which JavaScript turns into a bare `.`. The pattern accepts any single character in place of the dot (for example `uuidXpng`). Not exploitable because only objects that exist can be served, but the intended check is weaker than documented. Fix by using `\\.` (or a normal regex literal).
- `app/api/health/route.ts`: unauthenticated and runs a service-role query on every hit; exposes database status, latency and package version. Acceptable for a probe, but it is a cheap way to load the database. Consider a short in-memory cache.
- `lib/supabase/admin.ts:11-24` and `lib/syslog/record.ts:87-91`: client IP is never stored in production (hop count is unset), so sign-in failures in the System Log carry no source address. This weakens investigations.
- `app/auth/callback/route.ts:6,18`: the redirect target uses the request's own origin; `next` is safe (`lib/auth/safe-next.ts:4-17`). `/auth/confirm` POST prefers `NEXT_PUBLIC_APP_URL`. Aligning both is cleaner.
- `supabase/config.toml:176,221`: `enable_signup = true` (local). Whether production GoTrue allows self-signup was not visible from the repo. If it does, `handle_new_user()` (migration 134) creates a profile in the oldest organization for any stranger. This must be checked on the real GoTrue settings (`GOTRUE_DISABLE_SIGNUP`), not only in this file.

---

## 2. Controls verified as sound

- **Verified-user header (D-001):**
  - Stripped on every path: public assets (`proxy.ts:20-28`), the PUBLIC_API_ROUTES fast path (`proxy.ts:82`), `/csat` and `/approve` (`:86,:90`), and the main path (`:166-167`).
  - Signed with HMAC-SHA256 and compared with `timingSafeEqual` after a length check (`lib/auth/verified-user.ts:31-39`).
  - Fails to `undefined`, which makes callers re-check the session (`lib/queries/profiles.ts:19-28`), when the key, signature or header is missing or wrong.
  - A client cannot choose its own user id.
  - The same header feeds `x-actor-id` only in the server-side admin client (`lib/supabase/admin.ts:11-24`).
  - No time or request binding on the signature, but it never leaves the server, so replay is not reachable.
- **Request stamping:** `x-request-id`, `-path`, `-method` are always overwritten (`proxy.ts:11-18`).
- **Open redirect (D-034):** `safeNextPath` rejects backslashes, control characters, `//`, absolute URLs and anything that resolves off-origin (`lib/auth/safe-next.ts:4-17`). It is used in the sign-in action (`lib/actions/auth.ts:50`), `/auth/callback` (`:8`) and `/auth/confirm` (`:12,:46`). The proxy's own `/login` redirect (`proxy.ts:141-151`) is a separate check, but because it sets `url.pathname` on an absolute URL it stays on the same host.
- **Public-route allowlist:** exact-match set (`proxy.ts:65-82`), not a prefix. Every listed route authenticates itself (verified in section 2 below). Other `/api/*` routes require a session, with the exception noted in VA-API-04.
- **Shared-secret routes:** `alerts/run`, `business-rules/run`, `csat/run`, `desktime/sync`, `email/inbound-sync`, `intake/cron/classify`, `approvals/reminders`, `system-log/archive` all call `verifyCronSecret` (`lib/cron-auth.ts:17-25`), which uses `timingSafeEqual` (`lib/secure-compare.ts:12-17`) and returns 503 when `CRON_SECRET` is unset or empty (fail-closed). `system-log/ingest` also requires 16 or more characters (`:16`), allows only error/event rows from listed sources, forces `actorId: null, orgId: null` (`:53-54`), caps the body (512 KB) and entries (200) (`:11-12`), and clamps `at` to within 24 hours (`:52`). The audit trail cannot be written from there.
- **Webhook signatures:**
  - WhatsApp: raw body read before parse (`whatsapp/route.ts:61`), size caps (`:49,:59-62`), HMAC-SHA256 with `timingSafeEqual` (`lib/whatsapp/signature.ts:13-25`), the channel is chosen by the destination `phone_number_id` and never by the sender (`lib/whatsapp/webhook-handler.ts:260-288`), and a missing secret gives 401 (`:289-296`).
  - Gmail and Outlook tokens use `secureCompare`, and 401 when no secret is set (`gmail/route.ts:31`, `outlook/route.ts:38`).
  - Outlook rechecks `clientState` per notification (`:77`).
- **OAuth:**
  - `start` and `callback` both require admin or platform_owner (`oauth/start/route.ts:11`, `callback/route.ts:20`).
  - The state is HMAC-signed with a 15 minute life and bound to the user who started the flow, checked in the callback (`callback/route.ts:32`; `lib/intake/oauth.ts:51-95`).
  - The secret must be at least 16 characters (`oauth.ts:53-57`), and a blank value counts as unset.
  - The channel is re-read with the admin's own org filter.
  - Credentials go to Vault through a service-role RPC (`callback/route.ts:62-71`).
  - The token and authorize endpoints are fixed provider URLs: no user-controlled URL is fetched in any route.
- **Ticket PDF:** UUID shape check (`pdf/route.ts:16`), signed-in check (`:19`), and every query runs on the viewer's RLS session (`getRequestById`, comments, activity, attachments, approvals, CSAT). Internal comments and internal attachments are filtered (`ticket-pdf-model.ts:151-153,178-180`), and requesters do not receive technician-only fields (`:119-120`). The file name derives from the ticket number only. Response is `attachment` with `no-store`.
- **Attachment routes:**
  - Request attachments: the row is read with the caller's session, so RLS is the access check (`request_attachments_select` in the audit DB hides deleted rows and internal attachments from requesters). The path must start with the request's own id (`lib/attachments/serve.ts:32-34`). The content type comes from a fixed extension table, never from the stored column (`:18-21`). Only images, PDF and plain text are inline (`:16,:23-29`), `nosniff` is set (`request/[id]/route.ts:58`), and `no-store` is used. SVG and HTML are not in the table, so they download as `application/octet-stream`.
  - Intake attachments: RLS limits to agent roles in the same org (`intake_attachments_select` in the audit DB). The path must have exactly three clean segments (`lib/attachments/intake-key.ts:74-79`). Always `Content-Disposition: attachment` and `nosniff` (`intake/[id]/route.ts:46-58`).
  - Public bucket route: only `icons` and `avatars` (`public/[bucket]/[...path]/route.ts:28,35-37`). The path must match one of two uuid shapes with no traversal characters (`lib/storage/publicPath.ts:57-65`), and the content type comes from the extension. Images only.
- **`/api/notifications/new`:** the user id comes from `getCurrentProfile()`. The query uses the user's own RLS session and an `.eq('user_id', profile.id)` filter (`:18-33`). The `since` value is parsed to a date (`:15-16`).
- **`/api/events`:** signed-in only (`:16-18`). The user id comes from the signed header. Only browser event kinds are accepted (`:34-37`). Body is capped at 64 KB, and a per-user limit exists (`:20-23`). Redaction runs in `toRow` (`lib/syslog/row.ts`).
- **`/api/admin/audit`:** role gate (`:7-9`) plus RLS: `admin_audit_log`, `request_activity`, `task_activity` are org-scoped in the audit DB. Paging is clamped (`lib/queries/admin.ts:209-211`). The entity type is allowlisted.
- **Security headers:** `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` on every route (`next.config.ts:76-87`). `ignoreBuildErrors` is gone (`:88-89`). No `productionBrowserSourceMaps` is set (default off). There is no debug route in `app/api` beyond `health` and `version`.
- **Server Actions CSRF:** `serverActions.allowedOrigins` is not configured (`next.config.ts:55-57`), so Next's built-in same-origin Origin/Host comparison is the protection (see `node_modules/next/dist/docs/01-app/02-guides/data-security.md`). That is correct for a single origin without a reverse proxy. If a reverse proxy with a different Host is added, `allowedOrigins` must be set.
- **Error leakage:** `sanitizeError` hides driver details; cron routes return details only to the secret holder; `console.error` is used for server-side detail.
- **Password-reset links:** the GET shows a button and the POST consumes the one-time token, so mail scanners cannot burn it (`app/auth/confirm/route.ts:5-7,42-56`). Inputs are HTML-escaped (`:11,:24-26`), the `type` is allowlisted, `Referrer-Policy: no-referrer` is set and the page is `no-store`.
- **Outbound HTTP:** `fetchWithTimeout` and the resilient fetch add time limits, and writes are not retried unless provably unsent (`lib/supabase/resilient-fetch.ts:50-56`).
- **Public form body cap (D-039):** present for the listed page prefixes and refuses a missing `content-length` (`lib/http/public-body-limit.ts:10-16`). It is bypassed by VA-API-04.
- **Role changes during a session:** the role is read from the database on every request through `getCurrentProfile()`, so a demotion takes effect at once (the session lifetime concerns are in VA-API-09).

---

## 3. Areas I could not assess (and why)

- **Production GoTrue / Kong / PostgREST settings** (self-signup, JWT expiry and algorithm, per-IP rate limits, password policy, cookie options of the gateway): not in the repo except the local `supabase/config.toml`; needs a read of the real service configuration, which this assessment must not touch. Several items above (VA-API-03, -09, -14) depend on it.
- **Server Actions** under `lib/actions/**` (authorization of each action, cross-tenant writes): outside my scope, assigned to other reviewers. I only read `lib/actions/auth.ts`, `lib/actions/approvalEmail.ts`, `lib/actions/csatPublic.ts` and the parts of `lib/actions/admin/users.ts` that touch passwords and deactivation.
- **`/approve/[token]` and `/csat/[token]` pages** and their helper libraries (`lib/approvals/email-code.ts`, `email-state.ts`, `lib/csat/public.ts`): read only the link/token signing and the actions above, not the code storage, the lockout counter inside `consumeApprovalCode`, or what `describeApprovalLink` reveals to a visitor who is not the approver.
- **The separate intake worker** (`INTAKE_WORKER_URL`, `api/` folder, `x-intake-worker-secret` consumer) and what it does with `channelId`, `historyId`, `graphMessageId` from the webhooks.
- **`lib/email/inbound.ts`, `lib/whatsapp/media.ts`, `lib/conversations`** (reply-sync trust of `From:`, media download and storage, duplicate handling), listed here only where the route handlers call them.
- **`scripts/cron-tick.mjs` and `scripts/log-shipper.mjs`**: only skimmed for how the secret is sent (header `x-cron-secret`). Transport protection of that call (localhost or LAN, plain HTTP) was not reviewed.
- **Dynamic behaviour** (actual `Set-Cookie` attributes, 413 vs. bypass, timing, memory use of the xlsx preview): everything marked PLAUSIBLE needs a run on the local stack; I did not start the app.
- **Pages' own auth checks** for the `.png`-suffixed bypass in VA-API-04 (I did not enumerate every page and server component).
- **Edge deployment details** (Docker image, Node version, reverse proxy, firewall rules), not in my scope.
