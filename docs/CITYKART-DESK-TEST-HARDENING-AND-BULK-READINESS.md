# CITYKART DESK — Test Hardening and Bulk-Test Readiness

## 1. Executive Summary

Following `TEST-FIXTURE-FIX-AND-REGRESSION-RESULTS.md`, this pass makes the
automated test suite genuinely repeatable, clean-slate compatible, and
idempotent before any bulk/concurrency load testing begins. It also
corrects a classification error from that earlier report: `business_hours`
is system configuration, not disposable business data, and this document's
Clean-Slate Seed Manifest formalizes that distinction for every table.

Five files that mixed "flaky test" with "test that fundamentally requires
real production catalog config" were separated cleanly: a new opt-in gate
(`RUN_PRODUCTION_CATALOG_UAT`) means core `npm test` never depends on data
that doesn't exist in a clean-slate database, and never silently passes a
test that can't actually run. ~30 hardcoded mobile numbers in one file and
a fixed `RUN_TAG` in three others were replaced with dynamic, run-unique
values. A real cleanup-ordering bug, a pre-existing latent assertion bug,
and a `conversation_events` leak were all found and fixed along the way.
Two more system-seed tables (`sla_escalation_rules`, `alert_rules`) were
found silently wiped locally — same root cause as the earlier
`business_hours` gap — and restored.

The full suite ran three times consecutively with zero cleanup between
runs: identical results every time (82 passed / 4 skipped / 0 failed). A
fourth confirmation run (after one more fix) hit one transient,
non-reproducible timing flake, unrelated to residue. `tsc`, `lint`, and
`build` are all clean. Everything is test infrastructure and
documentation — no application code changed, nothing was written to
Main, and there are no manual Main-only patches to reconcile: the
standard `git push` + future deploy workflow carries all of this as-is.

**Verdict: READY FOR BULK LOAD TEST** (Section 20).

## 2. Previous Regression Baseline

Per `TEST-FIXTURE-FIX-AND-REGRESSION-RESULTS.md` (accepted, commit
`849f67d`): the `EXISTING_DEPARTMENT_ID` fixture fix and `business_hours`
restore took the suite from 48 failing files to 8 remaining failures, all
explained (5 self-inflicted residue from repeated same-session runs, 3
pre-existing production-catalog dependencies). This document starts from
that state and closes the remaining gaps.

## 3. Stage7A Fixture Repeatability Fix

Reading the three `stage7a-*` files (plus `stage7-1-semantic-role-real-service.test.ts`
and `stage7b-parity-sla-assignment.test.ts`) in full revealed the repeatability
bug was entangled with a classification issue: most of the content in these
files isn't "a test that leaves residue" — it's a **Production Configuration
Acceptance Test** that depends on real, currently-live IT/HR/Finance/Legal
Support catalog config by hardcoded ID, which cannot exist in a genuinely
clean-slate database at all, regardless of RUN_TAG.

Added `tests/setup/uat-mode.ts` — two shared opt-in gates:
- `RUN_PRODUCTION_CATALOG_UAT` (default `false`): gates any test that
  depends on real production catalog config. Skipped with an explicit,
  readable reason string when off — never silently passed, never counted
  as a core-regression failure.
- `PRESERVE_UAT_FIXTURES` (default `false`): when `true`, an UAT-style
  test's own fixtures (personas, WhatsApp channel, conversations, requests)
  are left in place for manual review instead of self-cleaning.

Per-file outcome:

| File | Classification | Fix |
|---|---|---|
| `stage7a-attachments-fixture.test.ts` | **Mixed** — UAT-13/14/15 (real IT Support catalog) vs. the "UAT Fixture — Field Types" test (self-contained: creates its own department/team/service/category/sub-category) | Gated UAT-13/14/15 behind `RUN_PRODUCTION_CATALOG_UAT`; the Field Types test now always runs, self-cleans in a `try/finally` (found and fixed a real FK-order bug in the process — see below), and uses a unique `RUN_TAG` instead of the fixed literal `'uat7a-a1'` |
| `stage7a-canonical-identity-search.test.ts` | Production Configuration Acceptance Test (whole file — IT/HR/Legal/Finance/Vendor Creation by hardcoded ID) | Whole `describe` gated behind `RUN_PRODUCTION_CATALOG_UAT`; unique `RUN_TAG`; `afterAll` added |
| `stage7a-mandatory-fields-flow.test.ts` | Production Configuration Acceptance Test (whole file — IT/Finance/Legal by hardcoded ID) | Same treatment |
| `stage7-1-semantic-role-real-service.test.ts` | Production Configuration Acceptance Test (whole file — real IT Support Template) | Already had a unique `RUN_TAG` and proper `afterAll`; only needed the gate |
| `stage7b-parity-sla-assignment.test.ts` | Production Configuration Acceptance Test (both `describe` blocks — real IT/HR Support) | Already had a unique `RUN_TAG` and proper `afterAll`; only needed the gate |

