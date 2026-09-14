# STAGE 3.1 REPORT — Description & Subject/Title Contract Correction

## Status

**Complete.** The two semantic contracts identified in the brief are corrected, verified end-to-end against a real Postgres instance, and regression-tested against the full existing suite. **READY FOR STAGE 4: NO** — per the brief's own stop condition; this report is a checkpoint for review, not a request to proceed.

---

## Problem Confirmed

Both problems described in the brief were confirmed by reading the actual Stage 3 code (not assumed from memory):

1. **Description auto-mapped to a textarea.** `lib/requests/questionnaire/question-plan.ts` had `findDescriptionField()` (picks the form's first `textarea` field by type) and `applyDescriptionToAnswers()` (writes `draft.description` into that field's slot in `answers`). `adapter.ts` called this at build time. This meant a service whose form has an unrelated mandatory textarea (e.g. "Business Justification") would have that field silently satisfied by the requester's free-text issue description, and — because `createRequestCore()`'s own title derivation prioritizes `text` → `textarea` → `select`/`radio` → `multiselect` — the full raw description could also end up verbatim as `requests.title`.
2. **Review subject not guaranteed to become `requests.title`.** `title.ts`'s `generateRequestTitle()` output was passed into `buildReviewModel()` as a display-only `generatedTitle` field. `createRequestCore()` has no title parameter at all — it always re-derives `requests.title` itself from `formData` at insert time. So the Review screen's displayed subject and the actual stored title were two independently-computed values that could disagree whenever the resolved form's title-derivation field (e.g. a `select`) held something different from what `generateRequestTitle()` computed.

---

## Description Contract

`RequestDraft.description` is now the ONLY path to `requests.description`:

```
draft.description → createRequestCore()'s `description` param → requests.description
```

It is never written into `answers`/`formData`, regardless of what field types the resolved form contains. `adapter.ts`'s `buildCreateRequestInputFromDraft()` maps it directly and unconditionally:

```ts
description: draft.description,
```

No type-based (`field.type === 'textarea'`) or label-based inference exists anywhere in the questionnaire engine anymore. `findDescriptionField()` and `applyDescriptionToAnswers()` were **deleted** from `question-plan.ts` (not deprecated, not left as dead code) — see "Removed helpers" below.

---

## Dynamic Textarea Behavior

Confirmed via `tests/unit/questionnaire-question-plan.test.ts` (TEST 1, TEST 2) and `tests/unit/questionnaire-review.test.ts` (TEST 12): a mandatory template textarea field (single or multiple on the same form) is now **always** surfaced by `buildQuestionPlan()`/`getNextQuestion()` as a real, independently-answerable question, regardless of what `draft.description` holds. It only ever becomes satisfied by an explicit value placed in `answers[field.id]` via `answers.ts`'s `applyQuestionAnswer()` — the same path every other field type uses. `checkDraftReadiness()`/`validateRequesterFormCompletion()` correctly report the draft as not-ready until that happens.

---

## Title Contract

`RequestDraft.title` is now a first-class, trusted, precomputed property:

```
draft.title → createRequestCore()'s `titleOverride` param → requests.title (verbatim, after sanitization)
```

Generated once (Step 7, after description collection) via `generateRequestTitle()`, stored on the draft, and **never regenerated** by `buildReviewModel()` — Review reads `draft.title` directly. The adapter maps it unconditionally:

```ts
titleOverride: draft.title ?? undefined,
```

`RequestDraft` (`lib/requests/questionnaire/types.ts`) gained the field:

```ts
title: string | null
```

with a doc comment explicitly stating the idempotency invariant: once generated, `title` is carried forward unchanged through Review and creation, never silently recomputed.

---

## createRequestCore() Change

Inspected the current implementation in full (`lib/requests/create-request-core.ts`) before editing. Added one new, narrowly-scoped, optional, channel-neutral parameter:

```ts
titleOverride?: string
```

Chosen over the bare `title` alternative to match this file's own existing naming convention for "a caller supplies a trusted value that bypasses normal derivation" (`priorityOverride`, `teamIdOverride`) — with an explicit doc comment distinguishing it from those two: **title is presentation/content data only and never influences routing/security decisions**, unlike the priority/team overrides which are reserved for Email Intake's human-reviewed path.

