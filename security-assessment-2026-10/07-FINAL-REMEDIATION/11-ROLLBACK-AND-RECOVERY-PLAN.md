# 11 — Rollback and recovery plan (proposal — tested locally only)

LOCAL ONLY. The rollback scripts below were run on the disposable audit database; nothing was run on production. Evidence: `rehearsal/` (state files after every step, schema and privilege comparison) and the two performance rollbacks on a 100,000-ticket copy (`rehearsal/perf_state_*.txt`).

## What was proved locally

1. Starting from a database rebuilt from migrations 0–163 (= production's schema today), migrations 164 → 171 were applied one by one; after each, the full privilege and policy state was recorded (about 390 lines per snapshot; the script now stops if a snapshot is empty — an earlier version of the harness produced empty snapshots, so its "IDENTICAL" results proved nothing and were redone).
2. The rollbacks 171 → 164 were then applied in reverse; **after each rollback the privilege/policy state equalled the state recorded before that migration** (`rehearsal-latest.log`, `rb_after_*.txt`).
2a. **The same was repeated from the LIVE starting point.** A read-only snapshot of the live database (2026-10-17) showed that live holds broader table and function rights than a database built from the migrations (all policies and objects are identical). The rehearsal database was set to those live rights first (`rehearsal/align-to-live.sql`), then 164 → 171 forward, 171 → 164 back, 164 → 171 again (`rehearsal-live-start.log`, folder `rehearsal/live-start/`): every step matched. This is what caught the need for migration 171 and for exact function-rights records in 169. Before the exact-grant snapshots were added, the rollbacks of 165 and 167 had over-granted rights and lost column rights; that was found by this comparison and fixed (the migrations now record the exact rights they remove, and the rollbacks put exactly those back). The rehearsal is repeatable with `tools/rehearse-migrations.sh`.
3. After the full rollback, a full schema comparison against the baseline showed **no difference other than the intentionally kept `added_by` column**, and the rights of `anon` and `authenticated` were identical (`schema_diff_normalised.txt`, `acl_diff_rollback_vs_baseline.txt`).
4. Re-applying 164 → 171 after the rollback reproduced the first final state exactly — in both rehearsals, and also (164 → 170) on a database holding 100,000 tickets.

## Choosing the right level

| Situation | Action |
|---|---|
| Something is wrong with the **new app** and the migrations are **not yet applied** | Put back the previous app folder (below). Nothing else. |
| Something is wrong **after one migration** | Run that migration's rollback; restart the REST service; run the smoke list. If more than one was applied, roll back in reverse order only as far as needed. |
| Something is wrong **after all migrations** | Stop the app → roll back 170, 169, 168, 167, 166, 165, 164 (in this order) → restart the REST service → put back the previous app folder → start. The **old app does not work on the new schema**, so the database and the app must be rolled back together. |
| Data is damaged or lost | Restore from the pre-migration dump (below). |

## Step-by-step: rollback of the application

1. On 10.0.1.98 stop the Citykart Desk service.
2. Rename the current app folder (keep it); restore the previous folder noted in pre-flight.
3. Start the service; check the health route and one sign-in.
4. Only the folder of Citykart Desk is touched; no other service or shared folder.

## Step-by-step: rollback of the database

For each migration N (from 171 down to 164) run the file `supabase/rollback/<N>_*_rollback.sql` against `ckdesk` on 10.0.0.205 — in a transaction, one at a time — and after each one restart the REST service on 10.0.1.98. The scripts are idempotent for objects that are already gone.

| Rollback | What it does | Data effect |
|---|---|---|
| 171 | puts back the signed-in role's rights on 26 tables and 3 functions exactly as recorded | none |
| 170 | removes the shared limiter/replay tables and functions, the people-visibility rule, restores profile and push rights from the recorded snapshot | the two counter tables hold only short-lived counters; nothing of value is lost |
| 169 | restores the old activity-log rule, the old dashboard function and the old function rights | none |
| 168 | restores the old role helper functions | none (the "must change password" flag stays) |
| 167 | restores the old ownership policies and exact rights | none |
| 166 | restores the old approval-workflow read rules | **keeps** the `added_by` column (harmless) |
| 165 | restores table, sequence and default rights exactly as recorded | none |
| 164 | restores the weaker triggers/rules | none |

Rollback is a *security regression* by design (it puts the weaker rules back). Use it only if the hardening breaks something that cannot wait, and plan to re-apply.

## Restore from backup (last resort)

1. Pre-requisite (pre-flight): a verified dump of `ckdesk` taken immediately before step 5, and a restore test already done on a scratch database.
2. Stop the app; restore into a **new** database, check it, then switch the REST/Auth connection to it (or restore over `ckdesk` only with the owner's explicit approval — this loses everything written since the dump).
3. Files on the NAS are not touched by any migration; they do not need restoring unless NAS data was damaged.
4. Known restore gotchas from the earlier migration are in the project notes (roles and the Supabase extension schema must exist before restoring a pg_dump).

## Recovery contacts and decisions needed in advance

- **Who may order a rollback:** the owner or the IT head (to be named; D-12).
- **Maximum acceptable data loss and recovery time** are not defined by Citykart yet — a backup-restore objective must be agreed (needed for ISO 27001 and SOC 2 as well).
- **Communication:** a one-line notice to users when the system is stopped (template in `07-ISO27001-READINESS.md`, incident template).

## Not tested

- Rollback on the real production server (by design, not allowed here).
- Restore of a real production dump (only a synthetic dump was handled in the earlier migration to the new servers; the restore of the *current* production dump is part of the pre-flight above).
