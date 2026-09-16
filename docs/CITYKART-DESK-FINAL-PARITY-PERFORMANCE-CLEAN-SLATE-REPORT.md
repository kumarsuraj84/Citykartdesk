# Citykart DESK — Final Parity, Performance & Clean-Slate Report — 2026-09-16

Final closure pass following the day's JWKS remediation → test hardening →
load testing → Main deployment arc. Every claim below is backed by a
command actually run today, not inferred from the earlier daily report.

---

## 1. Executive summary

- **Source parity**: Local, Git (`origin/main`), and Main's deployed
  application source are now **byte-identical** across all 657 git-tracked
  application files, all 924 database columns, all RLS policies, and all
  9 `org_module_access` flags. 11 real discrepancies were found and fixed
  along the way (7 line-ending drifted files, 4 missing files, 1 disabled
  feature flag).
- **A real, previously-broken feature was found and fixed on Main**: the
  `intake` module flag (`org_module_access`) was disabled, hiding the
  "Intake Intelligence" nav item entirely — this is what you'd noticed
  missing. Fixed and verified. The multi-mobile-number feature
  (`profile_mobile_numbers`, migration `20240101000140`) was independently
  confirmed present and schema-identical on both sides — it was never
  actually missing on Main.
- **Performance root cause is now conclusively answered**: Main's own
  services (CitykartApp/Proxy/Storage/Auth/PostgREST + their DB
  connections) consumed **71.7 CPU-seconds** during a target-scale
  (220 requester/60 technician) run, while the load-testing **tool
  itself** consumed **312.9 CPU-seconds** — a 4.4:1 ratio, measured by
  per-process CPU attribution on Main itself. The 90–100% CPU and low
  success rate seen earlier today was overwhelmingly the test harness's
  own overhead (342 OS processes spawned to simulate 20 logical workers),
  not a genuine Main capacity limit. Per your direction, this was
  determined **without** using any external machine.
- **Both environments are now a true clean slate**, not just
  load-test-residue-free: Local's 8 organizations dropped to 1, its 18
  profiles dropped to 3 (1 bootstrap admin + 2 real, correctly-preserved
  pre-provisioned employee accounts — see §10), all disposable test/UAT
  fixtures removed. Main was already clean at the operational-data level;
  a deeper sweep across all 97 tables found nothing further to remove.
  Both sequences reset to `CKSD-000001`.
- **No hardcoded IP hazard for a future public-IP deployment**: audited
  the entire git-tracked source tree — zero references to `10.0.1.12` or
  any private IP in real application code. The one hit was a stale
  default inside dead, unused load-test tooling, now fixed. Every
  client-facing URL is environment-variable-driven with proper
  `<SERVER_IP>` placeholder templates.
- **Honestly incomplete**: the soak test, full functional UAT, security
  UAT, and browser/HTTP performance benchmarking from the original
  mega-prompt were **not** performed this pass — see §13. `npm test`,
  `tsc --noEmit`, `npm run lint`, and `npm run build` were all run and are
  clean.

---

## 2. Git commit verification

Ran actual `git fetch origin` + `git merge-base --is-ancestor` checks, not
a read of the daily report:

| Commit | Purpose | In `origin/main`? |
|---|---|---|
| `849f67d` | JWKS rollout tooling; department-fixture fix | ✅ |
| `e2534cc` | Department-fixture fix documentation | ✅ |
| `a3bf265` | Test-suite idempotency, clean-slate manifest/validator | ✅ |
| `8bb8a94` | Test-hardening report | ✅ |
| `a488995` | Load-test harness; PostgREST pool bottleneck fix | ✅ |
| `f820ccf` | `GOTRUE_JWT_VALID_METHODS` regression fix | ✅ |
| `5a86494` | Load-test harness header-forwarding fix | ✅ |
| `de30c3c` | EADDRINUSE retry + error-masking fixes | ✅ |
| `6890559` | `loadtest/setup/cleanup.mjs` | ✅ |
| `fd62920` | Daily activity report | ✅ |
| `6b2079b` | Storage-schema USAGE grant check | ✅ |
| `2eb0e6e` | Remove dead service-role client; require explicit Main URL | ✅ |

Local `HEAD` == `origin/main` `HEAD` (`2eb0e6e`) at the time of this report.

---

## 3. Local/Git/Main source parity — evidence

