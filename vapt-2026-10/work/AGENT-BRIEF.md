# VAPT reviewer brief (shared by all source-review agents)

You are one reviewer in a LOCAL white-box security assessment (VAPT) of Citykart Desk, a Next.js 16 (App Router, Server Actions) + self-hosted Supabase (Postgres, PostgREST, GoTrue, RLS) help-desk app. Roles: `user` (requester), `agent` (technician), `manager`, `admin`, `platform_owner`. The project owner has authorised this assessment of their own application, LOCAL ONLY.

## Hard safety rules (never break)
- Read source only. Do NOT edit, create or delete any file under the repo except your own output file named in your task (under `vapt-2026-10/work/`).
- Do NOT connect to anything except the disposable local audit database through the local Docker engine: `docker exec supabase_db_ckdesk_audit psql -U postgres -tAc "<read-only SQL>"` (SELECT / catalog queries only — never INSERT/UPDATE/DELETE/DDL). The container `supabase_db_citykart_desk` is the developer's own database: do not touch it.
- Never contact 10.0.1.98, 10.0.0.205, 10.0.0.25, 10.0.1.12, 182.72.84.10 or any other host. Do not start the app, do not run scanners, do not run `npm`/`npx`/`vitest`, do not run git commands that change anything. No ssh.
- Never print passwords, keys, tokens or real employee data into your report (the repo's `.env.local` is the developer's file: do not read it).
- Next.js in this repo is a version with breaking changes: if you need framework behaviour (Server Actions, proxy.ts, route handlers), read `node_modules/next/dist/docs/` rather than relying on memory.

## What to read first
`CLAUDE.md`, `AGENTS.md`, `audit-2026-10/reports/01-CURRENT-ARCHITECTURE.md`, `audit-2026-10/remediation/10-UPDATED-DEFECT-REGISTER.md` (earlier audit IDs `D-0xx`; those marked Fixed must be RE-VERIFIED by reading the current code, not trusted), `proxy.ts`, `lib/auth/*`, `lib/supabase/*`. Current code is the truth; documents may be stale. Recent LOCAL changes now in the checkout: no manual priority change, no service change, "Catch me up" summary, System Log, approval e-mail link/codes, e-mail reply sync.

## What to produce
Write ONE markdown file at the path given in your task. For every **candidate vulnerability** give:
- `ID` (use your prefix + number), `Severity` (Critical/High/Medium/Low, with a one-line reason; CVSS-style thinking), `Module`, `file:line` evidence (exact, quote the few key lines),
- **Plain-language explanation** (2-3 simple sentences a non-programmer understands: what is wrong, who could do what, business impact),
- **Exploit scenario** (which role/user, which call, with what input) and **how to prove it on the LOCAL audit stack** (a short recipe: e.g. "sign in as synthetic requester A via fixtures in `tests/setup/fixtures.ts`, call server action X with ticket id of requester B, expect error"),
- **Suggested minimal fix**,
- `Confidence`: CONFIRMED-BY-CODE (the code path is unambiguous) / PLAUSIBLE (needs a dynamic check) / (do not list pure speculation).
Separate sections: (1) candidate vulnerabilities, (2) controls you verified as sound (brief list with file:line, so the report shows coverage), (3) areas you could not assess and why. Be precise and skeptical: check whether a control exists elsewhere (RLS, DB trigger, proxy) before calling something a vulnerability; a missing app-level check backed by an RLS policy that really blocks it is not a finding (note it as defence-in-depth at most). Do not pad: a short list of real findings beats a long list of guesses. Do not count the same flaw twice because it appears in several endpoints — group them.
