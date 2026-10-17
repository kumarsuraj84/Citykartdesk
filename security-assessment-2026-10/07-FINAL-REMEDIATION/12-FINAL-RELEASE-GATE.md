# 12 — Final release gate

LOCAL ONLY. This gate decides whether the work is ready to be **reviewed for a controlled release**. It does not release anything. Nothing was pushed, merged or deployed, and no test or dummy data was added to live.

## FINAL STATUS: **CONDITIONAL**

Ready for controlled release review **provided the conditions in section 3 are met on the live servers and the owner gives explicit written approval for each step.** Not "ready": HTTPS is open as a decision (High), and several preconditions exist only on the live servers.

## 1. Gate criteria

| # | Criterion | Evidence | Result |
|---|---|---|---|
| G1 | All 70 findings carry a final status with code reference, test reference, evidence and residual risk | `02-…` (70 rows + 10 new items) | **Pass** |
| G2 | No finding marked Fixed without a reproducible verification | tests named per row; exploit tests written to fail on the old behaviour; items needing production or a decision are *not* marked Fixed | **Pass** |
| G3 | No Critical finding open | VAPT-DEP-01 fixed on `release/p0-framework-next-16.3.8` (production audit 0); needs its own release | **Pass (needs release R-A)** |
| G4 | No High finding open | VAPT-002 (HTTPS, High) is **Requires Decision** (parked by the owner); the other two Highs are Fixed | **Open by decision** |
| G5 | Default, remediation and VAPT suites green on the final code | 1,820 / 184 / 130 passed, 0 failed; also green on the release-path database | **Pass** |
| G6 | Type check and lint | `tsc` 0 errors; lint 0 errors, 5 pre-existing warnings | **Pass** |
| G7 | Migrations rehearsed forward, back and forward, with exact rollbacks | normal start and live starting rights; every step identical; snapshot harness fixed after a flaw was found | **Pass** |
| G8 | Release order proven (app first, database second) | new app on today's layout: 1,820 / 1,820 | **Pass** |
| G9 | Live starting point compared | read-only snapshot: all policies identical; rights broader on 26 tables / 3 functions → migration 171 | **Pass (re-check before applying)** |
| G10 | Browser UAT, desktop and mobile | final build: phone layout, three roles, 21 checks; desktop layout and some journeys by automated tests only (`05-…`) | **Partial** |
| G11 | Performance at 3,000 / 100,000 / 500,000 tickets | 3k and 100k with before/after; 500k skipped by the owner | **Partial (by decision)** |
| G12 | Scanners | Semgrep, Gitleaks, OSV, Nuclei ran; ZAP not run | **Partial** |
| G13 | Git hygiene: no credentials, env files, personal settings, production-derived data, raw logs, unrelated mock-ups | see section 4 | **Pass** (checked at commit) |
| G14 | Backup exists and has been restored at least once | nightly dump OK through 2026-10-17; **no restore test seen** | **Open (pre-flight)** |
| G15 | No test or dummy data on live | by rule; live only read | **Pass** |
| G16 | ISO 27001 / SOC 2 | readiness drafts only; **no certification claimed**; organisation evidence missing | **Not ready (informational)** |

## 2. Residual risk accepted for the release, if the owner approves

- Public HTTP until HTTPS (D-1).
- No malware scanning of uploads (D-10).
- Six policy switches at today's defaults (D-2 … D-8).
- Development-only tool advisories (NEW-006).
- Production performance unknown beyond local tests; production is small (314 tickets, 554 users).

## 3. Conditions that must be met before the first live step

1. **Backup you have restored.** Run `CK_Backup_CKDESK` by hand, check `backup.log`, restore the dump into a scratch database (never `ckdesk`), compare row counts.
2. **Re-run the read-only rights check on 205** immediately before the database step and compare it with the rehearsed baseline (`tools/compare-live-state.cjs`); any new difference is explained first. Provide the schema-only dump (`live-schema.sql`) to close the column/sequence-rights gap.
3. **Count the accounts still on the old shared import password** (corrected command given) and decide: reset them or accept.
4. **463 accounts with a pending first-password change**: tell the store teams, or reset on the owner's terms, before migration 168.
5. **First release carries `ALLOW_SHARED_SECRET_FALLBACK=1`** in the app's `.env.local` (live has only `CRON_SECRET`); per-purpose secrets are a later, planned step; `TRUSTED_PROXY_HOPS` stays unset until a reverse proxy exists.
6. **Release R-A (framework) and R-B (application) are approved separately from R-C (database).** The owner's explicit written OK is required for each push and each deployment (standing project rule).
7. **A named person who may order a rollback** and the one-line user notice (templates in `07-…`).
8. **No test or dummy data on live**: only read-only checks (`10-…`).

## 4. Git hygiene (Phase 11)

- Work is committed on a **new local branch** (`release/security-remediation-final`, created from `security/remediation-phase2-local`); no existing branch was rewritten; `release/p0-framework-next-16.3.8` stays independent.
- **Not committed:** `.claude/settings.local.json` (personal), `perf-run.json`, `uat-users.json`, environment files, raw test/scan/rehearsal logs (they hold synthetic tokens and a real e-mail address; now ignored), the live read-only output (`live-readonly/live-state.txt`, production-derived), unrelated mock-ups, spreadsheets, screenshots and earlier audit documents that were already untracked.
- History already contains older raw logs from earlier commits (synthetic data; Gitleaks matches are the word REDACTED only). History was not rewritten.
- `.gitleaks.toml` allow-lists only the redaction marker.

## 5. What happens next (only on the owner's instruction)

1. Owner reviews `01-…` and `09-…` and answers the open decisions (or leaves the defaults).
2. Owner runs the pre-flight items on the servers.
3. Owner says: "commit and push to git and main" — then: commit, push `origin main`, build, deploy to 10.0.1.98 as in `10-…` (app first, one step at a time), each step confirmed.
4. After the database step: read-only verification, 30 minutes of watching real work, then the next step.
