# HTTP probe captures (LOCAL audit app only)

Date 2026-10-15. Target: the disposable audit application on `127.0.0.1:3310` (egress guard on, isolation gate 21/21), built from this checkout. "OLD" = the build made with Next.js 16.3.8 but before the application fixes; "NEW" = the final build. All probes used `curl` against loopback; no credentials were used except where stated. Output below is copied from the terminal, trimmed to the relevant lines.

## H1 — Next.js image optimizer (framework advisory GHSA-2xp9-vwfh-vxw4, AVIF RCE; SSRF advisories)
```
GET /_next/image?url=%2Fcitykart-desk-icon.png&w=64&q=75   Accept: image/avif,image/webp  -> 200 image/webp
GET /_next/image?url=%2Fcitykart-desk-icon.png&w=64&q=75   Accept: image/avif            -> 200 Content-Type: image/png   (AVIF is not produced: it is not enabled in next.config.ts)
GET /_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75                           -> 400   (remote images refused: no images.remotePatterns)
GET /_next/image?url=http%3A%2F%2F127.0.0.1%3A55421%2Fauth%2Fv1%2Fhealth&w=64&q=75        -> 400
```
Reading: the AVIF image-processing condition of that advisory is not met in this configuration, and remote image fetching is refused. The Windows file-system advisory (GHSA-p293-qw3h-jr36, CVSS 9.0) does not depend on the image route and applies to the production host until Next.js is upgraded there.

## H2 — page-looking paths ending in .png (VA-API-04)
```
OLD  GET /requests/x.png (no cookie)  -> 307 http://127.0.0.1:3310/login?retry=1       (the proxy skipped its session check; the page layout redirected)
OLD  GET /home.png                    -> 404
NEW  GET /requests/x.png (no cookie)  -> 307 http://127.0.0.1:3310/login?next=%2Frequests%2Fx.png   (proxy gate applies)
NEW  GET /citykart-desk-icon.png      -> 200   (real root-level file still served)
```
Reading: it was never a login bypass (the page's own check held); it was a gap in the first line of defence and in the body-size guard.

## H3 — body-size guard on public forms, 3 MB POST with a Server-Action header
```
OLD  /login 413 · /approve/abc 413 · /approve/abc.png 404 · /requests/abc.png 404 · /csat/abc.png 404
```
Reading: the oversize POST to image-looking paths was not reached by the action (404), so no memory-pressure effect was shown; the guard gap was closed anyway.

## H4 — forged browser-security reports (VA-API-07 / VA-INT-08 / VA-ADM-08)
```
OLD  120 POSTs to /api/csp-report, each with a different X-Forwarded-For and blocked-uri:  system_log rows security.csp_violation: 0 -> 120
NEW  the same 120 POSTs:                                                                    rows added: 30   (global cap 120/min, per-address cap 30/min)
```

## H5 — login CSRF on /auth/confirm (VA-API-08)
```
OLD  POST /auth/confirm  Origin: http://evil.test  token_hash=abc&type=recovery  -> 303 http://localhost:3310/forgot-password?expired=1   (the token was processed)
NEW  POST /auth/confirm  Origin: http://evil.test                                -> 403
NEW  POST /auth/confirm  Origin: http://localhost:3310 (the site's own origin)   -> 303 .../forgot-password?expired=1  (legitimate form still works)
NEW  POST /auth/confirm  (no Origin header: not a browser)                       -> 303
```

## H6 — response headers (VA-API-14, VA-API-01)
```
OLD  GET /login: X-Content-Type-Options: nosniff; X-Frame-Options: SAMEORIGIN; Referrer-Policy: strict-origin-when-cross-origin;
     Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...; X-Powered-By: Next.js
     (no Strict-Transport-Security)
NEW  X-Powered-By absent. Strict-Transport-Security is sent only when NEXT_PUBLIC_APP_URL starts with https (not the case here).
```
Browser check on the final build, signed in as a synthetic technician: the Supabase login cookie (`sb-…-auth-token`) was readable by page scripts (`document.cookie`), i.e. not HttpOnly, over `http:`. This is how the Supabase browser client works and is why transport security (HTTPS) matters (VA-API-01, decision D-018/D-037).

## H7 — build/start
The audit app was built with `next build --webpack` (the production build mode) and run with `next start`; `/api/health` answered `{"status":"ok","db":"ok"}`; the build step downloads web fonts from Google and executes no application code (documented in `work/build-and-start-audit-app.ps1`).