SHA256-hashed every git-tracked file under `app/`, `lib/`, `components/`,
`types/`, `proxy.ts`, `package.json`, `package-lock.json`,
`supabase/migrations/`, `deploy/`, `tests/` (657 files) on both Local and
Main.

**First pass**: 646/657 matched immediately; 11 discrepancies found:
- 7 files (`admin/categories/[slug]/page.tsx`, `admin/form-templates/[id]/page.tsx`,
  `intake/inbox/[id]/WorkspaceClient.tsx`, `intake/review/[id]/ReviewClient.tsx`,
  `projects/[id]/loading.tsx`, `requests/[id]/loading.tsx`,
  `tasks/[id]/loading.tsx`) differed only in line-ending style (Main had
  CRLF, Git/Local had LF) — confirmed via `file` command, byte-identical
  content otherwise. Not a code fix; a housekeeping sync.
- 4 files were genuinely absent from Main's tree
  (`deploy/windows/generate-jwt-signing-key.js`,
  `deploy/windows/validate-deployment.ps1`, `tests/setup/test-department.ts`,
  `tests/setup/uat-mode.ts`).

All 11 copied/normalized to Main. **Second pass: 657/657 byte-identical.**
No rebuild was required for this — Next.js only reads source at build
time, and today's earlier rebuild (§6) already used the current source.

### Database schema parity

- **924/924 columns** (`table.column:type:nullable`) across the entire
  `public` schema: identical, byte-for-byte, after normalizing line
  endings in the exported comparison files.
- **RLS policies**: an initial diff showed every policy referencing
  `auth.uid()` on Local rendering as `uid()` on Main. Verified this is a
  `search_path`-dependent text-rendering artifact of `pg_get_expr`, not a
  real difference — confirmed both sides have the exact same
  `auth.uid()` function (identical `pg_get_functiondef` output), and a
  re-diff with `SET search_path TO pg_catalog` forcing fully-qualified
  names on both sides produced **zero differences**.
- **Functions**: Main has 37 more (`pgcrypto` extension functions:
  `armor`, `crypt`, `digest`, `pgp_*`, etc.) — confirmed these come from
  `pgcrypto` being installed into the `public` schema on Main vs a
  dedicated `extensions` schema on Local. No missing application function
  on either side; purely an extension-installation-location difference.
- **Triggers**: Main has 3 extra (`buckets.protect_bucket_control_*` —
  newer Storage-service-internal hardening triggers) and Local has 1 extra
  (`subscription.tr_check_filters` — a Supabase Realtime trigger). Neither
  matters: the application never uses Supabase Realtime anywhere (verified
  — the only `.subscribe(` call in the codebase is the browser's native
  Push API in `lib/push/client.ts`, unrelated), and Main's extra triggers
  are strictly more protective Storage-internal behavior.

---

## 4. Main environment-specific configuration (documented, expected to differ)

| Item | Reason it legitimately differs |
|---|---|
| `.env.local`, `services/*/.env` | Real credentials, real IP (`10.0.1.12`), real ports — see §12 for why this is safe |
| NSSM service config | Windows-service wiring specific to Main's machine |
| `pgcrypto` extension schema | Installation detail, no functional effect (§3) |
| `ai_applications` (6 real rows on Main, 0 on Local) | Admin-configurable per-org table, no code-level seed — genuine divergent real config, not a gap (§10) |
| `global_sla_config` (4 rows on Main, 0 on Local) | Documented in `CLEAN-SLATE-SEED-MANIFEST.md` as legacy/unread by current code — inert either way |
| Local's "Information Technology" department / "hr" team | Real pre-existing bootstrap-org structure on Local that was never mirrored to Main — a genuine business-data gap, not a code/deployment defect; not invented on Main by this pass since that's a data decision, not a fix |

No unexplained Main-only source-code patch remains.

---

## 5. Critical fix re-verification (all of today's fixes, re-checked live)