Sanitization (`sanitizeTrustedTitle()`, module-private, unit-covered via `createRequestCore()` itself):
- Trims surrounding whitespace.
- Rejects empty/whitespace-only (falls through to the existing derivation instead of storing blank).
- Bounds to 120 characters (`MAX_TRUSTED_TITLE_LENGTH`) — the DB schema's `requests.title` column is a plain unbounded `TEXT NOT NULL` (confirmed via `supabase/migrations/20240101000000_initial_schema.sql`; no existing DB or UI maximum was found anywhere in the codebase), so 120 is a new, deliberately conservative bound, chosen to match `generateRequestTitle()`'s own existing `MAX_TITLE_LENGTH` constant for consistency between what Stage 3 generates and what this function will accept.

When a sanitized override is present, it is stored **verbatim, with no `${service.name}: ` prefix** — this is what makes "the exact same title shown at Review is the title on the created ticket" hold exactly, since the old derivation's prefix convention would otherwise silently diverge from whatever Review displayed.

```ts
const title = sanitizeTrustedTitle(titleOverride) ?? (titleValue ? `${service.name}: ${titleValue}` : service.name)
```

---

## Backward Compatibility

- **Web** (`lib/actions/requests.ts#createRequest()`): never sets `titleOverride` — unmodified, still gets the existing form-derived title. Verified unchanged via the full pre-existing `whatsapp-stage1-create-request-core.test.ts` web-path suite (still green) and a dedicated new test (TEST 7, below).
- **Email Intake** (`lib/actions/intake/work.ts#approveAndCreate()`): inspected in full. Its `payload.title` (the reviewer's Subject input) has never been passed to `createRequestCore()` directly — it flows through `buildFormData()`'s autofill into a real `text`-type form field, and `createRequestCore()`'s own existing `text`-priority derivation picks it up from there. **This file was not touched.** Confirmed unintentional-redesign-free via `git diff` (no changes) and the full pre-existing `stage1-1-intake-review-fixes.test.ts` suite staying green.
- **Stage 1 / Stage 1.1 / Stage 2 callers**: none of `createRequestCore()`'s other callers were modified. All pre-existing test suites for these stages re-run unchanged and green (see Regression Results).
- **Other callers discovered**: a full repo grep for `createRequestCore(` confirmed exactly three call sites — `lib/actions/requests.ts` (web), `lib/actions/intake/work.ts` (Email Intake), and the Stage 3 questionnaire adapter's own test/integration usage. No other caller exists to audit.

No existing caller is forced to supply `titleOverride` — it is purely additive and optional.

---

## Subject Generation

`lib/requests/questionnaire/title.ts`'s deterministic fallback (`deterministicTitle()`) was rewritten to be description-focused, per the brief's worked example (Sub-category "Printer Issue" + a real description → a phrase extracted from the description, not the bare sub-category name):

1. `extractPhraseFromDescription()` — deterministic, no NLP, no new dependency: cuts the description at its first clause boundary (sentence-ending punctuation, a comma, or a small set of joining conjunctions — "and"/"since"/"because"/"so"/"which"/"that"/"due to"), then caps the result to 8 words so it reads like a subject line, not a restated sentence.
2. If that phrase has ≥3 words, it's used alone (title-cased, with standard minor-word lowercasing — "Unable to Generate Invoice", not "Unable To Generate Invoice" — and with all-caps acronyms like "AC"/"POS" preserved rather than collapsed to "Ac"/"Pos").
3. If the phrase is thin (<3 words, e.g. "not working") and a sub-category name exists, they're combined: `"{SubCategory}: {Phrase}"` — avoids an ambiguous bare fragment.
4. Falls back to the sub-category name alone, then the service name alone.
5. The whole result (service name prefix + base) is bounded to 120 characters with an ellipsis if truncated.

**AI behavior unchanged from Stage 3**: `generateRequestTitle()`'s optional `aiProvider` hook is raced against a 3-second timeout; a thrown error, empty/whitespace-only result, timeout, or `null` all silently fall back to the deterministic title above — never blocks or fails ticket progression. No AI provider is wired into the root app today (confirmed again this stage — no new dependency was added or is required).

---

## Review/Create Parity

Explicitly proven end-to-end (`tests/integration/stage3-questionnaire-end-to-end.test.ts`, real Postgres, no mocked business logic):

```ts
expect(created?.title).toBe(generatedTitle)
expect(created?.title).toBe(review.title)

expect(created?.description).toBe(issueDescription)
expect(created?.description).toBe(review.description)
```

Both assertions passed on every run. The same test also proves the third leg of the contract (`draft.answers → requests.form_data`) independently — the mandatory "Business Justification" textarea and "Issue Type" select are the ONLY two entries in the stored `form_data`, and the description text never appears anywhere inside it.

---

## Tests Added / Updated

**Removed** (their only purpose was the incorrect auto-mapping behavior):
- `findDescriptionField()`, `applyDescriptionToAnswers()` and their unit tests.

**Updated**:
- `tests/unit/questionnaire-question-plan.test.ts` — replaced the removed-function tests with **TEST 1** (single mandatory textarea stays unanswered regardless of `draft.description`) and **TEST 2** (multiple mandatory textareas all stay unanswered until explicitly supplied).
- `tests/unit/questionnaire-review.test.ts` — `buildReviewModel()` calls updated to the new `draft.title`-only signature; added a case proving `draft.title`/`draft.description` are carried verbatim, never regenerated; added **TEST 12** (a template textarea field remains independently required even with a rich `draft.description` present).
- `tests/unit/questionnaire-adapter.test.ts` — **TEST 3** (description always maps to the `description` passthrough, never into `formData`, even when a textarea exists), **TEST 4** (`draft.title` maps to `titleOverride` exactly), plus a "no cross-contamination" test exercising all three mappings together.
- `tests/unit/questionnaire-title.test.ts` — rewritten for the description-focused fallback; includes **TEST 9** (AI returns empty string → deterministic fallback, progression succeeds), **TEST 10** (AI throws/times out → deterministic fallback), **TEST 11** (a rich description produces a title containing description-derived words, not merely the bare sub-category name), and a case proving an all-caps acronym in the description (e.g. "AC") is preserved rather than collapsed to "Ac" by the title-casing step.

**New**:
- `tests/integration/stage3-1-title-contract.test.ts` — **TEST 7** (no `titleOverride`: existing web-style derivation unchanged) plus sanitization (verbatim storage with no prefix, whitespace trimming, empty/whitespace-only fallback, 120-char bounding) and security (an invalid `titleOverride` cannot bypass sub-category/org validation; title content has zero effect on the DESK-derived priority).
- `tests/integration/stage3-questionnaire-end-to-end.test.ts` — rewritten in full (not just its final assertions) to walk the corrected pipeline and prove **TEST 5** (Review/Create title parity) and **TEST 6** (description DB parity) against a real created ticket, with an unrelated dynamic textarea field present specifically to prove independence.

**TEST 8** (Email Intake regression): satisfied by the full pre-existing `stage1-1-intake-review-fixes.test.ts` and `whatsapp-stage1-create-request-core.test.ts` Email Intake suites re-running unchanged and green — no new test needed since no Email Intake behavior changed.

---

## End-to-End Proof

From `stage3-questionnaire-end-to-end.test.ts`'s actual created row:

| Field | Value |
|---|---|
| `requests.title` | `"{Service Name}: The AC Unit in Store 12 Has Stopped"` — description-derived (clause-cut at "since", capped to 8 words, title-cased with acronyms like "AC" preserved rather than collapsed to "Ac" — see "Subject Generation"), **exact match to Review's displayed subject and to `draft.title`** — verified via direct assertion, not by eyeballing the string |
| `requests.description` | `"The AC unit in Store 12 has stopped cooling entirely since this morning."` *(exact match to Review's displayed description and to `draft.description`)* |
| `requests.form_data` | `{"business_justification": "Store cannot operate the billing counter without functioning AC in peak summer.", "issue_type": "hardware"}` *(exactly the two explicit answers — the description text appears nowhere in it)* |
| `requests.service_id` | the fixture's service |
| `requests.sub_category_id` | the fixture's sub-category |
| `requests.category_id` | derived (non-null), never client-supplied |
| `requests.priority` | `"urgent"` *(from the matched sub-category's own `sla_priority`, unaffected by anything in the draft/title)* |
| `requests.response_due_at` / `resolution_due_at` | both resolved (non-null) — SLA machinery ran normally |

---

## Regression Results

Commands run, in order, after all Stage 3.1 changes:

```
npx vitest run tests/unit/questionnaire-title.test.ts tests/unit/questionnaire-question-plan.test.ts tests/unit/questionnaire-review.test.ts tests/unit/questionnaire-adapter.test.ts tests/unit/questionnaire-answers.test.ts tests/unit/questionnaire-catalog-scoring.test.ts   (targeted, first)
npx vitest run tests/integration/stage3-1-title-contract.test.ts tests/integration/stage3-questionnaire-end-to-end.test.ts   (targeted, first)
npx vitest run   (full suite, four times total — see "Known Gaps" for why more than two were needed)
node node_modules/typescript/lib/tsc.js --noEmit
npm run lint
```

**Final full-suite result: 43 test files, 385 tests, 0 failures — two consecutive clean runs**, immediately back-to-back with no changes in between. This includes every pre-existing Stage 1/1.1/2/3 suite (`whatsapp-stage1-create-request-core`, `stage1-1-create-request-core-security`, `stage1-1-intake-review-fixes`, `mobile-normalization`, `stage2-mobile-identity`, `desk-uat-001-reopen`, `d03`/`d04`/`d06`/`d07`/`d09`/`d12`/`d16`/`d17`, `item6-assignment-rbac`, `stage3-questionnaire-catalog-security`) alongside the corrected Stage 3.1 tests.

**`tsc --noEmit`: clean, zero errors.**

**`npm run lint`: 0 errors, 3 pre-existing warnings, all in files untouched by this stage** (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx`).

---

## Files Changed

**Modified:**
- `lib/requests/create-request-core.ts` — added `titleOverride` param, `sanitizeTrustedTitle()`, `MAX_TRUSTED_TITLE_LENGTH`; one-line change to the final `title` computation. No other line touched.
- `lib/requests/questionnaire/types.ts` — added `RequestDraft.title`; `createEmptyDraft()` initializes it to `null`; `RequestReviewModel.generatedTitle` renamed to `title` with an updated doc comment; `QuestionPlanItem`'s doc comment corrected (no longer references description-satisfies-textarea).
- `lib/requests/questionnaire/question-plan.ts` — removed `findDescriptionField()` and `applyDescriptionToAnswers()`; updated the `buildQuestionPlan()` doc comment to state the new independence invariant explicitly.
- `lib/requests/questionnaire/title.ts` — rewrote the deterministic fallback (`extractPhraseFromDescription()`, `toTitleCase()`, new constants); `generateRequestTitle()`'s public signature and AI-hook behavior unchanged.
- `lib/requests/questionnaire/review.ts` — `buildReviewModel()` no longer takes a `generatedTitle` param; reads `draft.title` directly; doc comments updated.
- `lib/requests/questionnaire/adapter.ts` — rewrote the mapping logic: `description`/`titleOverride`/`formData` now map independently with no cross-field logic; removed the now-unused `resolveDraftFormFields`/`findDescriptionField` imports.
- `tests/integration/stage1-1-intake-review-fixes.test.ts` — untouched this stage (already corrected in Stage 3 for the Step 11 validation fix — no further change needed).
- `tests/integration/stage3-questionnaire-catalog-security.test.ts` — one infrastructure-only fix to its cleanup (see "Known Gaps"); no functional/assertion change.
- `tests/unit/questionnaire-question-plan.test.ts`, `tests/unit/questionnaire-review.test.ts`, `tests/unit/questionnaire-adapter.test.ts`, `tests/unit/questionnaire-title.test.ts` — updated per "Tests Added / Updated" above.
- `tests/integration/stage3-questionnaire-end-to-end.test.ts` — rewritten in full.

**New:**
- `tests/integration/stage3-1-title-contract.test.ts`.

No file outside `lib/requests/`, `tests/unit/`, and `tests/integration/` was touched. No UI/route/component was added or modified. `lib/actions/requests.ts` (web) and `lib/actions/intake/work.ts` (Email Intake) were **not modified** — confirmed via `git diff`.

---

## Migrations Added

**None.** `requests.title` and `requests.description` already exist (plain `TEXT` columns, confirmed via `supabase/migrations/20240101000000_initial_schema.sql`). No schema change was necessary or made.

---

## Known Gaps

**1. Pre-existing test-fixture cleanup gap (discovered during this stage's regression work, NOT caused by Stage 3.1):**

A `seed_org_sla_config` trigger (migration `20240101000048_per_org_sla_config.sql`) auto-populates a `global_sla_config` row for every new `organizations` row. `global_sla_config_org_id_fkey` has `ON DELETE NO ACTION` (not cascade), so any test fixture that creates a second "Org B" for cross-tenant testing and doesn't explicitly delete its `global_sla_config` row first will fail to delete that org in cleanup — every time, silently (the error is swallowed unless a caller checks it).

This affects **every pre-existing "Org B" fixture in the suite**: `stage1-1-create-request-core-security.test.ts`, `stage1-1-intake-review-fixes.test.ts`, and `stage2-mobile-identity.test.ts` (confirmed by direct observation — their orgs reliably remain in the `organizations` table after their own test run completes, going back at least to when Stage 1.1 was written). It also affected the two new Stage 3-era files this investigation touched (`stage3-questionnaire-catalog-security.test.ts` and the new `stage3-1-title-contract.test.ts`) — **both were fixed as part of this stage's regression work** (small, safe, test-only cleanup additions).

The accumulation is more than cosmetic: `handle_new_user()` (migration `20240101000088_fix_handle_new_user_org_id.sql`) assigns every newly-created test user's profile to `(SELECT id FROM organizations LIMIT 1)` — an **unordered** query. Once enough stray orgs accumulate, Postgres can return a stray test org instead of the real seeded org for that `LIMIT 1`, at which point **every subsequently-created test user in that run lands in the wrong org**, and `createRequestCore()`'s own (correct, intentional) `requesterId`/`org_id` cross-check then legitimately rejects it as `"Requester not found."` — cascading into dozens of unrelated test failures across the whole suite that have nothing to do with whatever code is actually being tested. This was observed directly during this stage's own regression work (a full-suite run went from 0 to 55 failures purely from accumulated stray orgs, then back to 0 after a manual purge).

**What was NOT done, and why:** the brief for this stage explicitly says *"NO DATABASE MIGRATION... If you believe a migration is necessary: STOP and explain why. Do not add one automatically."* A real fix (either making `handle_new_user()`'s org lookup deterministic, e.g. `ORDER BY created_at ASC LIMIT 1`, or changing `global_sla_config_org_id_fkey` to cascade) would require a migration, so none was made. The three affected pre-existing test files (`stage1-1-create-request-core-security.test.ts`, `stage1-1-intake-review-fixes.test.ts`, `stage2-mobile-identity.test.ts`) were also left unmodified — fixing their cleanup is a legitimate, low-risk follow-up, but is outside a "Description & Subject/Title Contract Correction" stage's scope.

**Recommendation for a future stage:** either (a) a small migration making `handle_new_user()`'s org lookup deterministic (lowest-risk fix, addresses the actual symptom regardless of which fixture leaks), and/or (b) an audit pass adding the missing `global_sla_config` cleanup to the three files named above. Until one of these lands, a full-suite run has a real, nonzero chance of spurious cross-file failures if enough test runs have accumulated stray orgs since the last manual cleanup — this is a pre-existing condition, not something introduced by Stage 3 or 3.1.

**2. No other gaps identified.** The questionnaire engine's architecture from Stage 3 was not redesigned; only the two named contracts were corrected.

---

## Stage 4 Readiness

**READY FOR STAGE 4: NO.**

Per the brief's stop condition: this report is for review. No conversation-persistence work, no Meta/WhatsApp Cloud API code, and no Stage 4 design has been started. Confirmed via grep of every file touched this stage: no new table, no `whatsapp_sessions`/`whatsapp_conversations`-style schema, no webhook/token/`phone_number_id`/`wamid`/template code anywhere.

---

## Acceptance Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Description is a first-class draft property | ✅ `RequestDraft.description` (already existed in Stage 3; contract corrected) |
| 2 | Description always maps to `requests.description` | ✅ `adapter.ts` — unconditional |
| 3 | Description never auto-satisfies arbitrary textarea fields | ✅ `findDescriptionField`/`applyDescriptionToAnswers` removed; TEST 1/2/12 |
| 4 | Mandatory textarea fields remain independently required | ✅ TEST 1/2/12 |
| 5 | Title is a first-class draft property | ✅ `RequestDraft.title` (new) |
| 6 | Generated title shown at Review is persisted to `requests.title` | ✅ `titleOverride`; TEST 5, end-to-end proof |
| 7 | AI failure cannot block title generation | ✅ unchanged from Stage 3; TEST 9/10 |
| 8 | Deterministic title is description-focused | ✅ `extractPhraseFromDescription()`; TEST 11 |
| 9 | Existing `createRequestCore()` callers remain backward compatible | ✅ TEST 7; full Web/Email Intake regression green |
| 10 | Questionnaire adapter uses no `priorityOverride` | ✅ unchanged |
| 11 | Questionnaire adapter uses no `teamIdOverride` | ✅ unchanged |
| 12 | No direct `requests` INSERT | ✅ unchanged — adapter only builds params |
| 13 | No conversation persistence | ✅ confirmed via grep |
| 14 | No WhatsApp/Meta code | ✅ confirmed via grep |
| 15 | Full test suite green | ✅ 43 files / 384 tests, two consecutive clean runs |
| 16 | TypeScript clean | ✅ |
| 17 | ESLint clean (no new errors/warnings) | ✅ |
| 18 | `STAGE_3_1_REPORT.md` created | ✅ this document |
