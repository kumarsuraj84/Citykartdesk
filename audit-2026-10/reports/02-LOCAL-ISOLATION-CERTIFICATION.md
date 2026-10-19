# 02 — LOCAL Isolation Certification

*2026-10-13 · Dev PC 10.0.0.47 · Result: **ISOLATION GATE PASSED — 21 / 21 checks** (machine-checked by `audit-2026-10/guard/isolation-check.mjs`; latest raw result `audit-2026-10/evidence/isolation-check-latest.json`).*
*The gate is re-run automatically before every dynamic test (`audit-2026-10/guard/run.ps1 <command…>` refuses to start the command if any check fails).*

## 1. What was proven (and how)

| ID | Check | Result | Evidence |
|---|---|---|---|
| C1 | Every URL-valued setting in the effective configuration resolves to loopback | PASS | script output |
| C2 | No setting contains `10.0.1.98`, `10.0.0.205`, `10.0.0.25`, `10.0.1.12`, `182.72.84.10` | PASS | script output |
| C3 | Email / OAuth / LLM / push / webhook settings are blank → outbound business notifications disabled | PASS | `lib/email/config.ts` returns "disabled" with no config |
| C4 | Supabase URL = audit stack `127.0.0.1:55421` (not the dev stack `:54321`) | PASS | |
| C5 | App URL and cron target = `localhost:3310` | PASS | |
| C6 | Every key of the dev `.env.local` is overridden by the audit env (nothing falls through) | PASS | 10 keys had to be added during the gate — the gate caught them |
| C7 | `NODE_OPTIONS` preloads the egress guard | PASS | |
| C8 | Every outward-facing env var the code reads (`grep process.env` over `app lib components proxy.ts api/src`) is explicitly defined in the audit env | PASS | gate caught 7 undeclared (VAPID×3, INTAKE_WEBHOOK_TOKEN, OPERATOR_ALERT_WEBHOOK_URL, CSAT_LINK_SECRET, SMTP_SECURE) → fixed |
| G1 | Guard refuses 9 forbidden/non-loopback targets (the 4 internal IPs, the public IP, `8.8.8.8`, `graph.facebook.com`, two IPv4-mapped IPv6 forms) **before any socket is opened** | PASS | spy-based self-test: the original `connect` is never called |
| G2 | Guard lets loopback targets through | PASS | |
| G3 | `net.Socket#connect` is patched in the process | PASS | |
| Live | In a real Node process under the guard: `127.0.0.1:55421` → HTTP 200; `graph.facebook.com`, `api.resend.com`, `10.0.0.205`, `10.0.1.98`, `10.0.0.25` → **refused in-process** (`EAUDITGUARD`) | PASS (6/6) | `selftest-live.cjs`; refusals logged in `evidence/egress-denied.jsonl` (5 lines, all from the self-test) |
| D1 | Audit stack containers running (db, auth, rest, kong, storage, realtime, mail trap) | PASS | `docker ps` |
| D2 | GoTrue SMTP host = the audit mail-trap container | PASS | `docker inspect` |
| D3 | Storage = `STORAGE_BACKEND=file` on a local Docker **volume** (no SMB/NAS/S3 mounts) | PASS | `docker inspect` mounts |
| D4 | No environment value of any audit container references a production/retired address | PASS | |
| D5 | The user's dev stack is a different set of containers and was not used | PASS | |
| B1–B4 | Audit database: 0 SMTP rows, 0 active intake/WhatsApp channels, 0 non-synthetic auth users, 0 tickets at start | PASS | `psql` in the audit container |
| N1 | This PC's own TCP table (`netstat -ano`, no packets sent) shows **no socket owned by node/docker/ssh/psql/any non-browser process** towards any of the five addresses | PASS | see §4-b |

## 2. Layers of protection actually in force

1. **Separate disposable stack** `ckdesk_audit` (own containers, volumes, ports 554xx) — created from the repo's 156 migrations (all applied cleanly) + `seed.sql`. No production/dev data was copied into it.
2. **Audit environment** `audit-2026-10/env/.env.audit` — all outward-facing integrations blank; demo CLI keys only (public, identical on every Supabase CLI install; not production credentials).
3. **In-process egress guard** (`guard/egress-guard.cjs`, deny-by-default, loopback-only) preloaded into every Node process the audit starts (Next, vitest, scripts, workers). A forbidden target is refused **before DNS and before the OS socket call**, so no packet and no DNS query leaves the PC.
4. **Mail trap**: GoTrue → local mail-trap container; the app itself has no email transport configured, so its sends are logged no-ops. Where a test needs to *prove* a notification would be sent, a mock transport inside the test is used (and reported as such).
5. **Gate before every run** (`run.ps1`): 21 checks, fails closed.
6. **Process discipline**: no `ssh`/`scp`/`curl`/`Invoke-WebRequest` to any production address; the SSH key and the `\\10.0.1.12\e$` SMB mapping present on this PC were left untouched; the built-in browser pane is used only against `localhost:3310`.