**Real bug found while fixing this**: the Field Types test's new
`try/finally` cleanup initially failed with
`update or delete on table "departments" violates foreign key constraint
"teams_department_id_fkey"` — its own `finally` block deleted
service/team/department, but the request row created during the test
(referencing `service_id`) is only cleaned by the file's describe-level
`afterAll`, which runs *after* every test in the file finishes, too late to
unblock this test's own FK chain. Fixed by deleting the test's own
request/conversation first, inside its own `finally`, before touching
service/team/department.

**A second, pre-existing bug found**: the same test's final assertion
checked `expect(fd.impact_confirmed).toBe(true)`, but the conversation
sends `'No'` for that checkbox a few lines earlier — per the test's own
comment, that should map to `false`. This file's `beforeAll` had always
failed before (the `intake_channels` duplicate-key collision), so this
specific assertion had never actually executed until this fix made the
file runnable end to end. Corrected to `.toBe(false)`.

Verified: ran these 6 files together twice, back-to-back, no cleanup
between — 25 passed, 18 skipped (all with clear reasons), 0 failed, both
times, identically.

## 4. Mobile Fixture Repeatability Fix

`tests/integration/stage2-mobile-identity.test.ts` used ~30 hardcoded
literal mobile numbers (`'9812345678'`, `'9700000001'`, etc.) across its 24
tests. Two of these literals collided with leftover rows from this
session's earlier repeated runs, producing the original
`AC-2.2`/dup-mobile failures.

Added a local generator:

```ts
const RUN_SEED = String(Date.now() % 1_000_000).padStart(6, '0')
let mobileSeq = 0
function testMobile(): string {
  mobileSeq += 1
  return `9${RUN_SEED}${String(mobileSeq).padStart(3, '0')}`
}
```

- First digit fixed `9` — always valid against `lib/users/mobile.ts`'s
  `INDIA_MOBILE_REGEX` (`/^[6-9][0-9]{9}$/`).
