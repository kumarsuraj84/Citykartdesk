# 01 — Baseline and Isolation

*Post-audit remediation · 2026-10-13 · Dev PC 10.0.0.47 · branch `remediation/post-audit-2026-10`*

## 1. Production isolation statement

This remediation ran **only** on isolated local infrastructure. Nothing in this work connected to, queried, logged in to, deployed to, scanned, load-tested, or sent anything to the production app server (10.0.1.98), production database (10.0.0.205, `ckdesk`), production NAS (10.0.0.25), the retired server (10.0.1.12) or the public URL (182.72.84.10:3210). There was no Git push, no merge to `main`, no deployment, and no change to any GitHub workflow.

| Resource used | What it is |
|---|---|
| `ckdesk_audit` Supabase stack | A disposable local Docker stack (own containers, volumes and ports 554xx), created from the repository's migrations and a **synthetic** seed. API `127.0.0.1:55421`, database container `supabase_db_ckdesk_audit` |
| Audit app | `next dev` on `localhost:3310`, started through the isolation gate, with its own build folder (`NEXT_DIST_DIR=.next-audit`) |
| Files | The audit stack's own local Docker volume (file backend). No NAS, SMB or cloud storage |
| Mail | Blank outbound configuration (sends are logged no-ops) plus an in-process mock where a test needs to prove a send |
| Browser | The built-in browser pane, used only for `http://localhost:3310` |

Not touched: the user's own development server on port 3210 (it uses the development database, which contains production-derived records) was left running and unmodified; it was never used for any test, and the audit app was deliberately given a different port, database and build folder. Only audit-stack containers were ever stopped (storage and API containers, for the outage simulations in document 08), and every one was restarted.

## 2. Isolation gate (re-validated before every dynamic run)

`audit-2026-10/guard/run.ps1` runs a 21-check gate before **every** command that starts a test, a script or the app, and refuses to start the command if any check fails. The gate was never weakened, bypassed or edited during this work. Every test, load run and app start in this remediation went through it; the last recorded result before the final regression was **21 / 21 PASS** (`evidence/isolation-check-latest.json`), and the gate output heads every log in `evidence/remediation/`.

| Group | Checks (all PASS) |
|---|---|
| Configuration | C1 every URL-valued setting resolves to loopback · C2 no setting contains a production or retired address · C3 email / messaging / OAuth / LLM settings blank · C4 Supabase URL is the audit stack · C5 app and cron target are `localhost:33xx` · C6 every `.env.local` key is overridden by the audit env · C7 the egress guard is preloaded · C8 every outward-facing env var the code reads is explicitly defined |
| Egress guard | G1 refuses 9 forbidden or non-loopback targets before a socket opens · G2 lets loopback through · G3 `net.Socket#connect` is patched |
| Docker stack | D1 audit containers running · D2 auth mail goes only to the local mail trap · D3 storage is a local file volume · D4 no container setting references a production address · D5 the development stack is a different set of containers, untouched |
| Data | B1 no mailbox rows · B2 no active WhatsApp or email channel · B3 every auth user synthetic (bar the seeded bootstrap admin) · B4 every ticket belongs to a synthetic requester |
| Network | N1 no socket owned by node / docker / ssh / psql towards any production address (the user's own browser's connection to the public URL is the only one, and is not an audit process) |

Two things to know about the data checks: the **seeded bootstrap platform-owner account** (`suraj@citykart.org`) exists in the audit database from the repository seed; its password was never used. A synthetic platform-owner (`platformowner1@audit.test`) was created for the role-based UAT instead. And the database held ≈ 3,000 synthetic tickets for functional work; for the performance runs it was temporarily grown to 100,000 and 500,000 synthetic tickets and then trimmed back.

## 3. Starting state

| Item | State |
|---|---|
| Base commit | `e215ebd` (the Predefined Reports release already running in production). The remediation branch was cut from it; `main` was never modified |
| Branch | `remediation/post-audit-2026-10` — 27 commits, none pushed |
| Unrelated uncommitted work | Preserved untouched (the audit folder, earlier audit reports, mock-ups, the launch e-mailer and banner, `.claude/settings.local.json`, supabase snippets). None of it was committed or deleted |
| Auto-generated edit | Next's dev server appends `.next-audit` paths to `tsconfig.json` when run with a separate build folder; that edit was reverted with `git checkout` and never committed |

## 4. Baseline test results (before any fix)

| Check | Result |
|---|---|
| Type check | clean (0 errors) |
| Lint | 6 problems (1 error, 5 warnings), all pre-existing |
| Unit tests | 961 total · **961 passed · 0 failed** |
| Integration tests | 419 total · **389 passed · 6 failed · 24 skipped** |
| Source | `evidence/baseline/` |

The six integration failures are analysed in document 05 (four were tests reading the wrong database or a mis-cased team name, one was a data defect in the synthetic seed, one pair was intermittent).

## 5. Incidents and decisions during the work (recorded openly)

| # | What happened | How it was handled |
|---|---|---|
| 1 | The safety classifier stopped a script that forged a trusted header against the running local app to demonstrate finding D-001 | The finding was recorded as **confirmed by code**, and proven by a proxy-level unit test (`tests/unit/header-trust.test.ts`) instead of a live attack. It is not labelled "reproduced live" anywhere |
| 2 | Early "before" runs of the exploit tests really executed the attacks and changed synthetic data (an administrator promoted to platform owner, a technician moved to another organization, leftover test organizations) | The synthetic accounts were restored from snapshots; every test now snapshots and restores the rows it touches and removes its own test organizations |
| 3 | A scripted "before" run of the equivalence test stopped halfway at 500k scale and left test fixtures in the database | Found, cleaned (manager link, tickets, organization, workflow) and the test was made scale-aware |
| 4 | The built-in browser shares the cookie name `sb-127-auth-token` for `localhost` regardless of port | Only affects that browser pane; noted for anyone who runs both apps in one browser |
| 5 | A tool call used a session-management function by mistake | It was rejected by its own validation and did nothing |
