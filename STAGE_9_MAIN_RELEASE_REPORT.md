# STAGE 9 — FINAL RELEASE AUDIT, MERGE & PUSH TO MAIN

## Overall Status

**RELEASE ALREADY PUSHED TO MAIN — BY AN EXTERNAL ACTOR, NOT THIS SESSION — PLUS ONE FOLLOW-UP FIX COMMIT PREPARED AND AWAITING YOUR GO-AHEAD TO PUSH.**

This stage did not execute in the order its own brief describes, and that needs to be stated plainly up front. While auditing the working tree to scope a WhatsApp-only release commit (per your instruction), a new commit — `9e11b15`, authored `Local Setup <local@citykart.org>`, 318 files, +40,872/-1,655 — appeared on `origin/main` mid-audit. It was not created by this session. It bundles the entire WhatsApp initiative (Stages 1-8.3) together with unrelated work (Store/OEM routing, Notification Rules + Web Push, a broad audit-fix pass, Report Builder fixes, Settings consolidation) in one commit. Per your instruction, this session treated that commit as the release and audited what is actually there, rather than rewriting or reverting it.

During that audit, restoring the local dev database (also authorized by you, after it was found to have lost nearly all seed data) surfaced two **real, pre-existing defects in the already-pushed commit** that block any fresh environment bootstrap — not WhatsApp-specific, but release-blocking for anyone trying to deploy from `main` as it now stands. Both are fixed, tested, and committed locally as `32bd7ee`, on top of `9e11b15`. **That commit has not been pushed** — see "Push/Merge" below for why this needs your confirmation first.

With that fix applied locally: TypeScript, ESLint, and the production build are all clean. The unit suite (423 tests) is 100% green. The integration suite has a real, well-understood gap — 14 tests across 6-8 files fail because they depend on production-like business configuration (real BD/Finance/HR/IT/L&D/Legal/Vendor Creation services, sub-categories, form templates, business rules) that only ever existed as manually-configured runtime data and was lost along with the rest of the local database's seed data. This is a data-state gap, not a code regression — detailed below.

`RELEASE COMPLETE (for what this session pushed and verified)` / `ONE FIX COMMIT PENDING YOUR APPROVAL TO PUSH` — see Final Recommendation.

---

## Current Branch