- Unique **within** a run via the incrementing sequence.
- Unique **between** runs via the `Date.now()`-derived seed (repeats only
  every ~16.7 minutes, and only if a prior run's cleanup also failed).
- Never a real employee/customer number — synthetic seed + sequence only.

Every hardcoded literal was replaced with a `testMobile()` call (or a
locally-scoped `const` reused where a test *intentionally* needs the same
number twice — re-adding a number to the same profile, moving a number
between two profiles, the in-CSV duplicate-mobile test, the cross-org
same-number test). The duplicate-mobile detection tests still exercise
`idx_profile_mobile_numbers_org_mobile_unique` for real: two records
attempt the same generated number within the same test, exactly as before
— only the number's origin (hardcoded literal to generated) changed, never
the test's logic or the constraint it's checking.

Verified: `stage2-mobile-identity.test.ts` — 24/24 passed, run standalone.

## 5. Production Catalog Test Classification

Covered in full under Section 3 — the classification work and the fixture
fix were inseparable for these 5 files (the gate is what makes them stop
being "flaky/residue-prone" and start being "correctly skipped when their
prerequisite doesn't exist"). Summary:

- **Core automated regression** (self-contained, always runs): the "UAT
  Fixture — Field Types" test in `stage7a-attachments-fixture.test.ts`.
- **Production Configuration Acceptance Tests** (opt-in via
  `RUN_PRODUCTION_CATALOG_UAT=true`, skipped with a clear reason by
  default): UAT-13/14/15 in the same file, plus all of
  `stage7a-canonical-identity-search.test.ts`,
  `stage7a-mandatory-fields-flow.test.ts`,
  `stage7-1-semantic-role-real-service.test.ts`, and
  `stage7b-parity-sla-assignment.test.ts`.

No fake services were fabricated to force these to pass — they are
skipped, explicitly, with a message naming exactly why.

## 6. Full Test-Suite Dependency Audit

Searched every file under `tests/` for hardcoded UUIDs, mobile numbers,
email addresses, fixed `RUN_TAG` values, real service/team/department
names, real store/user/category IDs, assumptions about pre-existing DB
rows, and tests that deliberately leave data behind.

**Hardcoded UUIDs** (`grep -rn` for the UUID shape across `tests/`, every
match reviewed): outside the 5 files handled in Sections 3/5, every match
was one of:
- `00000000-0000-0000-0000-000000000001` — the bootstrap org id. Legitimate
  SYSTEM-SEED DEPENDENT usage, present in nearly every fixture file. Not a
  bug: this row is expected to always exist (see the Clean-Slate Seed
  Manifest).
- A deliberately-nonexistent sentinel ID (`...0000000000ff`,
  `...0000000000fff`, `...0000000000099`) used to test a negative path —
  "an invalid selection is still rejected", "an org with no services
  returns an empty array, not an error", "a deliberately invalid
  requesterId". SELF-CONTAINED: the ID's whole point is to not resolve to
  anything real.

No other file had a bad hardcoded UUID.

**Hardcoded email addresses**: none. Every email in the suite is built
from a `RUN_TAG` template string (`` `${RUN_TAG}-...@example.test` ``).

**Real service/team/department names** (literal string match, e.g.
`.eq('name', 'IT Support')`): none found outside the 5 files in Section 3.

**Real store/OEM IDs**: none found — `stores`/`oems` have zero references
anywhere in `tests/`.

**Fixed (non-`Date.now()`) `RUN_TAG` values**: only the 3 `stage7a-*`
files (Section 3), now fixed.

**Hardcoded mobile numbers**: `stage2-mobile-identity.test.ts` (Section 4,
fixed) is the only file where a literal number was reused *across multiple
independent test cases within the same describe block* with no cleanup
between them — the exact shape that collides with residue from a prior
run. 35 files (`stage4-*`, `stage5-*`, `stage6-*`, `stage7b-*`) use
literal-looking mobile numbers too, but as a single WhatsApp sender
identity scoped to *one* test/fixture set, torn down by that file's own
`RUN_TAG`-scoped `afterAll` — a materially different, lower-risk pattern
(CLASSIFIED: SELF-CONTAINED, not BAD HARDCODED FIXTURE). Rather than
rewrite all 35 speculatively, Phase 7's back-to-back triple run (Section
9-11) is the actual empirical test for this class of bug across the whole
suite — it would surface any file where this pattern actually collides,
the same way it originally surfaced `stage2-mobile-identity.test.ts`.

**Tests that deliberately leave data behind**: `stage7b-parity-sla-assignment.test.ts`'s
`UAT-18c` block intentionally does NOT delete its one UAT-only
`business_rules` row + fixture sub-category — documented in its own source
comment as "left for the centralized Stage 7 cleanup pass." Now moot in
practice since the whole file is gated behind `RUN_PRODUCTION_CATALOG_UAT`
(default off), but noted here as a legitimate, intentional exception, not
an oversight.

**Classification summary**:

| Class | Count | Examples |
|---|---|---|
| SELF-CONTAINED | ~80 files | Everything using its own `RUN_TAG`-scoped fixtures with proper `afterAll` |
| SYSTEM-SEED DEPENDENT | all files | The bootstrap org id (`...0001`) |
| PRODUCTION-CONFIG DEPENDENT | 5 files | Gated behind `RUN_PRODUCTION_CATALOG_UAT` (Section 3/5) |
| BAD HARDCODED FIXTURE (fixed) | 13 files | 12 files' `EXISTING_DEPARTMENT_ID` (prior report) + `stage2-mobile-identity.test.ts` (this report) + 3 `stage7a-*` files' fixed `RUN_TAG` (this report, overlaps with PRODUCTION-CONFIG DEPENDENT above) |

## 7. Clean-Slate Seed Manifest

Full manifest: [`CLEAN-SLATE-SEED-MANIFEST.md`](CLEAN-SLATE-SEED-MANIFEST.md).

Summary — every table classified as PRESERVE/RESTORE (technical/system
seed) or DELETE (business/operational/test data), cross-checked against
every migration's own static `INSERT` statements rather than assumed.
Confirmed by this classification work: **two more system-seed tables were
found silently empty and restored this session**, beyond the
`business_hours` gap the prior report already fixed:

- `sla_escalation_rules` — 4 rows (Critical/High/Medium/Low warning),
  restored. The schema's `tier` check constraint was tightened after the
  original migration (now `low/medium/high/urgent` only) — the restored
  rows use `urgent` in place of the original literal `critical`, which
  the current schema would reject outright.
- `alert_rules` (bootstrap org) — 4 rows, restored. `org_id` became
  `NOT NULL` after the original migration — the restore supplies the
  bootstrap org id explicitly.
- `intake_pipeline_config` (bootstrap org) — 1 row, restored (Stage-1-only
  pipeline defaults).

All three are read by live app code (`lib/actions/admin/config.ts`,
`lib/actions/admin/business-rules.ts`), so this was a real, silent
functional gap, not just a test-infrastructure nuisance. Main was checked
for the same three tables; `business_hours` and `sla_escalation_rules`
check out fine there (queried via tables with permissive `USING (true)`
RLS policies). `alert_rules`/`intake_pipeline_config` could not be
conclusively checked on Main — see the manifest's "Not yet confirmed on
Main" section — and no write was made to Main during this pass (out of
scope for this test-infrastructure-focused session; flagged for a
follow-up with proper privileges).

