# STAGE 3 REPORT — Channel-Neutral Service/Issue Discovery & Dynamic Ticket Questionnaire Engine

## 0. Scope recap

Stage 3 builds a **channel-neutral** ticket draft/questionnaire engine — explicitly not named after any channel — that will let a future conversational channel (WhatsApp first) walk a requester through: Service → issue-keyword search over Sub-categories → Sub-category selection (server-revalidated) → auto-derived Category → Description → auto-generated Subject/Title → remaining mandatory fields → Review → a `createRequestCore()`-compatible payload. **No ticket is auto-created by this engine, no conversation state is persisted, and no Meta/WhatsApp Cloud API code exists anywhere in this stage.** DESK remains the sole source of truth for priority, SLA, assignment, taxonomy, and Business Rules.

---

## 1. Step 0 — Audit findings (before any code was written)

All findings below come from direct inspection of the current repository, not from the earlier discovery document (which the Stage 3 brief explicitly warned may be stale).

| # | Finding | Detail |
|---|---|---|
| 1 | `createRequestCore()` (`lib/requests/create-request-core.ts`) | Service query filters `is_active=true` only, **not** `status` — catalog browsing (`getAllowedStatuses()`) additionally restricts self-serve requesters to `status='published'`. The questionnaire engine's own service listing must apply BOTH filters explicitly (see §3). |
| 2 | `lib/validation/formFields.ts` | Confirmed **zero** option-membership validation existed for `select`/`radio`/`multiselect` before this stage — any string (or array of strings) was silently accepted. This was already documented as a known gap by a tripwire test in `tests/integration/stage1-1-intake-review-fixes.test.ts`. Fixed in §5 below. |
| 3 | `lib/queries/services.ts` | Every catalog query (`getServices`, `searchServices`, `getAllowedSubCategoriesForService`, …) uses the RLS-scoped `createClient()` internally and `getCurrentProfile()` (session-bound). None are reusable for a channel with no browser session — new, explicitly org-scoped, injectable-client functions were required (`lib/requests/questionnaire/catalog.ts`). `searchServices()`'s `ilike`-based matching was used as the existing precedent for "how this codebase already does simple text search" (no FTS/trigram index exists on any catalog table). |
| 4 | `service_categories` / `service_sub_categories` schema | Confirmed via `types/database.ts`: `service_sub_categories` has **no** `org_id` and **no** `keywords` column — org identity is only reachable via `category_id → service_categories.org_id`. Sub-category search must therefore be scoped by an already org-validated `service_id` (via `service_sub_category_tags`, which is unique per sub-category — see finding 6), matching `createRequestCore()`'s own trusted pattern. |
| 5 | `components/forms/FieldRenderer.tsx` | Confirmed the exact field-type → rendering map. `checkbox` is always rendered as a plain boolean (never with options). **`toggle` is a real `FormFieldType` that the web renderer does not handle at all** (`default: return null`) — a pre-existing platform gap, unrelated to Stage 3, but relevant to how this engine should treat that type (see §6/`answers.ts`: modeled with the same boolean semantics as `checkbox`). |
| 6 | `service_sub_category_tags` | Re-confirmed the `UNIQUE(sub_category_id)` exclusivity constraint (a sub-category can be tagged to at most one service) — this is why scoping a sub-category search/selection by `service_id` alone (after that service is itself org-validated) is inherently org-safe, the same trust boundary `createRequestCore()` already relies on. |
| 7 | `components/ui/searchable-select.tsx` | The only "search" precedent in the UI layer — a pure client-side substring `.includes()` filter over an already-fetched, already-active-filtered flat option list (via `lib/forms/options.ts`'s `filterActiveOptions`/`flattenLeafOptions`). No server-side search or ranking precedent exists anywhere; confirms the deterministic keyword scorer built for Step 3 (§3) is new, not a duplicate of something already there. |
| 8 | `lib/forms/options.ts` | Existing utility with `filterActiveOptions()` (recursive, strips archived options) and `flattenLeafOptions()` (flattens a nested option tree to active leaves). Identified as the correct reuse target for Step 11's option-membership check — extended (not duplicated) with a new `flattenAllLeafOptions()` (see §5). |
| 9 | AI/LLM provider dependency | Root `package.json` (the Next.js app) has **no** AI/LLM SDK dependency. `@anthropic-ai/sdk` exists only in `api/package.json`, a separate microservice, not something this engine can assume is available. Confirms Step 7's "AI optional, deterministic fallback mandatory" design is not just a safety rule but the **only** path actually wired up today (see §7). |
| 10 | `lib/requests/validate-requester-form-completion.ts` | Already accepts a `treatFileFieldsAsSatisfied` flag, with a doc comment explicitly anticipating "WhatsApp's attachment stage… once it has real attachment-presence data to check against; nothing today does." Confirms the correct, already-designed-for answer for Step 13 is to call it in **strict mode** (see §9) rather than build a new completion gate. |

No further schema changes, no new tables, no new migrations were needed or added at the audit stage.

---

## 2. Design decisions

### 2.1 File layout

```
lib/requests/
  resolve-sub-category.ts        — NEW shared helper (see §2.3)
  create-request-core.ts         — MODIFIED (behavior-preserving refactor, see §2.3)
  questionnaire/
    types.ts                     — RequestDraft + all shared types (no logic)
    catalog.ts                   — Step 2 (services) + Step 3 (sub-category search), I/O, org-scoped
    subcategory.ts                — Step 4/5 (revalidate + derive category), I/O, org-scoped
    title.ts                     — Step 7 (subject generation), pure
    question-plan.ts             — Step 8/9/10 (form resolution, description mapping, question plan), pure
    answers.ts                   — Step 12 (answer normalization/validation), pure
    review.ts                    — Step 14/15 (readiness + Review model), pure
    adapter.ts                   — Step 16 (createRequestCore() adapter), pure
    index.ts                     — barrel export
```

Named `RequestDraft`/`lib/requests/questionnaire/` — deliberately not WhatsApp-specific, per the brief.

Every function that performs I/O (`catalog.ts`, `subcategory.ts`) takes an **injectable `client`**, mirroring `createRequestCore()`'s own pattern exactly, so it is safe to call with the admin (service-role) client from a future webhook handler with no browser session. Every other module (`title.ts`, `question-plan.ts`, `answers.ts`, `review.ts`, `adapter.ts`) is **pure** — no I/O, no client parameter — for direct, mock-free unit testing (Step 19).

### 2.2 The `RequestDraft` model (Step 1)

```ts
type RequestDraft = {
  orgId: string
  requesterId: string
  serviceId: string | null
  subCategoryId: string | null   // server-revalidated, never trusted raw
  categoryId: string | null      // ALWAYS derived, never settable directly
  description: string | null     // collected verbatim
  answers: Record<string, unknown> // fieldId -> value; same shape as createRequestCore()'s formData
}
```

Purely an in-memory accumulator type. **Nothing in this stage persists it anywhere** — no new table, no `whatsapp_sessions`, no session store. A caller (a future webhook handler) owns wherever it keeps this for the lifetime of one conversation.

### 2.3 Reuse over duplication: extracting `resolveSubCategoryForService()`

The brief for Step 4 explicitly asked to "reuse `createRequestCore()`'s association semantics rather than duplicating them." `createRequestCore()`'s own sub-category validation (tag lookup + category derivation) was ~15 lines inline. Rather than copy those lines into the questionnaire engine (which the brief's general "no drift" principle argues against), they were extracted into a new shared helper:

