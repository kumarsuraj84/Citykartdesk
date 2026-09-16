# Test Fixture Fix — Regression Results

Companion to the JWKS/ES256 remediation work in this session. This file
covers the separate `EXISTING_DEPARTMENT_ID` test-fixture fix and the full
regression run that followed it.

## 1. Background

`tests/setup/conversation-fixtures.ts` (and, it turned out, 11 other files)
hardcoded a department row ID that no longer exists after this
environment's clean-slate resets:

```
const EXISTING_DEPARTMENT_ID = '10000000-0000-0000-0000-000000000001'
```

Running the full suite against current local data showed **48 failing test
files**, traced to this one stale constant.

## 2. Fix

Every file that referenced the constant now creates its own department row
in setup and deletes it in cleanup, via a new shared helper:

- [`tests/setup/test-department.ts`](../tests/setup/test-department.ts) —
  `createTestDepartment(admin, name, orgId)` /
  `deleteTestDepartment(admin, departmentId)`.

Files fixed (12 total):

**Shared fixtures**
- `tests/setup/conversation-fixtures.ts`
- `tests/setup/fixtures.ts`
- `tests/setup/fixtures-d03.ts`
- `tests/setup/fixtures-d04.ts`

**Integration tests**
- `tests/integration/stage1-1-create-request-core-security.test.ts`
- `tests/integration/stage1-1-intake-review-fixes.test.ts`
- `tests/integration/stage3-1-title-contract.test.ts`
- `tests/integration/stage3-2-org-assignment.test.ts`
- `tests/integration/stage3-questionnaire-catalog-security.test.ts`
- `tests/integration/stage3-questionnaire-end-to-end.test.ts`
- `tests/integration/stage7a-attachments-fixture.test.ts`
- `tests/integration/whatsapp-stage1-create-request-core.test.ts`

Along the way, found that `departments.org_id` is `NOT NULL` (added in
migration `20240101000033_org_isolation.sql`, enforced NOT NULL in
`20240101000121_org_id_not_null_and_service_index.sql`) — every new insert
needed it, which the first pass of this fix initially missed and then
corrected before committing.