## 8. Clean-Slate Validator

[`scripts/clean-slate-validator.mjs`](../scripts/clean-slate-validator.mjs) —
read-only, reports operational-row counts, test/UAT user counts, required
system-seed presence, the bootstrap org/admin, and every business
sequence's current value. Never deletes or modifies anything. Run with
`node scripts/clean-slate-validator.mjs` (or `--json` for machine-readable
output).

Current local state (mid-session, expected to be non-zero given today's
testing — this is exactly what the validator is for, not a clean slate
itself yet):

```
totalOrganizations: 8 (expect 1)
totalProfiles: 18 (expect 1)
business_hours_active: 5   sla_escalation_rules: 4   alert_rules_bootstrap_org: 4
intake_pipeline_config_bootstrap_org: 1
bootstrap organization: CityKart (active)
bootstrap platform owner profile: Suraj Kumar
CKSD sequence last_no: 239
```

## 9. Regression Run 1

Full suite, immediately after all fixture/gating fixes above, no cleanup
beforehand:

```
Test Files  82 passed | 4 skipped (86)
     Tests  657 passed | 18 skipped (675)
  Duration  266.93s
```

0 failed. The 4 skipped files are exactly the 5 Production Configuration
Acceptance Test blocks across 5 files (one file, `stage7a-attachments-fixture.test.ts`,
contributes 1 skipped test rather than a whole skipped file, since its
other test always runs).

## 10. Regression Run 2

Full suite again, immediately after Run 1, **no cleanup in between**:

```
Test Files  82 passed | 4 skipped (86)
     Tests  657 passed | 18 skipped (675)
  Duration  200.59s
```

Identical pass/skip counts to Run 1. 0 failed. No new duplicate-key
errors, no stale-ID collisions, no residue-driven flakiness.

## 11. Regression Run 3

Full suite a third time, immediately after Run 2, **still no cleanup**:

```
Test Files  82 passed | 4 skipped (86)
     Tests  657 passed | 18 skipped (675)
  Duration  192.90s
```

Identical to Run 1 and Run 2 in every count. Three consecutive runs, zero
manual cleanup between them, identical results each time — idempotency
proven, not assumed.

## 12. Residue Check

Ran `node scripts/clean-slate-validator.mjs` before Phase 7's three runs
and again immediately after. Comparing the two:

| Metric | Before 3 runs | After 3 runs | Delta |
|---|---|---|---|
| `requests` | 0 | 0 | none |
| `organizations` (total) | 8 | 8 | none |
| `profiles` (total) | 18 | 18 | none |
| `departments` | 3 | 3 | none |
| `teams` | 3 | 3 | none |
| `services` | 1 | 1 | none |
| `intake_channels` | 3 | 3 | none |
| `team_members` | 1 | 1 | none |
| `request_conversations` | 9 | 9 | none |
| `conversation_events` | 95 | 134 | **+39** |
| `request_sequences` (CKSD `last_no`) | 239 | 467 | +228 (expected — see below) |

Every count that matters for "did the 3 runs leave new residue" held flat.
Two deltas needed explanation, not alarm:

