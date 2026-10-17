# 04 — VAPT retest results (final)

LOCAL ONLY. Everything ran on the disposable audit stack (own Docker containers, synthetic data, loopback only, a 21-point isolation gate before every run). Nothing on production was tested; production was only **read** (see "Read-only checks of the live system"). No tool below is claimed to have run unless its output is in `scans/` or `rehearsal/`.

## 1. Suite results on the final code

| Suite | Command config | Result | Notes |
|---|---|---|---|
| Default (unit + integration) | `vitest.config.ts` | **1,820 passed, 18 skipped, 0 failed** (241 files passed, 4 skipped) | skipped = tests that need a real mail/WhatsApp account or a scanner; they are skipped by design and listed in the log |
| Remediation | `vitest.remediation.config.ts` | **184 passed, 0 failed** (33 files) | database-level checks of the earlier remediation |
| VAPT | `vitest.vapt.config.ts` | **130 passed, 0 failed** (16 files) | exploit tests (before/after), concurrency, multi-organisation isolation, performance |
| Type check | `tsc --noEmit` | 0 errors | |
| Lint | `npm run lint` | 0 errors, 5 warnings | 5 pre-existing warnings in files this work did not touch; 10 warnings that this work had introduced (unused imports) were removed |
| Production dependency audit | `npm audit --omit=dev` | 0 vulnerabilities (release branch `release/p0-framework-next-16.3.8`) | production today (16.2.9) has 9 |

**Same suites on the database laid out like production's real starting point** (migrations 0–163 + live's table and function rights, then 164 → 171 applied): see section 4.

## 2. VAPT test files (16)

| File | Tests | What it proves |
|---|---|---|
| 10 confidentiality exploits | 5 | internal notes/files, phone numbers, reports hidden from requesters (before/after) |
| 11 integrity exploits | 6 | direct ticket create/update blocked, priority/SLA locked |
| 12 e-mail reply participant | 4 | only ticket participants can reply by e-mail |
| 20 ticket actions authorization | 5 | status, assignment, reclassification rules in the server |
| 21 approval separation | 6 | requester/sender can never approve (5 of 6 failed before the fix) |
| 22 projects, tasks, files privacy | 8 | project visibility, task files (7 of 8 failed before) |
| 23 permission matrix and rules | 13 | six owner switches, settings allow-list, rule limits, audit |
| 24 ticket low findings | 15 | duplicate through normal path, error text, activity, dashboards, grants |
| 25 auth and integrations | 23 | password reset, display names, webhooks (replay/spoof/challenge), approval-code lock-out, shared limits, push |
| 26 admin, exports, files | 12 | organisation checks, export audit and limit, health cache, uploads incl. scanner fail-closed, Store Master limits |
| 27 partial findings 019/021/056 | 15 | people-list privacy, storage read rule (forged reference fails on the old rule), reclassification reason |
| 28 concurrency and idempotency | 4 | 8 identical submissions → one ticket; retry; conflicting updates; 20 simultaneous comments |
| 29 multi-organisation isolation | 7 | a second organisation sees/changes/creates nothing of the first in **any** table that has an organisation id (read, write, create, storage, functions; with positive controls) |
| 30 onboarding and password enforcement | 5 | forced change enforced at the database level |
| 90 / 91 performance | 2 | see `06-…` |

## 3. Independent verification of the earlier "Fixed" findings

The 46 findings reported Fixed on 2026-10-16 were not taken on trust. For each, the check was repeated against the **final** code and database by the exploit tests above (written to fail on the old behaviour), by the remediation suite, and by the migration rehearsal. The closure matrix (`02-…`) names the test per finding. Result: **none reopened.** Two things were found and corrected along the way (they are recorded as NEW-004 and NEW-005 in `02-…`): rollbacks that did not restore rights exactly, and live rights that were broader than a database built from the migrations.

## 4. Migration and release-order proof