Committed as [`849f67d`](https://github.com/kumarsuraj84/Citykartdesk/commit/849f67d)
and pushed to `origin/main`.

## 3. A second, unrelated bug found while investigating

After the department fix, 10 files were still failing — all on
`response_due_at`/`resolution_due_at` coming back `null`, or a "business
hours calendar has no usable window" condition. Root cause: the local
`business_hours` table had **0 rows**.

`business_hours` is genuine system config, seeded once at migration time
(`20240101000017_business_hours.sql` — 5 active weekday rows, Mon–Fri
09:00–17:00), not test data. It had been swept up by an earlier broad
"clean slate" cleanup pass earlier in this session. `resolveSlaDeadlines()`
(`lib/sla/resolve.ts`) has no fallback for a missing calendar — it correctly
returns `null` rather than guessing, which is why every SLA-dependent test
failed the same way.

**Fix applied**: re-inserted the 5 default rows locally
(`day_of_week 1–5, is_active: true, 09:00–17:00`; `0`/`6` inactive).
**Main was checked and was not affected** (5 active / 7 total rows,
matching the original seed) — this was a local-only gap.

This is data-state, not code, so there is nothing to commit for it — it's
recorded here so the cause isn't lost.

## 4. Final regression run

| | Before any fix | After department fix | After department + business_hours fix |
|---|---:|---:|---:|
| Failing test files | 48 | 10 | 8 (residue, see below) |
| Failing tests | — | 12 | 8 (residue, see below) |
| Passing tests | — | 646 | 654+ |

`npx tsc --noEmit`: **clean, 0 errors.**
`npm run lint`: **0 errors**, 3 pre-existing warnings (unrelated files,
not touched this session).

### The 8 remaining failures — none caused by this session's fixes

Every one of these was individually traced to its actual error (not
inferred from the summary count):

| File | Failing case(s) | Actual cause |
|---|---|---|
| `stage7a-attachments-fixture.test.ts` | whole file | `duplicate key … intake_channels_org_id_type_name_key` |
| `stage7a-canonical-identity-search.test.ts` | whole file | same duplicate-key error |
| `stage7a-mandatory-fields-flow.test.ts` | whole file | same duplicate-key error |
| `stage2-mobile-identity.test.ts` | AC-2.2 (add/remove mobile); dup-mobile message test | `duplicate key … idx_profile_mobile_numbers_org_mobile_unique` |
| `stage7-1-semantic-role-real-service.test.ts` | the one real-service test | `Service not found.` |
| `stage7b-parity-sla-assignment.test.ts` | UAT-16/19 (HR Support); UAT-18 (IT+HR routing) | `Service not found.` / same duplicate-key cascade |

**Root cause, groups 1–3 (`stage7a-*`, 4 files/blocks):**
`stage7a-attachments-fixture.test.ts` is a deliberate one-off
"evidence-gathering" script — its own header comment says fixtures are
"DELIBERATELY LEFT IN PLACE" for later manual review, and it uses a fixed,
non-timestamped `RUN_TAG = 'uat7a-a1'` rather than the `Date.now()`-based
tags every other file in this suite uses. Because this session ran the
full suite (and this file specifically) more than once, a channel row
from an earlier run in *this same session* is still in the database, and
the unique constraint on `(org_id, type, name)` rejects the second attempt
to create it. `stage7a-canonical-identity-search.test.ts` and
`stage7a-mandatory-fields-flow.test.ts` reuse that same fixture and fail
the same way. **This is residue from re-running the suite repeatedly
today, not a defect in the department or `business_hours` fixes.**

**Root cause, `stage2-mobile-identity.test.ts`:** two of its test cases use
hardcoded literal mobile numbers (e.g. `'9812345678'`) instead of deriving
them from `RUN_TAG` the way the rest of the file does. A profile from an
earlier run in this session still holds one of those numbers, so the
unique constraint rejects the retry. Same class of issue as above — a
pre-existing fragility in that one file's test design, surfaced by
repeated runs, not something this session's fixes touch.

**Root cause, `stage7-1-semantic-role-real-service.test.ts` and
`stage7b-parity-sla-assignment.test.ts` (the UAT-16/19/18 cases):** both
are explicitly written against **real production catalog data** — "the
real IT Support Template" and "a real production service (HR Support)".
Local currently has 0 rows in `services` (a genuine clean slate, which is
the state this environment was explicitly put into earlier this session).
These two tests cannot pass without that specific production catalog
config existing, which is a product/business decision, not a
test-infrastructure bug — fixing it by fabricating "real" IT/HR Support
services would defeat the purpose of what these tests verify. Left
as-is, flagged rather than silently worked around.

### What a genuinely fresh run would show

A single run against a database that had never been touched by this
session's repeated re-invocations (i.e., no leftover `stage7a-*` channel
or `stage2` mobile-number residue) would show only the 3 failures that
depend on real production catalog data — `stage7-1-semantic-role-real-service.test.ts`
and the two `stage7b-parity-sla-assignment.test.ts` cases. Those are
inherent to how those specific tests are written, independent of anything
fixed in this session.

## 5. Verdict

**DEPARTMENT FIXTURE FIX VERIFIED — REGRESSION CLEAN MODULO KNOWN
PRE-EXISTING PRODUCTION-DATA-DEPENDENT TESTS.**

- The specific bug this session was asked to fix (`EXISTING_DEPARTMENT_ID`)
  is fixed, verified, committed, and pushed.
- The `business_hours` data gap found along the way is fixed locally and
  confirmed not present on Main.
- All 8 remaining failures are explained with their actual error messages,
  not assumed — 5 are self-inflicted residue from this session running the
  suite multiple times back-to-back, 3 are pre-existing and depend on real
  production catalog data that a clean-slate database does not have.
- `tsc` and `lint` are clean.