| Check | Result |
|---|---|
| GoTrue JWKS non-empty, ES256 | ✅ 1 key, `alg=ES256` |
| `GOTRUE_JWT_VALID_METHODS` includes HS256 | ✅ present |
| `service_role` BYPASSRLS | ✅ `t` |
| DB connection uses `127.0.0.1` + `sslmode=disable`, not bare `localhost` | ✅ |
| PostgREST `db-pool` | `10`, unchanged (no saturation evidence anywhere today — correct per your own instruction not to change it without proof) |
| `resilient-fetch.ts` retries `EADDRINUSE` | ✅ present in deployed source |
| `create-request-core.ts` uses `maybeSingle()` + `sanitizeError()` | ✅ present |
| `business-hours.ts` distinguishes load-failure from misconfiguration | ✅ present |
| Fresh ES256 login token accepted by PostgREST | ✅ real end-to-end test, `200` |
| **New this pass** — Storage schema `USAGE` grant | Found missing (`service_role`/`anon`/`authenticated` had full table grants but no schema `USAGE` — every Storage operation failed with `permission denied for schema storage`). Fixed: `GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`. Verified with a real create-bucket → upload → download (content matched) → delete-object → delete-bucket round trip, all `200`. Added as an automated check to `validate-deployment.ps1`. |
| **New this pass** — `org_module_access.intake` | Found disabled on Main, enabled on Local — this is what caused the "Intake Intelligence" menu to be missing. Fixed: `UPDATE org_module_access SET enabled = true ...`. All 9 module flags now match exactly between Local and Main. |

---