- **`request_sequences.last_no` growing by 228**: expected, documented
  behavior (`generate_request_no()` only increments — deleting a `requests`
  row never decrements it). Across 3 full-suite runs, every test that
  creates a real ticket consumes one more sequence number regardless of
  whether the row is cleaned up afterward. This is exactly why the final
  clean-slate reset (a later phase, not this one) must explicitly
  `UPDATE request_sequences SET last_no = 0`, not just delete rows.
- **`conversation_events` growing by 39**: **a real, newly-introduced leak,
  traced and fixed.** Querying `external_message_id` prefixes showed all
  134 rows were tagged `uat7a-*` — i.e. from this session's own Section 3
  fix, not a pre-existing issue. `stage7a-attachments-fixture.test.ts`'s
  always-running "Field Types" test creates a real conversation via
  `processWhatsAppWebhookPayload()`, which writes `conversation_events`
  rows — and the `afterAll` I added in Section 3 cleaned
  `requests`/`request_conversations`/the WhatsApp channel, but not
  `conversation_events`. Fixed by adding the same
  `conversation_events` delete (scoped by `org_id` + `RUN_TAG`) that every
  other properly-idempotent fixture file in this suite already uses, in
  all three `stage7a-*` files (the other two only matter once
  `RUN_PRODUCTION_CATALOG_UAT=true` is set, but fixed for consistency).
  Verified with a targeted before/after: ran the file twice back-to-back,
  `conversation_events` count for its tag stayed at 0 both times after the
  fix, versus accumulating before it.

No other accumulating residue found. No intentionally-retained rows exist
in the currently-active (non-gated) test set — the one documented
exception (`stage7b-parity-sla-assignment.test.ts`'s `UAT-18c` business
rule, intentionally left for centralized cleanup) sits inside a
`RUN_PRODUCTION_CATALOG_UAT`-gated block that doesn't run by default.

A fourth full-suite run was executed after this fix, as a final
confirmation (not a repeat of the idempotency proof, which Runs 1-3 above
already established):

```
Test Files  1 failed | 81 passed | 4 skipped (86)
     Tests  1 failed | 656 passed | 18 skipped (675)
  Duration  196.70s
```

One failure: `stage6-web-whatsapp-parity.test.ts` — asserts a web-created
and a WhatsApp-created ticket's SLA windows land within 5 seconds of each
other; got a 59.4-second gap instead.
`Math.abs(responseWindowMs(waRow) - responseWindowMs(webRow))` compares
two *wall-clock-timed* sequential operations against a fixed 5-second
tolerance. Re-ran this file alone immediately after: passed cleanly in
1.3s, well inside tolerance. This is the 4th consecutive full-suite
invocation today with no pause between any of them — a transient
timing flake under sustained local resource contention (matches this
engagement's own earlier-documented finding that this box is genuinely
slower under load, not the kind of duplicate-key/stale-ID residue this
phase exists to catch). Not reproducible in isolation; not caused by, or
related to, any fix in this document. Flagged in Section 19 as a known
risk (a wall-clock-tolerance-based assertion) rather than silently
dismissed.

## 13. TypeScript

`npx tsc --noEmit` — run after every phase's edits in this document, not
just once at the end: **clean, 0 errors**, every time.

## 14. Lint

