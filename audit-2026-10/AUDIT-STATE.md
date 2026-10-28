# CKDesk audit — resume file (update after every stage)

Folder: `audit-2026-10/` (untracked; never commit). Reports in `reports/`, raw evidence in `evidence/`, guard + runner in `guard/`, disposable stack config in `env/`.
Run anything dynamic ONLY through:  `powershell -NoProfile -ExecutionPolicy Bypass -File audit-2026-10\guard\run.ps1 <command…>`  (isolation gate first, egress guard preloaded, audit env loaded).
Start/stop audit stack:  `npx supabase start --workdir audit-2026-10/env -x studio,imgproxy,edge-runtime,logflare,vector,postgres-meta`  /  `npx supabase stop --workdir audit-2026-10/env`
Audit app port 3310, audit API 55421, audit DB 55422 (container supabase_db_ckdesk_audit, user postgres). NEVER use the dev stack (citykart_desk, 543xx), the user's Chrome, or any 10.0.1.98 / 10.0.0.205 / 10.0.0.25 address.

## Stage log
| Stage | Status | Output |
|---|---|---|
| Phase 0 architecture | DONE 2026-10-13 | reports/01-CURRENT-ARCHITECTURE.md |
| Phase 1 isolation gate | DONE (21/21) | reports/02-LOCAL-ISOLATION-CERTIFICATION.md |

## Remediation (2026-10-13) — DONE, awaiting user review
Branch `remediation/post-audit-2026-10` (27 commits, local only, not pushed). Reports: `audit-2026-10/remediation/` (01–11 + EXECUTIVE-REMEDIATION-SUMMARY.md). Verdict: LOCAL REMEDIATION VERIFIED WITH CONDITIONS — USER REVIEW REQUIRED.
Final: tsc 0 errors · lint 6 (baseline) · unit 1090/1090 · integration 401 pass/0 fail/18 skipped (blocked) · remediation 83/83 · build OK · gate 21/21.
Audit app (3310) is STOPPED; audit DB restored to 3,000 synthetic tickets (counter 3222, authenticated statement_timeout 8s). Start app with NEXT_DIST_DIR=.next-audit (the user's own dev server on 3210 uses .next — never touch it); revert tsconfig.json afterwards (`git checkout tsconfig.json`).
Open/decisions: D-005, D-011, D-018, D-040/041, 20 Medium, REL-1; audit-trail/error-capture build still queued.
