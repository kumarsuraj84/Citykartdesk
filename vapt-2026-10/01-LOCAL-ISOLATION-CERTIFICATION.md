# 01 — LOCAL ISOLATION CERTIFICATION (VAPT 2026-10)

Date: 2026-10-15 · Branch: `vapt/local-2026-10` (created from `main` = `717e5c6`) · Gate: `audit-2026-10/guard/run.ps1` → `isolation-check.mjs`

**VERDICT: PASS (21 of 21 checks).** Dynamic testing is allowed against the disposable audit stack only.

## What is being tested (and nothing else)
| Item | Value |
|---|---|
| Application under test | local build of this checkout, port **3310** (audit app; the developer's own dev server on 3210 is never used) |
| Database | disposable Postgres container `supabase_db_ckdesk_audit`, port **55422**, 3,000 synthetic tickets, 336 synthetic profiles; schema = migrations up to **163** (checked: `request_status_transition_allowed`, `requests_one_per_intake_message`, `system_log`, `approval_email_codes` all present) |
| API / Auth / Storage | Supabase audit stack on **127.0.0.1:55421** (Kong), GoTrue, PostgREST, Storage with a local file volume (no NAS / SMB / S3) |
| Mail | Inbucket mail trap (`supabase_inbucket_ckdesk_audit`, port 55424): no mail leaves the machine |
| Developer stack | `citykart_desk` containers (ports 543xx) are a different set; not used |

## Gate results (actual output of this run)
C1 every URL setting is loopback · C2 no production/retired address in any setting · C3 e-mail / WhatsApp / OAuth / LLM settings blank (outbound business notifications disabled) · C4 Supabase URL is the audit stack · C5 app and cron target are localhost:33xx · C6 nothing falls through from the developer `.env.local` · C7 egress guard preloaded in the process · C8 every outward-facing variable explicitly defined · G1 guard refuses 9 forbidden targets before a socket opens · G2 loopback allowed · G3 `net.Socket#connect` patched · D1 audit containers running · D2 Auth mail goes only to the mail trap · D3 storage is a local volume · D4 no audit container setting references production · D5 developer stack untouched · B1 no mailbox settings in the audit DB · B2 no active WhatsApp/e-mail channel in the audit DB · B3 every auth user synthetic · B4 every ticket belongs to a synthetic requester · N1 no non-browser process holds a socket to 10.0.1.98 / 10.0.0.205 / 10.0.0.25 / 10.0.1.12 / 182.72.84.10 (the only connection to 182.72.84.10 is the user's own Chrome, which the VAPT never uses).

## Defence in depth
1. Allowlist egress guard (`audit-2026-10/guard/egress-guard.cjs`) is preloaded into every dynamic process through `NODE_OPTIONS`; a connection to anything other than loopback is refused before a socket is opened, and the refusal is logged.
2. The gate is re-run before every dynamic command because all dynamic commands go through `run.ps1`.
3. Source-review helpers (sub-agents) were forbidden from running the application or any scanner and could only query the audit DB read-only.
4. Production was never contacted for testing. (Separate, unrelated to VAPT: earlier in the same working session, before the VAPT started, the developer-requested release of the previous change was deployed to 10.0.1.98 over ssh. That was the normal release procedure, not a test, and no ssh connection was open when the gate ran: check N1.)

## Limits (stated honestly)
- The Windows firewall rule script (`windows-firewall-block.ps1`) is optional and was not re-applied; the egress guard covers Node processes only. A browser started by a human is outside the guard: the VAPT drives only local URLs.
- A disposable audit stack is a copy of the schema, not of production configuration (HTTPS, reverse proxy, real mail). Findings about those are source-review findings.