## 6. Local build/regression (Parts 12)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean, 0 errors |
| `npm run lint` | ✅ 0 errors, 3 pre-existing warnings in files untouched today (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx` — all `react-hooks/exhaustive-deps` / unused-var, not regressions) |
| `npx vitest run` (full suite) | ✅ **82 files passed, 4 skipped; 657 tests passed, 18 skipped, 0 failed** |
| `npm run build` | ✅ succeeds, all routes compile |

The 18 skipped tests are **all** the intentionally-gated
production-catalog UAT tests (`RUN_PRODUCTION_CATALOG_UAT`, default off) —
4 files: `stage7-1-semantic-role-real-service`, `stage7a-canonical-identity-search`,
`stage7a-mandatory-fields-flow`, `stage7b-parity-sla-assignment`. None are
silently-passed; each is explicitly skip-reasoned. This run happened
*after* today's Local clean-slate cleanup, so — unlike earlier in the
day — there was no leftover load-test data to cause an
environment-coupled false failure. Genuinely 0 failures.

Main's own runtime deployment was re-validated separately (§5, §9) rather
than run through this same automated suite, since these tests write to a
database and are designed for Local/CI, not a live shared production box.

---

## 7. Performance / capacity root-cause (Parts 4–10)

### What was tried

You directed a same-machine, per-process CPU-attribution test on Main
instead of an external load generator (your call, given the "Main is the
only server, Local is dev-only" architecture principle) — see the
conversation for why an external-machine test was considered and set
aside in favor of this approach; the small external-diagnostic org/persona
data that was created before that decision was fully cleaned up
immediately.

### Method

Ran the same target-scale ramp (220 requesters/60 technicians, ~660
ticket-creation attempts) directly on Main, while continuously sampling
`Get-Process` for every `node`/`auth`/`postgrest`/`postgres` process by
PID every 1.5s for the run's duration (8,886 valid samples). Classified
each PID as a **pre-existing service** (started before the run) or a
**load-test worker** (started during the run window), then summed each
group's CPU-time increase.

### Result

| Group | CPU-seconds consumed |
|---|---|
| Main's own services (CitykartApp+Proxy+Storage via `node`, `auth`=GoTrue, `postgrest`, `postgres` backend connections) | **71.68** |
| Load-test harness's own processes (342 distinct OS processes spawned to simulate 20 logical "workers" — `vitest`'s fork-pool overhead) | **312.89** |

**Ratio: 4.4:1, harness over services.** Main's own application/database
stack shows healthy, low CPU usage even under this exact target load;
the 90–100% CPU and low ticket-creation success rate observed earlier
today was overwhelmingly the test tool's own process-spawning overhead
competing for the same machine's resources — not a genuine Main capacity
problem.

### Consequence

- Per your instruction, PostgREST's `db-pool` **stays at 10** —
  no test at any scale today (warm-up/medium/target, on Main, at any
  point) ever showed material connection queuing.
- The retry/error-masking fixes (§5) remain correct and necessary
  regardless of this finding — they made genuine transient failures
  honestly reported instead of misleadingly reported; they don't and
  weren't meant to eliminate the harness's own resource contention.
- **Not done this pass**: soak test, browser/HTTP UX benchmarking, full
  functional/security UAT (see §13). The capacity *root cause* is
  answered; the remaining acceptance checklist items are not.

---

## 8. Clean-slate — Local (Parts 15–18)

### Pre-cleanup inventory (evidence, not invented)

| Entity | Before | Classification |
|---|---|---|
| Organizations | 8 | 1 bootstrap (`CityKart`) + 7 disposable test-tenant fixtures (`Stage5 Tenant Org B`, `UAT7B Tenant Org B`, `Stage4 Tenant Org B`, `Stage3.2 Blocked Org`, `Stage1.1 Security Org B`, `Stage3.1 Title Org B`, `Stage3 Cat Sec Org B`) |
| Profiles | 18 | 1 bootstrap admin (Suraj Kumar) + **2 real pre-provisioned employee accounts** (`ankur.pahwa@citykartstores.com`, `kaushlesh.kumar@citykartstores.com` — real corporate domain, never signed in, zero requests/assignments, but genuine accounts, not test fixtures — confirmed via `auth.users` and cross-checked for any real activity before deciding) + 15 disposable UAT7a/D04 test fixtures |
| Departments/Teams | 3/3 | 1 real (`Information Technology`/`hr`, with Ankur as a real team member) + 2 disposable test fixtures each |
| Services/Categories/Sub-categories | 1/5/5 | All disposable UAT7B/UAT-fixture test data |
| Intake channels, approval workflows, request conversations | 3/1/9 | All disposable test data |
| `intake_audit_log` | 2,469 | All test-run noise (`whatsapp_message_processed` etc.) |
| `owner_audit_log` | 42 | All test-run noise (`whatsapp_channel_not_found`/`_conflict`) |

### Cleanup performed

Deleted, in FK-safe order, verified via dependency checks before each
delete (never assumed): the 7 disposable organizations and their
department/team/`global_sla_config` remnants; the 15 disposable UAT7a/D04
profiles and their `auth.users` rows; their 9 `request_conversations`;
the disposable services/categories/sub-categories/intake
channels/approval workflow (+ its steps); the 1 disposable
`team_members` row on the disposable team; all `intake_audit_log` and
`owner_audit_log` test-run noise; 3 `admin_audit_log` rows tied to the
deleted test services/categories.

**Explicitly preserved and not touched**: the bootstrap org/admin, Ankur
and Kaushlesh's accounts, the real `Information Technology`
department/`hr` team, Ankur's real `hr` team membership, all system seed.

### Post-cleanup verification (`clean-slate-validator.mjs`)

```
organizations: 1 (bootstrap)
profiles: 3 (1 admin + 2 real pre-provisioned, correctly preserved)
requests/tasks/projects/approvals/notifications: 0
departments/teams/team_members: 1/1/1 (real, not test)
business_hours: 7 (5 active) | sla_escalation_rules: 4 | alert_rules: 4
task_statuses: 5 | task_priorities: 4 | request_priorities: 4
retention_policies: 5 | app_settings: 1 | org_module_access: 9
intake_pipeline_config: 1
CKSD sequence: last_no=0 (next ticket: CKSD-000001)
```

---

## 9. Clean-slate — Main (Part 19)

Swept **all 97 public tables** (not just `requests`), row counts on both
sides after all of today's work:

```
organizations: 1 | profiles: 1 | requests/tasks/projects/approvals/
notifications/services/categories/sub-categories/departments/teams/
team_members/intake_*/conversation_*: all 0
business_hours: 7 | sla_escalation_rules: 4 | alert_rules: 4
task_statuses: 5 | task_priorities: 4 | request_priorities: 4
retention_policies: 5 | app_settings: 1 | org_module_access: 9
intake_pipeline_config: 1
ai_applications: 6 (real admin-configured data, not residue - §4)
global_sla_config: 4 (legacy/inert - §4)
CKSD sequence: last_no=0 (next ticket: CKSD-000001)
```

Main was already clean of load-test residue from the daily cleanup; this
deeper, full-table sweep found nothing further to remove. The
external-diagnostic org/persona data created and then abandoned earlier
this pass (§7) was fully cleaned immediately after that decision, and is
included in the "0" counts above.

---

## 10. Storage cleanup (Part 20)

No test/UAT files were ever uploaded to Main's or Local's real Storage
buckets during today's work — the only Storage writes were the isolated,
self-contained functional probe (§5), which created and deleted its own
throwaway bucket/object as part of the same test. Nothing further to
clean.

---

## 11. Sequence inventory and reset (Part 21)

Searched the full schema for every business-facing numbering mechanism:
no Postgres `CREATE SEQUENCE` objects exist in `public` at all; the only
numbering-related columns are `requests.request_no` (generated from
`request_sequences.last_no`) and two unrelated columns (`kb_articles.helpful_no`,
a vote counter; `profile_mobile_numbers.mobile_number`, phone data, not a
sequence). **`request_sequences` (prefix `CKSD`) is the only business
counter in the entire application.** Confirmed reset to `last_no=0` on
both Local and Main — next ticket on either side will be `CKSD-000001`.
No verification tickets were left behind on either side.

---

## 12. Hardcoded-IP / public-deployment readiness audit

Per your specific question about port-forwarding to a public IP: searched
the entire git-tracked source tree for `10.0.1.12` and any private-IP
literal (`192.168.*`, `10.*`).

**Result: one hit, in dead code.** `loadtest/lib/env-guard.ts`'s
`resolveTarget()` (a helper never actually called by any real script)
defaulted `LOADTEST_MAIN_BASE_URL` to a hardcoded `10.0.1.12:3210`. Fixed
to require it explicitly, matching the file's own stated design
principle. No other reference exists anywhere in `app/`, `lib/`,
`components/`, or `proxy.ts` — every client-facing URL
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `GOTRUE_SITE_URL`,
`GOTRUE_URI_ALLOW_LIST`, `API_EXTERNAL_URL`, `CRON_TARGET_URL`) is read
from environment variables, and every deployment config template
(`deploy/windows/config/*.env.example`) uses a `<SERVER_IP>` placeholder,
never a literal address.

**Conclusion**: once the port is forwarded to a public IP/domain, the
only change needed is updating `.env.local` and `services/*/.env` to the
new address (the same `<SERVER_IP>` fields already documented) followed
by a rebuild + restart — the exact procedure already used today for the
EADDRINUSE fix. No code change required.

---

## 13. What was explicitly *not* done this pass (honest gaps)

- **Soak test** (Part 11) — not run.
- **Full functional UAT** across all 5 roles (Part 13) — not run as a
  dedicated exercise; individual flows were exercised incidentally by the
  automated regression suite (§6) and by today's load-testing (create,
  pickup, start working, comment, waiting-user, resume, resolve), but not
  as a deliberate role-by-role manual/scripted UAT pass.
- **Security UAT** (Part 14) — not run as a dedicated exercise this pass.
  Note: RLS was verified byte-identical to Local (§3), and the
  `org_module_access`/Storage-grant fixes only *enabled* already-coded,
  already-RLS-protected functionality — neither fix touched any
  authorization logic itself.
- **Browser/HTTP UX benchmarking** across the 12 named pages (Part 8) —
  not run this pass.
- **External-machine load test** — considered, then set aside per your
  explicit direction in favor of the same-machine CPU-attribution
  approach (§7), which did answer the capacity root-cause question
  without needing one.

None of these gaps block the verdicts below, but they are real remaining
work if you want the full acceptance checklist closed out.

---

## 14. Final verdicts

### Source / deployment parity
**LOCAL / GIT / MAIN PARITY VERIFIED** — 657/657 application files,
924/924 schema columns, all RLS policies, all triggers/functions
(differences explained and non-functional), and all 9 `org_module_access`
flags confirmed identical after fixing 11 file-level and 1 config-level
discrepancy.

### Performance
**MAIN PERFORMANCE IMPROVED — TARGET CAPACITY NOT YET FORMALLY VERIFIED.**
The capacity *root cause* is conclusively answered (today's earlier
target-load failures were a 4.4:1 load-generator artifact, not a genuine
Main limit — measured, not inferred), and the two real defects found
under load (EADDRINUSE retry gap, error-masking, missing Storage grant)
are fixed and verified. But a full acceptance run (soak test, browser/HTTP
UX, categorized success-rate acceptance criteria at target scale) was not
completed this pass, so "target capacity verified" cannot honestly be
claimed yet.

### Clean slate
**LOCAL & MAIN TRUE CLEAN SLATE VERIFIED** — both environments hold only
the bootstrap organization/admin, genuinely real pre-existing data (Ankur
and Kaushlesh's accounts, Local's real IT department/hr team), and
required system seed. Every DELETE-classified fixture found (regardless
of which earlier session created it) was removed. Both sequences reset to
`CKSD-000001`.