**`lib/requests/resolve-sub-category.ts`** — `resolveSubCategoryForService({ client, serviceId, subCategoryId })`, returning `{ ok, subCategoryId, categoryId, slaPriority }` or `{ ok: false, error }`, with **byte-identical error messages** (`'Category is required.'` / `'Selected category is not valid for this service.'`) to what `createRequestCore()` returned before this change.

`createRequestCore()` was then edited to call this helper instead of its own inline block — a **behavior-preserving refactor**, not a new capability. This is the only change made to already-shipped Stage 1/1.1 code this stage. Verified via:
- The full pre-existing Stage 1/1.1/1.1-security suites re-run unchanged and green (§10).
- A `git diff` review of `create-request-core.ts` (below) showing the replacement is a pure extraction — identical query, identical filter logic, identical returned values feeding the same downstream priority-derivation line.

`lib/requests/questionnaire/subcategory.ts`'s `selectSubCategoryForDraft()` calls the exact same helper, adding one extra defense-in-depth check (the service itself belongs to `orgId` and is active) before calling it — necessary because, unlike inside `createRequestCore()`, nothing upstream in the questionnaire engine has already validated `serviceId` by the time sub-category selection could be called in isolation.

### 2.4 Description ↔ form-field mapping (Step 9)

The brief separates "Description collection" (Step 6, freeform) from "remaining requester-settable mandatory fields" (Step 10), but a description ultimately has to land somewhere `createRequestCore()` understands. The chosen, **deterministic, type-based (never label-guessed)** rule, mirroring `createRequestCore()`'s own existing title-derivation precedent (which already picks "the" `textarea` field by type, not by label):