`main`, tracking `origin/main`. No feature branch was used (matches this repo's existing direct-to-main pattern for the commits already in its history).

## Remote Main Status

- `HEAD` before this session's involvement: `ab36139`
- New commit pushed by an external actor during this session: `9e11b15` (confirmed via `git fetch origin` + `git rev-parse HEAD`/`origin/main` — both resolved to the identical SHA, i.e. it was already on GitHub, not something this session could have prevented or should revert)
- This session's follow-up commit, local only: `32bd7ee` (parent: `9e11b15`) — **not pushed yet**, pending your confirmation

```
git rev-parse HEAD        -> 32bd7ee8e92f130a3ffa2ba599ec0cc2ae951df9 (local)
git rev-parse origin/main -> 9e11b1547deed99b0a88cbd1ed36d5fca800a611 (unchanged since the external push)
```

## Files Included / Excluded

**Already in `9e11b15` (not this session's doing, audited not authored):** all WhatsApp Stages 1-8.3 code, tests, and docs, plus Store/OEM routing, Notification Rules + Web Push, an SLA business-hours fix, and a broad audit-fix pass — see "Security Review" below for the honest assessment that this violates the "no unrelated broad refactor in one commit" bar you'd normally want, after the fact.

**This session's own commit (`32bd7ee`), local, not yet pushed:**
- `supabase/migrations/20240101000132_wire_up_auto_close_days.sql` → renamed to `20240101000138_...sql` (no content change)
- `supabase/migrations/20240101000133_drop_unused_tags_table.sql` → renamed to `20240101000139_...sql` (no content change)
- `supabase/seed.sql` — updated to match the schema `9e11b15`'s own migrations already require (details below)

**Excluded:** nothing else was modified this session. The working tree is fully clean (`git status --short` returns 0 lines) after this commit.

## Migrations Included

All migrations through `20240101000139` are present and apply cleanly from scratch — see "Migration Defects Found and Fixed" below; this was not true before this session's fix.

---

## Migration Defects Found and Fixed (new finding this stage)

Restoring the local dev database (`npx supabase db reset`, authorized by you) failed twice for reasons unrelated to WhatsApp:

**1. Duplicate migration version numbers.** `9e11b15` introduced two pairs of migration files sharing the exact same 14-digit version prefix:
- `20240101000132_oem_notification_rules_select_role_gate.sql` **and** `20240101000132_wire_up_auto_close_days.sql`
- `20240101000133_drop_unused_tags_table.sql` **and** `20240101000133_profile_mobile_identity.sql`

`schema_migrations` uses that version as its primary key, so the second file in each pair always fails with a duplicate-key error on any fresh `db reset` or `db push` — this would have blocked bootstrapping a hosted UAT/production database from this repo, independent of any WhatsApp work. Fixed by renumbering the second file in each pair to the next free version (`138`, `139`); no SQL content changed. Confirmed safe to renumber: `git log` shows all four files were introduced in the same commit (`9e11b15`), and no hosted/shared environment has ever applied any of them (none exists).

**2. `supabase/seed.sql` no longer matched the schema its own migrations require.** After the version-collision fix, seeding still failed three more times in sequence:
- `services.category_id` and `services.sub_category_id` were dropped by migration `109` (category/sub-category tagging moved to the `service_sub_category_tags` many-to-many table) — seed.sql still wrote to the removed columns and to a plain `UPDATE ... SET sub_category_id`.
- `services.sla_config` was also dropped by migration `109` (SLA moved to `service_sub_categories`) — still present in seed.sql's insert list.
- `org_id` was made `NOT NULL` with no default on `departments`, `teams`, `service_categories`, `services`, and `approval_workflows` by migration `121` — seed.sql's old "insert without org_id, backfill in bulk afterward" pattern can't satisfy a `NOT NULL` constraint at insert time.

Fixed by updating `seed.sql` to insert into `service_sub_category_tags` instead of the removed column, dropping the removed `sla_config` values, and setting `org_id` directly on every affected insert. The old bulk-backfill `UPDATE ... WHERE org_id IS NULL` statements were left in place as a harmless no-op safety net rather than removed, to keep the diff minimal.

**Why this matters for the release:** without this fix, `main` as pushed by the external commit cannot bootstrap a fresh database anywhere — local or hosted. This directly blocks Part 1 of `STAGE_8_2_OPERATOR_ACTIONS.md` ("Push migrations and seed reference data") the moment anyone actually attempts the real UAT deployment this project has been waiting on since Stage 8.1. This is not a WhatsApp defect and was not introduced by any of this project's WhatsApp stages — it was introduced by the external commit's other work — but it is squarely a release blocker, so it's fixed here rather than left for someone else to hit blind.

This fix is committed locally as `32bd7ee` and is the one commit awaiting your go-ahead to push (see "Push/Merge").

---

## Secret Scan

```
SECRET SCAN: CLEAN
```
`git diff` of this session's own commit contains no passwords, tokens, API keys, or private keys — it is two file renames (no content change) and a data-only seed script edit (literal UUIDs and business labels, nothing sensitive). No `.env*` files were touched. The already-pushed `9e11b15` was not re-audited byte-for-byte for secrets by this session (see "Security Review" for why that's a real caveat, not an oversight).

## Test Artifact Cleanup

The **git-tracked** side is clean: no `_tmp-cleanup-*.test.ts` scripts, no debug scaffolding, nothing named `Stage1`/`UAT`/`test` was committed.

The **local dev database**, post-reset, currently holds test-run residue from this session's own verification passes (11 test-tagged profiles, 3 `intake_channels` fixture rows, 1 non-seed service) — all created by re-running the regression suite against the freshly-reset database during this stage's own verification, not part of any commit, and not shared with any other environment. This is normal, expected residue of running the suite and does not need cleanup for the release itself (it's local-only, ephemeral, not in git). If you want a clean local DB afterward, another `npx supabase db reset` will clear it.

## Targeted Tests

Re-ran the exact areas Stage 9's own checklist names: mobile identity, `createRequestCore` security, questionnaire engine, semantic-role autofill, conversation state machine, idempotency, concurrency, webhook security, Meta adapter, media handling, tenant isolation, date/checkbox validation, and the `proxy.ts` public-route allowlist. All pass except where noted below under Full Regression — every failure there is one of the same two root causes (missing real business data, or a downstream test-isolation side effect of that), never a code defect in this list.

## Full Regression

**Unit suite:** `423/423 passed`, 0 failures, 37 files.

**Integration suite:** `232/249 passed` (3 skipped), `42/49 files` fully green. The 7-8 failing files (count varies by ±1 run-to-run depending on exactly which downstream tests get hit — see below) are:

| File | Root cause |
|---|---|
| `stage7-1-semantic-role-real-service.test.ts` | Depends on "the REAL, currently-live IT Support Template" (its own docstring) — the exact template this session migrated in Stage 7.1 via a one-time production `UPDATE`, never captured in a migration. Gone with the rest of the lost seed data. |
| `stage7a-canonical-identity-search.test.ts` | Depends on real sub-category → category derivation on production data; the specific rows no longer exist. |
| `stage7a-mandatory-fields-flow.test.ts` | Depends on real IT/Finance/Legal service configurations and their real mandatory-field sets. |
| `stage7a-attachments-fixture.test.ts` | Its own docstring says its fixtures are "DELIBERATELY LEFT IN PLACE... for later review/cleanup" across runs — colliding on channel-name uniqueness the moment it's re-run without that manual cleanup step, which is exactly what a from-scratch DB reset changes underneath it. |
| `stage7b-audit-logging.test.ts` | `testWhatsAppConnection()` against a channel tied to now-missing real service/team configuration. |
| `stage7b-parity-sla-assignment.test.ts` | Hardcodes real production service/sub-category/field UUIDs (`IT_SERVICE_ID`, `HR_SERVICE_ID`, "VPN CREATION", "GRATUITY") by its own docstring's admission — "Service not found" is the direct, honest consequence. |
| `stage2-mobile-identity.test.ts` (intermittent) | **Not an independent failure.** Passes 22/22 in isolation. Fails only when one of the files above fails before its own cleanup runs and leaves a persona profile behind using the same literal mobile number (`9700000001`) under the same seeded default org. A genuine minor test-isolation weakness, but a downstream symptom of the same root cause, not a second defect. |
| `stage6-web-whatsapp-parity.test.ts` (intermittent) | Same downstream-collision pattern as above; passes cleanly in isolation. |

**Root cause, stated once clearly:** this local database's "real" business configuration — the BD/Finance/HR/IT/L&D/Legal/Vendor Creation services, their real sub-categories, form templates (including the Stage 7.1 semantic-role migration), business rules, and team staffing that Stages 1-8.3 were built and verified against — was **manually configured through the app itself over the course of this project**, never captured in any migration or in `seed.sql`. When the local database's data was lost (independently of this session, before this session started — see the prior investigation into the `teams_department_id_fkey` failure), that manually-built configuration was lost permanently with it. `supabase db reset` correctly restores the bare, generic 8-service demo baseline `seed.sql` was always designed to produce — it was never designed to reproduce that real configuration, and this session did not attempt to fabricate it, since inventing production business configuration (services, sub-categories, form layouts, business rules) is explicitly out of scope for this stage.

**This is a data-state gap, not a WhatsApp code regression.** Every test that creates its own fixtures from scratch (the large majority of the suite, including every core WhatsApp mechanism: identity resolution, the state machine, questionnaire engine, idempotency, concurrency, tenant isolation, webhook security, the Meta adapter, media handling, and the Stage 8.1 webhook-routing fix) passes cleanly and reliably. The only tests affected are the small set that were deliberately written to validate against the specific real IT/HR/etc. services as an extra layer of "this also works against production-shaped data" assurance — that assurance is currently unverifiable locally, and would need someone to either recreate that business configuration through the app UI, or for the tests to be rewritten to build their own throwaway services/sub-categories the way the rest of the suite already does.

## TypeScript

```
TYPESCRIPT: 0 ERRORS
```
`npx tsc --noEmit` — clean, no output.

## ESLint

```
ESLINT: 0 ERRORS, 3 PRE-EXISTING WARNINGS
```
All three warnings are in files this project never touched (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx` — projects/tasks module, unrelated to WhatsApp or this session's fix), matching the pre-existing baseline confirmed in earlier stages.

## Production Build

```
BUILD: SUCCESS
```
`npm run build` (Next.js 16.2.9, Turbopack) compiled successfully, generated all 53 static pages, and the route manifest confirms `/api/intake/webhook/whatsapp` is present as a dynamic route alongside every other admin/intake/request route.

## Security Review

- No secrets, debug endpoints, or disabled security checks in this session's own commit (`32bd7ee`) — confirmed above.
- The `proxy.ts` webhook-exemption fix from Stage 8.1 is confirmed still present and correct in the current `main`.
- **Honest caveat, not fixed by this session:** the already-pushed `9e11b15` does **not** meet the "no unrelated broad refactor in one commit" bar this stage's own brief asks for — it bundles WhatsApp with Store/OEM routing, Notification Rules, Web Push, and a broad unrelated audit-fix pass in a single 318-file commit. This session did not author it and, per your explicit instruction, did not rewrite or revert it. A full line-by-line secret/security audit of all 318 files in that commit was **not** performed by this session (that would have meant re-reviewing unrelated modules this project never worked on) — this session's review was scoped to the WhatsApp-relevant paths already audited across Stages 1-8.3, plus the migration/seed defects found while restoring the database. If a full audit of the non-WhatsApp portions of `9e11b15` is wanted, that's a separate task for whoever owns that other work.
- The many `STAGE_*.md`/`*_HANDOFF.md`/`*_RUNBOOK.md` documents this project produced are already committed inside `9e11b15`. Whether they belong in the repository long-term per this team's documentation conventions is a call for you, not something to unilaterally delete now that they're already pushed and part of the release history.

## Current Hosted Environment Check

```
PUBLIC HTTPS DEPLOYMENT VERIFIED: NO (unchanged since Stage 8.3 — no deployment exists)
```
`NEXT_PUBLIC_APP_URL` is still `http://localhost:3210`. No Railway CLI or credentials are present in this sandbox. This is unchanged from every prior stage and is not something this stage could close.

## Real WhatsApp Smoke Check

```
REAL WHATSAPP SMOKE VERIFIED: NO
```
No outbound internet access exists in this sandbox (`curl` to `graph.facebook.com` fails at the network level — `HTTP_STATUS:000`), and no Meta credentials exist anywhere in `.env.local`. Unchanged and honestly reported as such since Stage 8. Nothing about the loss and restoration of local seed data changes this — it was never verifiable from this environment.

## Git Commit

```
32bd7ee8e92f130a3ffa2ba599ec0cc2ae951df9
Fix duplicate migration version numbers and stale seed.sql schema drift
```
Local only — parent is `9e11b15` (the current tip of `origin/main`). Not yet pushed.

## Push/Merge

```
PUSHED TO MAIN (9e11b15): YES — already done, by an external actor, before this session could gate it.
PUSHED TO MAIN (32bd7ee, this session's fix): NO — awaiting your explicit go-ahead.
```

**Why the fix commit is not pushed automatically:** everything in Stage 9's own checklist for the fix commit passes — targeted tests, full regression (with the data-gap fully explained above), TypeScript, ESLint, build, and secret scan are all clean. Nothing is technically blocking it. The reason to pause here instead of pushing outright is that this session already discovered, mid-audit, that `main` changed underneath it once without warning — the responsible thing is to hand you a clean, tested, reviewed commit and let you make the call to push it, rather than making a second unannounced change to a branch that already surprised us once this session. If you'd like it pushed, say so and it'll be a plain fast-forward push (no force, no rebase needed — `origin/main` hasn't moved since the fetch above).

## Post-Push Deployment

Not applicable yet for `32bd7ee` (not pushed). For `9e11b15` (already on `origin/main`): no auto-deploy target exists to check — this sandbox has no Railway project/credentials, so there is nothing to poll for a post-push build or deploy status. This is a "not verifiable from here," not a "deployment failed."

## Post-Deploy Health/Webhook/WhatsApp

Not applicable — no hosted deployment exists to check `/api/health` or the WhatsApp webhook against. Unchanged from every prior stage's honest `NO`.

## Rollback Readiness

Unchanged from `WHATSAPP_PILOT_RUNBOOK.md`'s existing pause-and-preserve plan (Admin → Intake → Channels → Pause; never delete `request_conversations`/`intake_audit_log`/created tickets). For this session's own fix commit specifically: if `32bd7ee` is pushed and something about the migration renumbering turns out to be wrong, the safe rollback is a new commit reverting it — the two renamed files have no content change, and the seed.sql edit only affects local/UAT database bootstrapping, never a running production database (seed.sql is never re-run against a live environment).

## Known Business Configuration Items (carried forward unchanged)

Per this stage's own instruction, none of the following were touched:
- Dead Business Rules referencing deleted categories (Stage 6 Findings 3/4) — still present, unchanged.
- `assignment_rules` — still empty, unchanged.
- Team staffing — IT Support and HR Support were the only 2 of 7 real services with a staffed default team as of Stage 6/7; that real staffing data no longer exists locally after the database reset (see Full Regression above) and was not recreated by this session.
- BD naming, WiFi catalogue, and every other manually-configured business setting referenced across Stages 1-8.3 — not modified, and (per the above) currently absent from the local dev database pending someone recreating it through the app.

## Final Recommendation

**RELEASE COMPLETE for what has actually shipped** (`9e11b15` is live on `origin/main`, and this session's independent audit found it functionally sound for the WhatsApp flow specifically, modulo the two release-blocking migration/seed defects now fixed).

**RELEASE BLOCKED for anyone trying to deploy fresh from `main` right now**, until `32bd7ee` is pushed — without it, `supabase db push`/`db reset` cannot succeed against any new database, local or hosted, which is the very first step of the still-outstanding UAT deployment (`STAGE_8_2_OPERATOR_ACTIONS.md`, Part 1).

**Recommended next action:** confirm you'd like `32bd7ee` pushed (a plain fast-forward, nothing destructive), and separately, decide who should recreate the real BD/Finance/HR/IT/L&D/Legal/Vendor Creation business configuration in whichever database the actual UAT/production deployment will use — that configuration needs to exist there regardless of what happens to this local sandbox's database, since it was never migration-scripted anywhere.

Per this stage's own stop condition: once `main` is confirmed in the state you want and this report is delivered, this session stops here — no Phase 2 feature work (My Tickets, status lookup, agent replies, approvals, reopen, CSAT, proactive notifications) has been started.
