# STAGE 3.2 REPORT — Test Infrastructure & Tenant-Fixture Hardening

## Status

**Complete.** Root cause confirmed from live DB/code (not assumed), fixed with the smallest safe change at each layer, and proven via 4 consecutive clean full-suite runs (0 manual intervention between them) plus dedicated repeatability tests. **READY FOR STAGE 4: YES** for infrastructure determinism — see "Stage 4 Readiness" for the one unrelated caveat.

---

## Root Cause Confirmed

Everything below was confirmed against the **live local Postgres instance** (`docker exec supabase_db_citykart_desk psql`), not inferred from migration filenames.

**1. `handle_new_user()`'s actual current behavior** (confirmed via `pg_get_functiondef`):
```sql
INSERT INTO public.profiles (id, full_name, avatar_url, org_id)
VALUES (NEW.id, ..., ..., (SELECT id FROM organizations LIMIT 1));
```
Exactly matches migration `20240101000088_fix_handle_new_user_org_id.sql` — no later migration touches it. Fires `AFTER INSERT ON auth.users` (trigger `on_auth_user_created`, from the initial schema).

**2. `global_sla_config`'s actual current FK behavior** (confirmed via `pg_constraint`):
```
global_sla_config_org_id_fkey | confdeltype = 'a' (NO ACTION) | FOREIGN KEY (org_id) REFERENCES organizations(id)
```
This FK was added in migration `20240101000033_org_isolation.sql` (`ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id)` — no `ON DELETE` clause specified, defaults to `NO ACTION`) and never changed since. A trigger added later — `seed_org_sla_config` (migration `20240101000048_per_org_sla_config.sql`, confirmed live via `pg_trigger`, the **only** `AFTER INSERT ON organizations` trigger that exists) — auto-inserts one `global_sla_config` row per SLA priority tier for every new org. Combined, this means: **any test that creates a second org and doesn't explicitly delete its `global_sla_config` rows first can never delete that org afterward** — the delete silently fails (every affected fixture checked the delete's error and either ignored it or had nothing checking it at all).