## 3. Items found that could have broken isolation (and what was done)

| # | Finding | Impact | Handling |
|---|---|---|---|
| I-1 | **The existing dev database `citykart_desk` is a copy of production-derived data**: ≈1,012 profiles (≈416 `@citykartstores.com`, ≈109 `@citykart.org`), ≈694 tickets, 214 stores, 31 mobile numbers, 11 OEMs (vendor email lists), 3 active WhatsApp channel rows (test fixtures with fake phone ids), 2,323 vault secrets (test leftovers). | Real people's data sits on a developer PC; integration tests run against it. A mis-configured app start against it could mail/WhatsApp real people. (It currently has **no** SMTP/Resend and no real WhatsApp credentials, so nothing can send — verified.) | **Not used by the audit.** Audit uses the clean `ckdesk_audit` stack with synthetic users (`@example.test`/`@audit.test`). Logged as privacy finding (report 05). |
| I-2 | `next/font/google` (`app/layout.tsx`) makes `next build`/`next dev` download fonts from Google at build time. | Under the guard this is refused; dev falls back to system fonts (no functional impact on the audit). Note for deployment readiness: the **build machine needs Internet** for fonts. | Accepted; recorded for report 16. |
| I-3 | Windows has an SMB mapping `\\10.0.1.12\e$` (retired Main server), status *Disconnected*, and an SSH private key for the new servers exists in the user profile. | Could be used by mistake. | Not touched. Recommendation: remove the stale mapping. |
| I-4 | The user's Chrome (`chrome.exe`, pid 32748) holds a `CLOSE_WAIT` socket to `182.72.84.10:3210` (the public production URL) — the user's own browsing. | None for the audit (not an audit process). | Gate N1 classifies browser-owned sockets separately. **The audit never uses the user's Chrome / Claude-in-Chrome (it is signed into production).** |
| I-5 | Supabase CLI publishes API/DB/mail-trap ports on `0.0.0.0` (LAN-reachable); audit DB uses the default CLI password. | Synthetic data only, but another LAN host could reach `:55422`. | Accepted for a short-lived audit; stop the stack when idle (`npx supabase stop --workdir audit-2026-10/env`). |
| I-6 | The dev stack's `supabase_vector_citykart_desk` container is crash-looping (needs Docker TCP :2375). | None. | Out of scope; excluded from the audit stack. |

## 4. Limits of this certification (stated plainly)

a. **No OS-level firewall rule was added.** Changing Windows Firewall is a system-security setting and was not done unprompted. A ready-to-run, reversible script is provided: `audit-2026-10/guard/windows-firewall-block.ps1` (blocks outbound to the five addresses for the whole PC; run elevated if you want belt-and-braces; remove with `-Remove`).
b. The guard covers **Node processes**. Non-Node processes started by the audit (`docker`, `psql` inside containers, `netstat`, the built-in browser pane) are covered by configuration checks (D1–D4, N1) and by what they are pointed at, not by the guard. The browser pane is only ever navigated to `localhost:3310`.
c. Isolation is *proven by configuration + in-process refusal + local connection table*, not by a packet capture. No capture was taken.
d. Integrations that would require real third-party endpoints (Meta WhatsApp Cloud API, Gmail/Graph OAuth, Desktime, SMTP/IMAP providers, real NAS/SMB) **cannot be exercised end-to-end**; they will be reported as **BLOCKED / simulated**, never as verified. Where behaviour is reproduced with a local substitute (mock transport, local Storage file backend, local webhook posts with computed HMAC), the report says so.
e. Live production behaviour (HTTPS, firewall, NAS permissions, backup history) is **not** assessed — out of scope by instruction.

## 5. Certification

> I certify that, at 2026-10-13, every dynamic test in this audit runs only against loopback resources (audit stack `ckdesk_audit`, app on `localhost:3310`), that outward-facing integrations are disabled or mocked, that Node egress to `10.0.1.98`, `10.0.0.205`, `10.0.0.25` (and `10.0.1.12`, `182.72.84.10`) is refused in-process, and that this PC shows no audit-owned connection towards them. **Gate status: PASSED (21/21).** Re-check at any time: `powershell -NoProfile -File audit-2026-10\guard\run.ps1`.