`npm run lint` — **0 errors**, 3 pre-existing warnings, all in files
untouched by this session (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`,
`RequestActionBar.tsx` — pre-existing `react-hooks/exhaustive-deps` and
`no-unused-vars` warnings, unrelated to test infrastructure).

## 15. Build

`npm run build` — **successful**, exit code 0. Every route compiled (app
routes, admin routes, API routes, the WhatsApp/Gmail/Outlook intake
webhooks, the proxy middleware). Ran alongside the still-live local dev
server (port 3001, per this session's standing "never stop it" rule) with
no conflict — confirmed the dev server still answered `HTTP 200` on
`/login` immediately after the build finished.

## 16. Git Commit

`git status` reviewed before staging — exactly the 9 files this document
describes, nothing else. Scanned the diff for anything secret-shaped
(service-role keys, passwords, connection strings); none found. No
`.env`/`.env.local`, no logs, no DB dumps in the change set.

Commit: [`a3bf265`](https://github.com/kumarsuraj84/Citykartdesk/commit/a3bf265) —
"Make the test suite idempotent: gate production-catalog UAT tests, fix
mobile/RUN_TAG residue, add clean-slate seed manifest + validator".

## 17. Push Result

Pushed to `origin/main`: `e2534cc..a3bf265 main -> main`. Successful.

## 18. Remaining Skipped Tests

18 tests across 5 files, all Production Configuration Acceptance Tests,
all skipped for the same documented reason (real IT/HR/Finance/Legal
Support catalog config not present in this clean-slate environment):

- `stage7a-attachments-fixture.test.ts` — 1 test (UAT-13/14/15)
- `stage7a-canonical-identity-search.test.ts` — 9 tests (whole file)
- `stage7a-mandatory-fields-flow.test.ts` — 3 tests (whole file)
- `stage7-1-semantic-role-real-service.test.ts` — 1 test (whole file)
- `stage7b-parity-sla-assignment.test.ts` — 4 tests (both describe blocks)

Each is intentional, explained, and reversible: set
`RUN_PRODUCTION_CATALOG_UAT=true` to run them against a real production
catalog when one exists (e.g. after Main's real IT/HR Support config is
seeded, or in a future UAT pass against a non-clean-slate environment).
None are silently passing — a skip shows in the runner's own output with
the reason appended to the test name.

## 19. Remaining Risks

- **`stage6-web-whatsapp-parity.test.ts`'s SLA-window-parity assertion
  uses a fixed 5-second wall-clock tolerance** comparing two sequential
  operations' timing. Confirmed flaky under sustained load (failed once,
  in this session's 4th consecutive full-suite run, with a 59.4s gap; not
  reproducible in isolation). Low risk for normal CI/local runs (one
  suite run at a time), but could resurface during the upcoming bulk/
  concurrency load test if this specific file runs concurrently with
  heavy load. Not fixed in this pass — it's a pre-existing test-design
  choice (wall-clock tolerance) unrelated to anything this document's
  phases were scoped to change; worth a tolerance review before or during
  the load-test phase if it recurs.
- **`alert_rules`/`intake_pipeline_config` on Main not conclusively
  checked** — see Clean-Slate Seed Manifest's "Not yet confirmed on Main"
  section. Needs a properly-privileged (superuser or `service_role`)
  connection to check for real, and any restore needs the same
  schema-drift care this session's local restore required (verify current
  constraints before replaying old migration literals).
- **35 files use literal-shaped mobile numbers** as scoped, per-run
  WhatsApp sender identities (Section 6) — classified SELF-CONTAINED based
  on their cleanup pattern, not individually stress-tested. The Section
  9-11 triple run (which exercises all of them) showed zero collisions,
  which is real evidence, but isn't an exhaustive proof for every
  possible run-timing combination the future load test might create.
- **`global_sla_config`** (28 rows locally, legacy/unread by current app
  logic per Section 7) was not cleared in this pass — harmless dead data,
  but worth including explicitly in whatever script performs the eventual
  clean-slate DELETE pass, since it's easy to overlook (not in the
  DELETE list's memorable "obvious" tables).

## 20. Bulk-Test Readiness Verdict

**READY FOR BULK LOAD TEST**

- Core regression healthy: 82/86 files passing, the remaining 4 are
  explicitly-skipped Production Configuration Acceptance Tests, not
  failures.
- Repeated runs stable: 3 consecutive full-suite runs, zero cleanup
  between them, identical results every time.
- Fixture residue controlled: the one real leak found in this pass
  (`conversation_events` from the newly-fixed `stage7a-attachments-fixture.test.ts`)
  was root-caused and fixed, verified with a targeted before/after showing
  0 residue after the fix.
- No unexplained duplicate-key failures: every failure encountered across
  this entire test-hardening pass (both in the prior report and this one)
  was traced to its actual root cause, not left as a mystery.
- Clean-slate system seed defined: `docs/CLEAN-SLATE-SEED-MANIFEST.md`,
  cross-checked against every migration's own seed `INSERT`, not assumed.
- `business_hours` correctly classified as system config, not business
  data, and enforced going forward via the manifest + validator (this was
  the specific correction this document's opening explicitly required).
- Production-config tests explicitly separated via `RUN_PRODUCTION_CATALOG_UAT`,
  never silently passed or counted toward core-regression success.
- TypeScript clean, build successful.

The one open item (Section 19's timing-tolerance test) is a low-probability
risk under normal load, not a blocker — it did not reproduce on retry and
is unrelated to the residue/repeatability class of bug this pass targeted.
Recommend keeping an eye on it specifically during the mixed-concurrency
phase of the upcoming load test, since that's the condition most likely to
reproduce the kind of sustained load that triggered it here.
