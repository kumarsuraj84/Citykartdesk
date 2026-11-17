# 02 — Repository and Environment Baseline

## Plain summary
The audit started from a clean copy of `main` and ran only on this PC, against a throw-away copy of the system (its own database, its own mail-catcher, its own storage). A guard script checks 21 safety rules before the app is allowed to start, and a second guard refuses every connection that leaves this PC. Nothing was sent to the live servers, no mail or WhatsApp message was sent, nothing was committed, pushed, merged or deployed.

## Repository at the start
| Item | Value |
|---|---|
| Branch / commit | `main` = `origin/main` = `6a160dd` ("Guides: rebuild all three with real screenshots") |
| Working tree at start | clean except 6 modified test/demo files and an untracked audit folder (see report 18) |
| Live build at the time | `70906f4` (read-only health check) |
| Commits in history | 399 |
| Database migrations in repo | 195 (`supabase/migrations`, numbers 1–195; no 176) |
| Source files / test files | 1,031 source files, 431 test files (matrix in 03/04) |
| Pages / API routes | 75 pages, 40 API routes (37 under `app/api`) |

## Toolchain
Node 24.14.0, npm 11.9.0, Next.js 16.3.8, React 19.2.4, TypeScript 5.9.3, Vitest 3.2.7, Tailwind 4.3.3, Supabase JS 2.108.1, Zod 4.4.3, Docker 29.8.0, Chrome 157.0.8103, Edge 157.0.4341. axe-core 4.12.1 for accessibility.
Test machine: Windows 11, Intel Core i9-14900KS (32 threads), 128 GB RAM, local SSD. **This is far stronger than the live app server, so speed numbers in report 09 are best-case.**

## The isolated audit stack
| Part | Where | Notes |
|---|---|---|
| App (development mode) | `http://localhost:3310` | `node audit-2026-10/demo/start-demo.cjs` |
| App (production build) | `http://localhost:3311` | built into `.next-audit-prod` for load tests |
| Database + API + storage | Docker project `ckdesk_audit`: API 127.0.0.1:55421, DB 55422 | Disposable. A snapshot of the starting state is in `evidence/db/` (76 MB) |
| Zoho history database | DB `zohoaudit` in the same container | 61 made-up "PRACTICE TICKET" rows, read-only login |
| Mail | files in `evidence/mail-sink/` | no SMTP/Resend/WhatsApp setting exists in the audit environment |
| People | 12 made-up persons `qa11.*@audit.test` + demo persons | the development database with ~570 real staff names was **never** used |

Setting-up steps that changed the audit database (all local):
1. The audit database was at migration 163 while `main` is at 195: a snapshot was taken, migrations 164–195 were applied (176 does not exist), PostgREST restarted.
2. Gap found by the isolation gate and closed: the Zoho settings of the developer's `.env.local` leaked into audit runs (check **C6**). The audit environment now overrides them with the disposable `zohoaudit` database.

## Isolation guards (Section 1 of the directive)
- **Isolation gate** `audit-2026-10/guard/isolation-check.mjs`: 21 checks, **21/21 PASS** at the start and before every app start (loopback-only URLs, no production/retired addresses, outbound settings blank, audit Supabase port, `.env.local` fully overridden, egress guard loaded…). Evidence: `evidence/egress/isolation-check-latest-2026-11-16.json`.
- **Egress guard** `audit-2026-10/guard/egress-guard.cjs` is preloaded into every Node process: it refuses any connection to anything except this PC. **31+ attempts were refused and logged** (14 distinct targets, among them graph.facebook.com, smtp.gmail.com, api.resend.com, 10.0.0.205:5432, 10.0.1.98/10.0.1.12:3210) — proof that the app *tries* to reach the outside world in places and that the guard stopped it. Evidence: `evidence/egress/`.
- Production inspection: only one read-only health check of the live app version before starting. **No production data was read, no production setting was changed.**
- One outbound call was deliberately made outside the guard: `npm audit` (list of public package names and versions to registry.npmjs.org, to find known vulnerabilities). Recorded in 10.

## Baseline results (before any fix)
| Layer | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Type check (`tsc`) | — | exit 0 | — | — |
| Lint (`eslint`) | — | exit 0 | — | — |
| Unit (830 files) | 2,400 | 2,398 | 0 | 2 (opt-in CKOneAI speed tests) |
| Integration (187 files) | 420 | 402 | 0 | 18 (WhatsApp "production catalogue" tests need the real catalogue) |
| Remediation (95 files) | 181 | 181 | 0 | 0 |
| VAPT (222 files) | 410 | 405 | **5** | 0 |

The 5 failures were tests that no longer matched deliberate behaviour changes (F-001…F-005 in report 15). After correcting 4 test files the VAPT layer was re-run: 57 + 6 tests in the corrected files pass.

## Hygiene findings
- **H-1**: running the suites and the development server rewrites tracked files (`AGENTS.md`, `audit-2026-10/evidence/*`, and a production build adds lines to `tsconfig.json`). Each of these was restored with `git checkout` after use. Suggest: add them to `.gitignore` or make the tools write elsewhere (owner decision).
- **H-2**: the stray folder `D:\ANKUR%20AI PROJECTS` (only my early smoke screenshots) could not be deleted because the safety check refused `rm -rf`; the owner may delete it.
- **H-3**: `npm run verify` runs only the unit tests (not integration/remediation/vapt). Process recommendation: run all four layers before release.