- If the resolved form has a `textarea` field, the collected description is written into `answers[textareaField.id]`. This both satisfies that field (Step 9's "already-satisfied" detection) and lets `createRequestCore()`'s own title derivation pick it up naturally — no change to `createRequestCore()` was needed or made.
- If the form has **no** `textarea` field, the description is instead carried through `createRequestCore()`'s existing `description` passthrough parameter — the exact mechanism Email Intake already uses for services with no matching field structure. No second description-carrying path was invented.

`lib/requests/questionnaire/question-plan.ts`'s `findDescriptionField()`/`applyDescriptionToAnswers()` implement the mapping; `adapter.ts`'s `buildCreateRequestInputFromDraft()` applies the same rule again as a safety net at build time (idempotent — a no-op if the caller already applied it earlier in the conversation).

### 2.5 Why `generateRequestTitle()` never needs a `createRequestCore()` title param

`createRequestCore()` has **no title-override parameter** — it always derives `requests.title` itself from `formData` (text → textarea → select/radio → multiselect priority, prefixed with the service name). Rather than add one (out of scope — the brief never asked for a `createRequestCore()` signature change, and doing so would create a second, parallel title-writing path), Step 7's `generateRequestTitle()` is used two ways, neither touching `createRequestCore()`:

1. It powers the **Review model**'s `generatedTitle` field, so a conversational UI can show the requester "I'll title this: …" before creation.
2. If the resolved form happens to have a `text`-type field (which `createRequestCore()`'s own derivation prioritizes **above** `textarea`), a caller may choose to write the generated title into that field's answer — at which point `createRequestCore()`'s existing, unmodified derivation naturally uses it as the stored title, with zero adapter hack.

When no `text` field exists, `createRequestCore()`'s own fallback (the `textarea`/select/multiselect-derived title) governs the stored `requests.title`, identically to every other channel today. This was a deliberate choice to avoid inventing a second title-writing path or touching Stage 1's tested creation logic.

### 2.6 Required file fields (Step 13) — honesty over faking

This engine has no attachment-transport mechanism (no Meta/WhatsApp code exists at all in this stage — see §11). A required `file` field therefore:
- **Is surfaced** in `buildQuestionPlan()`'s output (not silently skipped) — a caller needs to know one exists.
- **Can never be answered** — `applyQuestionAnswer()` explicitly rejects `field.type === 'file'` with an error, rather than accepting any fake value.
- **Correctly blocks readiness** — `checkDraftReadiness()` calls `validateRequesterFormCompletion()` with `treatFileFieldsAsSatisfied: false` (strict mode — a flag that already existed, added in Stage 1C specifically anticipating this exact case), so a draft for a service with a required file field can never be reported "ready" by this engine. This is the correct, honest outcome per the brief ("must not fake-satisfy… no early ticket creation"), not a bug to fix later — a future stage that adds real attachment handling will set a real presence value in `answers[fileField.id]`, and readiness will naturally flip once that exists, with no change needed here.

### 2.7 `phone` field vs. Stage 2 mobile identity — deliberately never conflated

`applyQuestionAnswer()`'s `phone`-type handling is pure trim-and-validate of whatever the requester typed into that ticket-form field. It never reads `profiles.mobile_number` or calls `resolveUserByWhatsAppNumber()`. The two concepts are unrelated: Stage 2's mobile identity is *how a WhatsApp sender number resolves to a DESK user*; a ticket-form `phone` field is ordinary, independent, per-ticket requester input, exactly as on the web form today.

---

## 3. Steps 2–3 — Service listing & issue-keyword sub-category search

`lib/requests/questionnaire/catalog.ts`:

- **`listQuestionnaireServices({ client, orgId, requesterLocationId? })`** — explicitly filters `org_id`, `is_active=true`, `status='published'` (self-serve only — this channel is always a requester raising their own ticket, never an admin/manager browsing draft services, so no role parameter exists to accidentally widen it), then reimplements `filterServicesByLocation()`'s exact rule (no tags = visible to all; tagged = only to a requester at a tagged location) against an explicit `requesterLocationId` instead of a session-bound profile lookup.
- **`scoreSubCategoryMatch(query, name)`** — pure, deterministic keyword scorer (exact match highest, then prefix, then substring, then proportional word overlap). No AI/embeddings, per the brief.
- **`searchSubCategories({ client, orgId, serviceId, query, limit? })`** — re-validates `serviceId` belongs to `orgId` and is active (defense-in-depth), then scores only that service's tagged, active sub-categories. An empty query returns the full tagged list alphabetically (for a "pick one" UI before any typing); a non-matching query returns an empty array — a plain, structured zero-results state, with phrasing left to the caller.

---

## 4. Steps 4–5 — Sub-category revalidation & category derivation

`lib/requests/questionnaire/subcategory.ts`'s `selectSubCategoryForDraft()` — see §2.3. Category is only ever returned as a derived value; nothing in this engine accepts a category id as input.

---

## 5. Step 11 — Shared validation hardening (`validateFieldValue()`)

`lib/validation/formFields.ts` now rejects a `select`/`radio` value, or any `multiselect` entry, that is not one of the field's configured options — using a new `flattenAllLeafOptions()` added to `lib/forms/options.ts` (deliberately **not** reusing the existing `flattenLeafOptions()`, which drops archived options — a previously-submitted value against a now-archived option must keep validating forever, the same guarantee the codebase already makes for *displaying* an archived option's label). The check is skipped entirely when a field has no `options` configured, so nothing with missing metadata is newly broken. `checkbox`/`toggle` are explicitly excluded — confirmed boolean-only semantics (audit finding 5).

This is shared by **every** channel (web form, Email Intake reviewer conversion, technician edits, and now the questionnaire engine), so it closes the gap everywhere at once. The pre-existing tripwire test in `tests/integration/stage1-1-intake-review-fixes.test.ts` (which documented the old, permissive behavior on purpose, exactly anticipating this stage) was updated to assert the new rejection instead — this is the one behavioral change to an existing test in this stage, and it is a direct, expected consequence of the hardening the brief asked for, not an unrelated edit.

12 new unit tests (`tests/unit/form-field-option-membership.test.ts`) plus 3 for the new `flattenAllLeafOptions()` helper (`tests/unit/form-options-flatten-all.test.ts`) cover: rejection, acceptance, archived-value acceptance, nested/grouped options, fields with no options configured, and the checkbox/toggle exclusion.

---

## 6. Steps 8–10 — Form resolution, satisfied fields, question plan

`lib/requests/questionnaire/question-plan.ts`:
- **`resolveDraftFormFields(service)`** — thin wrapper over `resolveServiceFormSections()` (Step 8's explicit "no second schema interpreter" requirement).
- **`findDescriptionField()` / `applyDescriptionToAnswers()`** — Step 9, see §2.4.
- **`buildQuestionPlan(allFields, answers)`** — every requester-mandatory field (excluding `store_address`, which is always system-populated) in resolved order, each flagged `alreadyAnswered`. Optional fields are never included — they never block progression, per the brief.
- **`getNextQuestion()`** — the first unanswered item, or `null` once the plan is satisfied.

---

## 7. Step 7 — Subject/Title generation

`lib/requests/questionnaire/title.ts`'s `generateRequestTitle()` — mandatory deterministic fallback (prefers the sub-category name, then a truncated description, then the bare service name), with a strictly optional `aiProvider` hook that:
- Is raced against a 3-second timeout.
- Falls back on rejection, empty/whitespace-only output, or timeout — **never throws, never blocks**.

Per audit finding 9, nothing in the root app wires a default AI provider today, so in practice this always takes the deterministic path — documented rather than silently assumed.

---

## 8. Step 12 — Answer processing

`lib/requests/questionnaire/answers.ts`'s `applyQuestionAnswer()` — type-specific normalization (trim text, coerce numbers, "yes"/"no" → boolean for `checkbox`/`toggle`, wrap a lone `multiselect` value into an array) followed by the **exact same** `validateFieldValue()` every other channel uses (including the Step 11 hardening). Explicitly rejects `file` (§2.6) and `store_address` (system-populated) answers rather than accepting anything for them.

---

## 9. Steps 14–15 — Readiness & Review model

`lib/requests/questionnaire/review.ts`:
- **`checkDraftReadiness()`** — wraps `validateRequesterFormCompletion()` in **strict file mode** (§2.6), the single authoritative completion gate, not a duplicate ruleset.
- **`buildReviewModel()`** — requester-safe only: excludes technician-only (`requester_can_view === false`) fields even if they somehow hold a value, and excludes `store_address` (never something the requester answered). Formats `select`/`radio`/`multiselect` values as their configured labels (via `flattenLeafOptions()`) and `checkbox`/`toggle` as Yes/No. Pure — takes an already-computed `generatedTitle` and `subCategoryName` rather than doing its own I/O.

---

## 10. Step 16 — `createRequestCore()` adapter

`lib/requests/questionnaire/adapter.ts`'s `buildCreateRequestInputFromDraft()` — pure, builds a `createRequestCore()`-compatible params object (minus `client`, supplied by the caller):
- `actingUserId = requesterId` always (self-serve — never "on behalf of").
- `useAdminForWrites: true` always (no browser session on this channel).
- **Never sets `priorityOverride` or `teamIdOverride`** — an unreviewed self-serve draft goes through DESK's own priority/SLA/team derivation exactly like a normal web submission; those two parameters stay reserved for Email Intake's human-reviewed path, per the brief's explicit prohibition.
- Applies the description-mapping rule from §2.4.

Does **no** direct DB insert — the caller passes `input` straight into the real, unmodified `createRequestCore()`.

## Step 17 — End-to-end proof (optional, included)

`tests/integration/stage3-questionnaire-end-to-end.test.ts` chains every step above — real Postgres, admin client, no mocked business logic — and feeds the adapter's output into the actual `createRequestCore()`. Confirms: priority comes from the matched sub-category's own `sla_priority` (never anything the draft set directly), category is derived, SLA deadlines are resolved (`response_due_at`/`resolution_due_at` non-null — proving Business Rules/SLA machinery ran normally), the description landed in the textarea field and drove `createRequestCore()`'s own title, and the `description` passthrough stayed unset (since a textarea field existed). No production auto-submit code was added — this test is the only place these steps are chained together.

---

## 11. Steps 20–21 — No persistence, no Meta/WhatsApp code

- **No new tables, no migrations.** `git status` on `supabase/migrations/` shows no new file from this session (see command output retained in session history). Grep of all new/changed files for `CREATE TABLE`/`whatsapp_sessions`/`whatsapp_conversations`: none.
- **No Meta/WhatsApp Cloud API code anywhere** — no webhook route, no token handling, no `phone_number_id`, no `wamid`, no template/button payloads. Grep across `lib/requests/questionnaire/` for `whatsapp|meta|wamid|phone_number_id|webhook` (case-insensitive, excluding this report's own prose and doc-comment cross-references to "a future WhatsApp channel"): no functional code matches.

**Migrations Added: None.** No migration was necessary for this stage.

---

## 12. Step 18 — Security test matrix

`tests/integration/stage3-questionnaire-catalog-security.test.ts` — 18 tests, real Postgres, admin (service-role) client throughout (the shape a webhook handler would use, RLS bypassed):

| Function | Cases covered |
|---|---|
| `listQuestionnaireServices()` | never returns another org's services; excludes non-published (draft/review) services; excludes inactive services; excludes a location-restricted service the requester isn't at; includes it when they are; an org with no services returns `[]` not an error |
| `searchSubCategories()` | never returns another service's (org B's) sub-categories even when queried; cross-org mismatch (serviceId belongs to org B, orgId passed is org A) returns empty, not org B's data; excludes archived sub-categories; empty query returns the full tagged/active list; keyword search returns the relevant match and excludes unrelated ones; nonsense query returns `[]`; an inactive service returns `[]` |
| `selectSubCategoryForDraft()` | accepts a correctly-tagged sub-category and derives its category; rejects a sub-category tagged to a **different** service (org B's) even when `orgId`/`serviceId` are org A's own; rejects when `serviceId` belongs to a different org than `orgId`; rejects an inactive service; documents (does not falsely assert rejection of) the intentional split where an archived-but-still-tagged sub-category id remains a valid *selection* even though `searchSubCategories()` hides it from new discovery |

All 18 pass. Combined with the pre-existing Stage 1.1 cross-tenant suite (still green, unmodified) and the refactor in §2.3 being behavior-preserving, `createRequestCore()`'s own security posture is unchanged.

---

## 13. Step 19 — Pure unit test list

66 new unit tests across 8 files, all pure (no DB, no mocks beyond a fake AI-provider function in `title.ts`'s tests):

- `tests/unit/form-field-option-membership.test.ts` (12) — Step 11 hardening
- `tests/unit/form-options-flatten-all.test.ts` (3) — new `flattenAllLeafOptions()`
- `tests/unit/questionnaire-catalog-scoring.test.ts` (7) — `scoreSubCategoryMatch()`
- `tests/unit/questionnaire-title.test.ts` (8) — `generateRequestTitle()`, including the fake-timer-driven AI-timeout case
- `tests/unit/questionnaire-question-plan.test.ts` (13) — form resolution, description mapping, question plan
- `tests/unit/questionnaire-answers.test.ts` (11) — `applyQuestionAnswer()`
- `tests/unit/questionnaire-review.test.ts` (6) — readiness + Review model
- `tests/unit/questionnaire-adapter.test.ts` (6) — the `createRequestCore()` adapter

---

## 14. Step 22 — Full regression

Commands run, in order:

```
npx vitest run tests/unit/*.test.ts tests/unit/*.test.tsx   (new files individually, first pass)
npx vitest run tests/integration/whatsapp-stage1-create-request-core.test.ts \
  tests/integration/stage1-1-create-request-core-security.test.ts \
  tests/integration/stage1-1-intake-review-fixes.test.ts    (Stage 1/1.1 regression, targeted)
npx vitest run tests/integration/stage3-questionnaire-catalog-security.test.ts
npx vitest run tests/integration/stage3-questionnaire-end-to-end.test.ts
npx vitest run                                               (full suite, twice)
node node_modules/typescript/lib/tsc.js --noEmit
npm run lint
```

**Full suite results: 42 test files, 369 tests, 0 failures — two consecutive clean runs.** This includes every Stage 1, 1.1, and 2 suite (`whatsapp-stage1-create-request-core`, `stage1-1-create-request-core-security`, `stage1-1-intake-review-fixes`, `mobile-normalization`, `stage2-mobile-identity` [covered by the full-suite run], `desk-uat-001-reopen`, `d03`/`d04`/`d06`/`d07`/`d09`/`d12`/`d16`/`d17`, `item6-assignment-rbac`, and all pre-existing unit tests) alongside the 84 new Stage 3 tests (66 unit + 18 security + 1 end-to-end, with the intake-review-fixes suite's option-membership test updated in place).

**`tsc --noEmit`: clean, zero errors.**

**`npm run lint` (the project's actual lint script — `app lib components types proxy.ts`): 0 errors, 3 pre-existing warnings, all in files untouched by this stage** (`components/projects/NewMilestonePanel.tsx`, `components/projects/NewProjectPanel.tsx`, `components/requests/RequestActionBar.tsx`). All new/modified files individually linted clean (0 errors, 0 warnings) before the full-repo pass.

---

## 15. Final diff review

**Modified (2 pre-existing tracked files):**
- `lib/forms/options.ts` — additive only (`flattenAllLeafOptions()`), no existing export changed.
- `lib/validation/formFields.ts` — additive option-membership check block + one new import; no existing branch's behavior changed for any value that was already valid.

**Modified (1 pre-existing untracked-but-prior-stage file):**
- `lib/requests/create-request-core.ts` — behavior-preserving extraction (§2.3); no new parameters, no changed return shape, no changed error strings.
- `tests/integration/stage1-1-intake-review-fixes.test.ts` — one test updated from documenting-a-gap to asserting-the-fix, per §5.

**New (11 implementation files under `lib/requests/`):**
`resolve-sub-category.ts`, `questionnaire/{types,catalog,subcategory,title,question-plan,answers,review,adapter,index}.ts`.

**New (10 test files):** 8 unit test files + 2 integration test files, listed in §12/§13.

No file outside `lib/requests/`, `lib/forms/options.ts`, `lib/validation/formFields.ts`, and `tests/` was touched. No UI/route/component was added or modified — this stage is intentionally headless (no page consumes this engine yet; a future WhatsApp webhook, and eventually a self-serve web wizard, would be the first callers).

---

## 16. Acceptance criteria

| # | Requirement | Status |
|---|---|---|
| AC-3.1 | Engine and every module named channel-neutrally (no "WhatsApp" anywhere in code) | ✅ `lib/requests/questionnaire/`, `RequestDraft` |
| AC-3.2 | Service listing, org/active/status/location-scoped, no RLS reliance | ✅ §3 |
| AC-3.3 | Deterministic issue-keyword search over Sub-categories scoped to the selected Service | ✅ §3 |
| AC-3.4 | Sub-category selection server-revalidated | ✅ §4/§2.3 |
| AC-3.5 | Category always derived, never client-supplied | ✅ §4 |
| AC-3.6 | Description collected and stored verbatim, never AI-summarized | ✅ §2.4 — raw string only, no rewriting anywhere in the pipeline |
| AC-3.7 | Subject/Title: deterministic fallback mandatory, AI optional and non-blocking | ✅ §7 |
| AC-3.8 | Reuses `resolveServiceFormSections()` — no second schema interpreter | ✅ §6 |
| AC-3.9 | Already-satisfied fields determined via a documented, type-based (not label-guessed) mapping | ✅ §2.4/§6 |
| AC-3.10 | Question plan: requester-mandatory only, optional fields never block | ✅ §6 |
| AC-3.11 | `validateFieldValue()` hardened for option membership; checkbox semantics inspected, not assumed; full regression | ✅ §5/§14 |
| AC-3.12 | Answers validated via shared DESK validation; ticket `phone` ≠ Stage 2 mobile identity | ✅ §8/§2.7 |
| AC-3.13 | Required files modeled honestly as pending; no fake data, no dummy attachments, no early creation | ✅ §2.6 |
| AC-3.14 | Requester-safe Review model, reusing `validateRequesterFormCompletion()` | ✅ §9 |
| AC-3.15 | `createRequestCore()`-compatible adapter; no `priorityOverride`/`teamIdOverride`; no direct inserts | ✅ §10 |
| AC-3.16 | No persistence tables added; zero Meta/WhatsApp Cloud API code | ✅ §11 |

---

## 17. READY FOR STAGE 4: **NO**

Per the brief's own final instruction: this report is a stopping point for the user's review, not a request to proceed. **No Stage 4 work, and no Meta/WhatsApp Cloud API integration, has been started or will be started until explicitly authorized.**