1. **Normal start** (database built from migrations 0–163): 164 → 171 forward, 171 → 164 back, 164 → 171 again. After every rollback the full table/function/policy rights snapshot equals the one before that migration (about 390 lines each); the re-applied state equals the first. A full structure comparison shows only the deliberately kept `added_by` column (`rehearsal/rehearsal-latest.log`).
2. **Live start**: the rehearsal database was first set to the rights read from the live system (`rehearsal/align-to-live.sql`) and the same forward/back/forward run repeated (`rehearsal/rehearsal-live-start.log`): every step identical, rights of `anon` and `authenticated` identical after full rollback.
3. **New application on today's database layout** (migrations 0–163, live rights): default suite **1,820 passed, 0 failed** (`rehearsal/compat-newapp-oldschema-default.log`). So the application can be deployed **before** the database changes.
4. **Old application after the migrations**: does not work after migration 165 (it writes tables directly); hence the order app first, database second, and the rollback needs app and database together (`11-…`).
5. **Release path end state** (3 → live rights → 164…171): identical to the rehearsed end state (0 differing lines); the three suites were then run on it (see the table in section 1 and the file `rehearsal/livepath-*.log`).

A flaw in the first version of the rehearsal script (empty snapshots, so "IDENTICAL" proved nothing) was found during this work, fixed (the script now aborts on an empty snapshot) and the whole proof redone. Earlier committed state files with that flaw were replaced.

## 5. Scanners — exact scope and gaps

| Tool | What ran | Result | Gap |
|---|---|---|---|
| **Semgrep** | 111 community rules over 996 tracked files (`scans/semgrep.json`) | 2 warnings: plain `http://` link in a draft launch e-mailer (not application code); `bypass-tls-verification` on `api/src/intake/smtp.ts` — a **false positive** (the key `rejectUnauthorized` is now `true`; the real finding NEW-001 is fixed) | rule pack is the free community set, not a tuned security pack |
| **Gitleaks** | full git history, 15 commits (`scans/gitleaks-git-history.json`) | 8 matches, all the literal word REDACTED (a redaction marker), no secret; allow-listed in `.gitleaks.toml` | working tree secrets are covered by `scripts/check-secrets.mjs` (names/length only) |
| **OSV-Scanner** | `package-lock.json`, 1,001 packages | 5 advisories, all development-only (vitest, @vitest/mocker, tinypool ×2, braces) — NEW-006; production `npm audit` = 0 | OSV database state at run time |
| **Nuclei** | 6,296 templates, 15,522 requests against the **local audit application** only | 0 matches, 41 request errors (timeouts) | not run against production; many templates target technologies this app does not use |
| **OWASP ZAP** | **not run** | — | **Gap.** No ZAP run exists; the HTTP probe set `02-VAPT/HTTP-PROBE-CAPTURES.md` (7 manual probes) is a partial substitute |
| Manual penetration testing | `02-VAPT/03-…` | 70 findings (the register) | — |

## 6. Read-only checks of the live system (2026-10-17; nothing written, no test data)

| Check | Result |
|---|---|
| App server 10.0.1.98 | build `20261015-145217`; five `CkDesk*` services running; seven scheduled tasks Ready, last result 0; disk space ample |
| Login service settings | `disable_signup = true` (VAPT-023 now verified); anonymous (public) key sees no tables in the data API |
| App configuration (names only, no values shown) | only `CRON_SECRET` is set among the secrets → release uses `ALLOW_SHARED_SECRET_FALLBACK=1` first; no reverse proxy, so `TRUSTED_PROXY_HOPS` stays unset |
| Database 10.0.0.205 (owner ran a read-only script) | PostgreSQL 18.6; 314 tickets; 554 profiles (553 active); 1 organisation; migrations stop at 163; **463 accounts with a forced password change pending**; 106 functions executable by anon, 91 tables readable by anon (all behind row security) — fixed by 165/169/171 |
| Live rights vs rehearsal baseline | all 229 policies and all tables/functions identical; **rights on 26 tables and 3 functions broader on live** → migration 171 (NEW-005) |
| Backups | nightly task OK every day through 2026-10-17 02:30 (dump ≈ 3.5 MB); no restore test seen |
| Not obtained | count of accounts on the old shared import password (query failed on the first run; corrected command given); column-level and sequence rights (schema-only dump requested); SSH to 10.0.0.205 is refused for the available key |

## 7. What was not tested

HTTPS (parked by the owner); a real malware scanner; real Gmail/Outlook/WhatsApp accounts (logic and protocol level only); production performance; the 500,000-ticket size (owner decision); ZAP; the rendering of hostile e-mail in a real mail client; restore of a production dump.