**3. Why orgs leaked:** every fixture that creates a secondary "Org B" deletes its own org-scoped entities (teams, services, categories, sub-categories, departments, locations, profiles/auth users) correctly, then calls `.from('organizations').delete()` — but never deletes `global_sla_config` first, so that final delete is a silent no-op. Confirmed directly: querying `organizations` after running the affected fixtures (before this stage's fix) showed dozens of accumulated stray rows going back to whenever each fixture was first written.

**4. Why leaked orgs affected later, unrelated user creation:** `(SELECT id FROM organizations LIMIT 1)` with no `ORDER BY` has **no guaranteed row** once more than one row exists — Postgres is free to return any of them, and in practice the choice can shift as the table's physical storage/bloat changes (rows inserted and deleted repeatedly). Once a stray org happened to be returned instead of the real seed org, every `createTestUser()` call from that point in a run landed in the wrong org, and `createRequestCore()`'s own (correct, intentional) `requesterId`/`org_id` cross-check then legitimately rejected the mismatch as `"Requester not found."` — a real, working security check reacting to corrupted test setup, not a bug in `createRequestCore()` itself. This was reproduced directly during Stage 3.1: a full-suite run went from 0 to 55 failures purely from accumulated stray orgs, then back to 0 after a manual purge — the same failure mode this stage eliminates at the source.

---

## Affected Test Fixtures

Every file in the repository that creates an `organizations` row (confirmed via `grep -rl "from('organizations')" tests/` — exactly 5 matches, no others exist):

| File | Pattern | `global_sla_config` cleanup before this stage |
|---|---|---|
| `tests/integration/stage1-1-create-request-core-security.test.ts` | shared fixture, `cleanup()` in `afterAll` | ❌ missing |
| `tests/integration/stage1-1-intake-review-fixes.test.ts` | inline per-`it()` (not a shared fixture) | ❌ missing |
| `tests/integration/stage2-mobile-identity.test.ts` | shared fixture, `cleanup()` in `afterAll` | ❌ missing |
| `tests/integration/stage3-questionnaire-catalog-security.test.ts` | shared fixture, `cleanup()` in `afterAll` | ✅ already fixed in Stage 3.1 (now refactored onto the new shared helper, see below) |
| `tests/integration/stage3-1-title-contract.test.ts` | shared fixture, `cleanup()` in `afterAll` | ✅ already fixed in Stage 3.1 (now refactored onto the new shared helper) |

---

## Test Cleanup Fix

**Helper created:** `tests/setup/cleanup-org.ts`, three functions:
- `deleteTestOrg(admin, orgId)` — deletes `global_sla_config` for the org, then the org itself. **Throws** (does not swallow the error) if the org still can't be deleted — a deliberate change from every existing fixture's previous silent-failure behavior, so a fixture that hasn't finished clearing its own org-scoped rows fails loudly in `afterAll` instead of leaking quietly.
- `orgExists(admin, orgId)` / `globalSlaConfigExists(admin, orgId)` — query-based existence checks, for tests that need to *prove* a delete worked rather than trust that the delete call returned no error (Step 6's explicit requirement).

**What changed in each fixture:** all 5 files' final `.from('organizations').delete()...` call was replaced with `await deleteTestOrg(admin, orgId)` (or `admin2` for the inline-pattern file). No other cleanup step, no other entity, and no test assertion was touched in any of these files — this is purely the missing step being added, using the shared helper rather than five separate copies of the same two-line SQL sequence (per the brief's explicit preference for a shared utility over copy-paste).

**How deletion is verified:** the new `stage3-2-org-assignment.test.ts` (see "Leak-Prevention Tests" below) queries `organizations` and `global_sla_config` directly after calling `deleteTestOrg()`, rather than only checking that the delete call didn't return an error.

---

## handle_new_user Fix

**Old behavior:** `(SELECT id FROM organizations LIMIT 1)` — unordered, nondeterministic once more than one org exists.

**New behavior:** `(SELECT id FROM organizations ORDER BY created_at ASC, id ASC LIMIT 1)` — deterministically the oldest organization, with a stable tie-breaker.

**Source of intended org_id investigated first, per the brief's explicit instruction not to just add `ORDER BY` if a better source exists:**
1. **Does auth user metadata already contain an intended `org_id`?** No — inspected every call site that creates a user (`inviteUser()` and `bulkCreateUsers()` in `lib/actions/admin/users.ts`, and `tests/setup/fixtures*.ts`'s `createTestUser()`). None pass `org_id` in `data:`/`user_metadata:`.
2. **Is there an invitation row or organization identifier available?** No dedicated invitation-row mechanism is wired up. `org_signup_requests` exists as a table (from an earlier migration) but has **zero application code referencing it** anywhere in `app/` or `lib/` — confirmed via grep. Unused/aspirational, not a real current org-resolution path.
3. **Is `LIMIT 1` only a test/dev fallback?** Effectively yes, in practice. Reading `inviteUser()` and `bulkCreateUsers()` in full: both call the Supabase Auth admin API to create the user (firing this trigger, which inserts a profile with *some* org_id), then **immediately** run a follow-up `UPDATE profiles SET org_id = <the inviting admin's own org_id> WHERE id = <new user>`. `handle_new_user()`'s own pick is a transient placeholder in every real production flow — it is never the value that ends up persisted.
4. **Is there another canonical org-resolution path already present?** Yes — the acting admin's own `profile.org_id`, read from their authenticated session and applied via that explicit follow-up `UPDATE`. This is the real, product-intended mechanism; it lives in application code, not the trigger, because only the application layer knows who is inviting whom.

**Conclusion:** no better source exists for the trigger itself to read — the real org-resolution logic already lives one layer up and always overwrites whatever the trigger picks. Per the brief's own permitted fallback ("only use a deterministic fallback... if the existing product genuinely depends on 'pick one default org' and no explicit org context exists"), a deterministic `ORDER BY` is the correct fix here, not a workaround. The only callers that ever depend on the trigger's own placeholder value being "correct" are test fixtures that create a user via the raw admin API and never issue a follow-up correction — exactly the class of flakiness this stage targets.

**Fallback behavior when zero organizations exist:** unchanged from before (this migration doesn't touch it) — the subquery returns `NULL`, and since `profiles.org_id` is `NOT NULL`, the insert (and therefore the whole `auth.users` insert, same transaction) fails. This can only happen if the `organizations` table is genuinely empty, which never occurs in any real deployment (a seed org always exists) — not a new risk introduced by this change.

---

## Migration Added

**`supabase/migrations/20240101000134_deterministic_handle_new_user_org.sql`** — exactly one migration, as expected. Replaces `handle_new_user()`'s body with the `ORDER BY`-qualified subquery described above; no schema/table/constraint change. Applied directly to the local DB (`docker exec -i supabase_db_citykart_desk psql -U postgres -d postgres < <file>`) and confirmed live via `pg_get_functiondef` afterward.

**FK cascade change (`global_sla_config_org_id_fkey` → `ON DELETE CASCADE`): considered, NOT made.** Per the brief's explicit preferred order (fix test cleanup → fix nondeterminism → only touch FK cascade if production semantics clearly justify it), and since items 1 and 2 already fully resolve the stated problem: the `organizations` table has a genuine mix of `NO ACTION` (business records: `profiles`, `requests`, `tasks`, `services`, `departments`, `locations`, …) and `CASCADE` (pure per-org settings: `org_module_access`, `license_keys`, …) foreign keys, and `global_sla_config` is arguably a settings table like the latter group. But the app is asserted single-tenant in production (migration 088's own comment) — no real workflow ever deletes an organization — so this FK's delete behavior is, today, exercised **only** by test fixtures. Changing production schema behavior solely to make tests more convenient, when the actual problem is already fully solved by fixing the tests' own cleanup, is exactly the kind of change the brief cautions against. **Left unchanged.**

---

## Production Safety Review

- **No table, column, constraint, RLS policy, or trigger definition changed.** Only `handle_new_user()`'s function body was replaced, and only its `org_id` subquery changed — the `full_name`/`avatar_url` logic is byte-identical to before.
- **No real caller's behavior changes.** `inviteUser()` and `bulkCreateUsers()` always overwrite `org_id` immediately after creation (confirmed above) — whatever `handle_new_user()` picks, deterministic or not, is discarded before it's ever read by application code, RLS, or the requester. A brand-new self-signup flow (if one existed) would see a behavior change — the assigned org would now be the deterministic oldest org rather than an arbitrary one — but no such flow exists in this codebase today.
- **No new security surface.** The function remains `SECURITY DEFINER`, same `search_path`, same trigger binding, same table touched.

---

## Tenant Isolation Tests

Both new scenarios run against the real local Postgres instance (`tests/integration/stage3-2-org-assignment.test.ts`):

1. **Explicit org context → user must never land in a stray org (AC-3.2.5):** with two stray orgs present, `bulkCreateUsers()` (the real production mechanism) is called as an admin whose own profile is in the seed org. Asserts the created user's `org_id` equals the seed org and is neither of the two stray orgs.
2. **No explicit context → deterministic, safe fallback (AC-3.2.4):** with the same two stray orgs present, a raw `createTestUser()` call (no follow-up correction — the exact pattern every test fixture already uses) is repeated 3 times; every single one lands in the seed org, never either stray org. This is the scenario that would have failed under the old unordered `LIMIT 1` once the query planner happened to return a stray org instead.

Both together demonstrate the safest-existing-behavior principle from Step 10: an explicit org context is never overridden, and the fallback used when no context is available is deterministic and always resolves to the one real org — never to an arbitrary/wrong tenant.

---

## Leak-Prevention Tests

From the same new test file:

1. **Deletion is real, not assumed:** creates a throwaway org, asserts (via query) that both it and its auto-created `global_sla_config` row exist, calls `deleteTestOrg()`, then asserts (via query) that both are gone.
2. **Failure is loud, not silent:** creates an org with a blocking `teams` row still attached, asserts `deleteTestOrg()` **throws** rather than swallowing the failure — proving the new helper actually surfaces a fixture regression instead of leaking quietly the way every affected fixture did before this stage.
3. **Repeated cycles don't drift the baseline:** runs 3 consecutive create-org → assert-count-increased → `deleteTestOrg()` → assert-count-returned-to-baseline cycles in a single test, proving the DB's org count is stable across repetition, not just after one run.

---

## Commands Run

```bash
# Targeted, first (all 5 affected fixtures + the new test file)
npx vitest run tests/integration/stage1-1-create-request-core-security.test.ts tests/integration/stage1-1-intake-review-fixes.test.ts tests/integration/stage2-mobile-identity.test.ts tests/integration/stage3-questionnaire-catalog-security.test.ts tests/integration/stage3-1-title-contract.test.ts
# → 5 files, 66 tests, 0 failures — repeated 3 times consecutively, same result every time, org count returned to 1 after each

npx vitest run tests/integration/stage3-2-org-assignment.test.ts
# → 1 file, 5 tests, 0 failures — repeated twice consecutively

# Full suite, 4 times consecutively, zero manual DB intervention between runs
npx vitest run   # Run 1: 44 files, 390 tests, 0 failures
npx vitest run   # Run 2: 44 files, 390 tests, 0 failures
npx vitest run   # Run 3: 44 files, 390 tests, 0 failures
npx vitest run   # Run 4: 44 files, 390 tests, 0 failures

node node_modules/typescript/lib/tsc.js --noEmit   # clean
npm run lint                                        # 0 errors, 3 pre-existing warnings (unrelated files)
```

This is a qualitatively different result from Stage 3.1's regression work, where full-suite runs required manual database purges between attempts to stay green — the four runs above needed **no intervention at all**, which is itself the proof that the root cause is fixed rather than papered over.

---

## Database State After Final Tests

- **Leaked test orgs found:** **NO.** `organizations` contains exactly one row (`00000000-0000-0000-0000-000000000001`, the real seed org) after 4 consecutive full-suite runs.
- **Stale `global_sla_config` rows found:** **NO.** Every row's `org_id` is the seed org.
- **Stale test profiles found:** **NO.** Zero profiles exist outside the seed org.
- **Stale test auth users found:** **Partially — 5 remain, from files this stage did not touch.** After the 4 full-suite runs, 13 leftover `@example.test` auth users were found; 9 were cleanly deletable and removed as hygiene, 5 remain blocked by unrelated FK references from `item6-assignment-rbac.test.ts` and `desk-uat-001-reopen.test.ts` — two pre-existing files with their own separate auth-user cleanup gap, unrelated to organizations/tenancy (their profiles are correctly in the seed org; this is a different bug category with no tenant-safety impact). Per Step 9 ("do not change business logic unrelated to this issue"), these files were not modified — see "Known Gaps".

---

## TypeScript

Clean. (One transient batch of errors appeared mid-session in `.next/dev/types/routes.d.ts`/`validator.ts` — a gitignored, auto-generated Next.js build artifact being actively rewritten by a concurrent dev server process in the same working directory, unrelated to any file touched this stage; confirmed by re-running after the concurrent process settled, and by filtering `.next/*` out of the output, which left zero errors even while it was happening.)

## ESLint

`npx eslint` on every new/changed file individually: 0 errors, 0 warnings. `npm run lint` (project script, `app lib components types proxy.ts`): 0 errors, 3 pre-existing warnings, all in files untouched by this stage (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx`).

---

## Files Changed

**New:**
- `supabase/migrations/20240101000134_deterministic_handle_new_user_org.sql`
- `tests/setup/cleanup-org.ts`
- `tests/integration/stage3-2-org-assignment.test.ts`

**Modified (cleanup fix only — no assertions, fixtures' entities, or test logic changed):**
- `tests/integration/stage1-1-create-request-core-security.test.ts`
- `tests/integration/stage1-1-intake-review-fixes.test.ts`
- `tests/integration/stage2-mobile-identity.test.ts`
- `tests/integration/stage3-questionnaire-catalog-security.test.ts` (refactored its existing Stage-3.1 fix onto the new shared helper)
- `tests/integration/stage3-1-title-contract.test.ts` (refactored its existing Stage-3.1 fix onto the new shared helper)

No file under `lib/requests/`, `lib/actions/`, `app/`, or `components/` was touched. No business logic, questionnaire, title/description, mobile-identity, or ticket-lifecycle code was changed.

---

## Known Gaps

1. **5 stale auth users in `item6-assignment-rbac.test.ts` / `desk-uat-001-reopen.test.ts`** — a separate, pre-existing auth-user (not organization) cleanup gap, unrelated to tenancy/`handle_new_user()`, discovered incidentally while verifying DB cleanliness. Explicitly out of scope for this stage (Step 9); left unmodified. Recommend a small follow-up auditing these two files' `afterAll` cleanup ordering against whatever FK now blocks their user deletes.
2. **No other gaps.** The `global_sla_config` FK cascade question was evaluated (see "Migration Added") and deliberately left unchanged, matching the brief's preferred order.

---

## Stage 4 Readiness

**READY FOR STAGE 4: YES**, with respect to this stage's own mandate (test-environment determinism). The specific instability Stage 3.1 observed — a full-suite run jumping to dozens of failures purely from accumulated fixture state — is fixed at its root (deterministic `handle_new_user()`) and at its cause (fixture cleanup), and proven stable across 4 consecutive full-suite runs with no manual intervention.

The one caveat is the pre-existing, unrelated auth-user leak noted above — it does not reproduce the cross-org corruption pattern this stage targets, does not block Stage 4, but is worth fixing in its own small follow-up before Stage 4 adds real concurrency/persistence tests that will create even more test users.

No conversation persistence, no WhatsApp/Meta code, and no questionnaire/title/description/mobile-identity/business-logic change was made or started, per the stop condition.
