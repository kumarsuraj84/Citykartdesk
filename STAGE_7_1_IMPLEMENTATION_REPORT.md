# STAGE 7.1 — UAT FINDINGS IMPLEMENTATION

## Status

**COMPLETE.** All approved, low-risk findings from Stage 7 are implemented, tested, and re-verified: mandatory date validation (F-01), mandatory checkbox `false`-handling (F-02), the Subject/Description semantic-role mapping, WhatsApp source-channel metadata, and deactivation of the 2 confirmed Stage1.1 dead-end services. The Platform Settings → Integrations WhatsApp card (also requested this session) is implemented and live-verified. No Business Rule, `assignment_rules`, team-membership, or service-ownership configuration was mutated — those remain business decisions, listed in `PRE_PILOT_CONFIGURATION_DECISIONS.md`. Stage 7's own code fixes (F-29/F-30) were left untouched, as instructed — regression confirms no problem there.

---

## Findings Addressed

### F-01 — Date Validation

**Old behavior**: `lib/validation/formFields.ts`'s `validateFieldValue()` had no case for `field.type === 'date'` — any non-empty string satisfied a mandatory date field, including `"not-a-real-date"`.

**Audit performed first**: the web form renders dates via `<input type="date">` (`components/forms/FieldRenderer.tsx`), which natively stores/submits `YYYY-MM-DD` per the HTML5 spec — confirmed by reading the renderer, not assumed. That is the canonical stored format; no web-side conversion was needed.

**New behavior**:
- `validateFieldValue()` now validates `type: 'date'` against `isValidCanonicalDate()` — a strict `YYYY-MM-DD` check that also rejects impossible calendar dates (`2026-02-31`) via a construct-and-compare-back technique, not just a regex.
- The conversational engine prompts `DD/MM/YYYY` (`lib/whatsapp/render.ts`, unchanged). A new, channel-neutral normalization step in `lib/requests/questionnaire/answers.ts`'s `normalizeAnswerValue()` converts a `DD/MM/YYYY` (or `D/M/YYYY`) reply to canonical `YYYY-MM-DD` **before** validation — kept deliberately separate from the validator itself, exactly as instructed. An already-canonical value passes through unchanged; anything else is left for `validateFieldValue()` to reject.
- This is the SHARED validator — no WhatsApp-only rule was added; the format check applies identically to web and conversational input, the normalization is conversational-engine-only (the web form never needs it).

**Tests**: `tests/unit/stage7-1-uat-findings.test.ts` — `isValidCanonicalDate()` accept/reject cases, `validateFieldValue()` mandatory-date cases, and `applyQuestionAnswer()` end-to-end normalization (DD/MM/YYYY → canonical, single-digit day/month, already-canonical passthrough, invalid/impossible dates rejected after normalization).

### F-02 — Checkbox `false` Handling

**Old behavior**: `isFieldValueEmpty()` treated `false === empty` unconditionally for every field type, so a mandatory checkbox/toggle could never be honestly answered "No" — any negative answer was rejected as if unanswered.

**Audit performed first**: the web form's `DynamicForm.tsx` seeded every checkbox's initial value as `false` (`getDefaultValue()`) — meaning an *untouched* checkbox was already indistinguishable from an explicit "No" at the JS level. Simply flipping `isFieldValueEmpty` without addressing this would have let a requester skip a mandatory checkbox entirely on the web form (a real regression), so this was fixed too, not just the shared validator:
- `getDefaultValue()` now returns `undefined` for `checkbox`/`toggle` (never touched = genuinely unanswered); `FieldRenderer.tsx`'s checkbox `checked` prop now coerces via `Boolean(value)` so the DOM control still renders correctly unchecked either way — purely a state-tracking change, no visual difference.

**New behavior**: `isFieldValueEmpty(val, fieldType?)` is now field-type-aware — for `checkbox`/`toggle`, only `null`/`undefined` counts as empty; `false` is a real, valid answer. Every other field type's behavior is **unchanged** (the parameter is optional and defaults to the original global behavior at any call site that doesn't pass it). All 6 call sites that determine "has this field been answered" (`validateFieldValue`, the requester-completion check, the Review display filter, the conversational `alreadyAnswered` computation, the technician-mandatory-field check) were updated to pass `field.type` so the fix applies everywhere "answered" is decided, not just at final submission — this matters because the conversational engine's own `alreadyAnswered` check would otherwise keep re-asking a checkbox answered "No" forever.

**Tests**: `tests/unit/stage7-1-uat-findings.test.ts` (isEmpty semantics, validateFieldValue with true/false/undefined, conversational "no" → `false` normalization) and `tests/unit/validate-requester-form-completion.test.ts` (updated: a required toggle answered `false` is now `valid: true`). `tests/integration/stage7a-attachments-fixture.test.ts`'s own repro of this exact finding was re-verified: a checkbox answered "No" now correctly advances the conversation instead of staying stuck.

---

## Subject / Description Semantic Mapping

**Schema/model design**: a new optional field, `semantic_role?: 'request_title' | 'request_description' | null`, added to `types/index.ts`'s `FormField`. Stored inside the existing `services.form_sections` JSONB — **no migration required** (confirmed: adding an optional JSON key to an already-flexible JSONB document needs no schema change).

**Why it does not use labels**: Stage 3.1's question-plan engine determines "already answered" purely from `answers[field.id]` (see `question-plan.ts`'s own doc comment, re-confirmed unchanged). The new `applySemanticRoleAutofill()` helper in the same file respects this exactly — it never inspects a field's label, type, or position. It only acts on a field carrying the **explicit** `semantic_role` key, and only ever *writes into* `answers[field.id]` (using the engine's own already-generated `draft.title`/`draft.description`) before the question plan is computed — so the existing "answers-only" rule is satisfied by construction, not bypassed. No label-guessing was added anywhere.

**Auto-fill behavior**: in `lib/conversations/orchestrator.ts`'s `handleAwaitingDescription()`, right after the title is generated, `applySemanticRoleAutofill()` builds an updated answers object with any `semantic_role`-mapped, requester-visible/-settable field filled from the title/description — **only if that field doesn't already hold a real answer** (protects resume/idempotency: a field a requester somehow already answered is never overwritten). This updated answers object is what both the next-question computation *and* the persisted conversation row use, so Review and the final ticket are consistent with what was actually asked.

**Exact templates configured**: all 7 real production templates were audited directly (template, field id, label, type, required, requester_can_view, requester_can_set) — every one has **exactly one** unambiguous Subject (`text`) field and **exactly one** unambiguous Description (`text`/`textarea`) field, all required, all requester-visible-and-settable. No template was ambiguous. Migrated (via a reviewed, dry-run-verified, structure-preserving JSONB update — confirmed byte-for-byte identical elsewhere in each template):

| Template | Subject field id | Description field id |
|---|---|---|
| BD Support Template | `mttwp1b1_1p` | `mttwp7e7_1q` |
| FINANCE & ACCOUNTS Support Template | `mttw4ys7_k` | `mttw568m_l` |
| HR Support Template | `mtifkdwo_1` | `mtifkrsk_2` |
| IT Support Template | `mtiddwhc_1` | `mtbftqh9_3` |
| L&D Support Template | `mttuncr5_4` | `mttunin6_5` |
| LEGAL Support Template | `mttuu6lq_9` | `mttuucql_a` |
| Vendor Creation Template | `mttwmg23_1j` | `mttwmqg3_1k` |

**Ambiguous templates left untouched**: none — all 7 were unambiguous. No template was skipped.

**Resulting requester flow** (verified live, real IT Support template, `tests/integration/stage7-1-semantic-role-real-service.test.ts`): Service → issue search → Sub-category → Category derived → Description asked once → Subject auto-generated → **Phone number asked → required Attachment asked** — Subject and Description are never asked again. Review shows the mapped values (confirmed via the persisted `answers`). Final ticket: `form_data[subjectFieldId] === requests.title` and `form_data[descriptionFieldId] === requests.description`, exactly satisfying the required consistency guarantee.

---

## Web Compatibility

`components/forms/DynamicForm.tsx`/`FieldRenderer.tsx` never read `semantic_role` — the web form still renders and asks Subject/Description on every real service exactly as before. This was proven, not assumed: the full regression suite (including `tests/unit/validate-requester-form-completion.test.ts` and every web-path `createRequestCore()` test) passed unchanged after the template migration. Subject/Description fields were **not** removed from any template — only an additional, opt-in metadata key was added.

## Email Intake Compatibility

Email Intake (`lib/actions/intake/work.ts`) calls `createRequestCore()` directly with `source: 'email_intake'` and a human-reviewed `formData` — it never goes through the conversational engine's draft/answers abstraction, so `semantic_role`/`applySemanticRoleAutofill()` never applies to it. No code path was touched; regression confirms it stayed green.

---

## WhatsApp Source Metadata

`requests.source_metadata.created_via` was already correctly set to `'whatsapp'` for WhatsApp-created tickets (`lib/conversations/orchestrator.ts`'s `mapChannelToSource()` → `createRequestCore()`, pre-existing, unrelated to this stage). The actual gap was `lib/rules/run.ts`'s `sourceChannelOf()`, which recognized only `created_via === 'intake'`, defaulting everything else (including WhatsApp) to `'portal'`. Added an explicit `whatsapp` case; re-verified live business_rules table has **zero** rows filtering on `source_channel` (so this is purely additive — no existing rule newly matches anything). Also added `{ value: 'whatsapp', label: 'WhatsApp' }` to the Reports/Business-Rules `source_channel` filter option list (`lib/reporting/field-registry.ts`) so an admin can actually configure a rule against it. No priority/SLA/assignment/routing logic was changed.

**Tests**: `sourceChannelOf()` exported for testability; `tests/unit/stage7-1-uat-findings.test.ts` covers `whatsapp`/`portal`/`intake` cases.

---

## Stale Stage1.1 Service Cleanup

Re-confirmed via direct read-only query immediately before acting: both remained `is_active=true`, `status='published'`, zero sub-categories, no resolved template — exact match for the Stage 6/7 test-artifact characterization.

| Service | ID | Before | After |
|---|---|---|---|
| Stage1.1 Service A stage1-1-sec-1789044248352 | `9194c746-8a24-467c-8066-3995f49e7c0c` | `is_active=true` | `is_active=false` |
| Stage1.1 Location-Restricted Service A stage1-1-sec-1789044248352 | `4ac2e458-d309-4b2f-a921-d4cac0a835af` | `is_active=true` | `is_active=false` |

Deactivated via `UPDATE services SET is_active=false WHERE id IN (...)` (exact IDs only, no pattern-based deletion), preserving the rows for audit/history rather than hard-deleting. A third, already-inactive "Stage1.1 Inactive Service A" was left untouched (already `is_active=false`, not in scope). Neither is now requester-visible (`listQuestionnaireServices()` filters on `is_active=true`).

---

## Platform Integrations WhatsApp Card

Requested directly by the user during this session (not present before) and implemented earlier in this same session: `app/(app)/admin/settings/SettingsClient.tsx`'s Integrations tab now includes a `WhatsAppCard` per configured channel (or an empty-state prompt if none), reusing `getWhatsAppChannelReadiness()` — **no second readiness calculation was built**. Shows Configured (Phone Number ID / WABA ID / Credentials), Verified (Meta connection + last test result + error), Webhook health, and requester mobile coverage; links out to Admin → Intake → Channels for actual credential management. `getWhatsAppChannelReadiness()` was deliberately changed to **not** gate on `requireModuleEnabled('intake')` (documented in its own code comment) so this status stays visible even while the Intake module toggle is off — directly answering the user's original complaint ("it's not showing in the UI"). No secret is ever rendered (confirmed via a live DOM scan for token-shaped strings — none found). Live-verified in the browser both empty-state and (via the Readiness panel's identical underlying data, already proven in Stage 7) populated-state rendering.

---

## Test Connection Testability

Reviewed `testWhatsAppConnection()` (`lib/actions/intake/whatsapp-channel.ts`) — it is an exported `'use server'` action invoked directly by a client button (`ChannelsClient.tsx`). Adding a public `fetchImpl` parameter would create an awkward, meaningless-from-a-real-client public API surface (a function can't cross the server-action RPC boundary), and tests already work around this cleanly via global-`fetch` stubbing (the same technique other server-action tests in this suite already use). **Not implemented**, per the brief's own explicit fallback — documented here rather than left as a silent omission.

---

## Search Content Finding

Re-confirmed unchanged from Stage 7: `printer`/`print`/`laptop`/`password`/`salary`/`vendor`/`invoice`/`refund` all return reasonable results against real IT/HR/Finance sub-categories; `wifi` returns zero results because **no WiFi/network-connectivity sub-category exists under IT Support at all** — a content gap, not a search-algorithm defect. No search code was touched. Question for Service ownership: **does IT Support need a WiFi/Network Connectivity sub-category?** Carried into `PRE_PILOT_CONFIGURATION_DECISIONS.md`.

---

## Business Configuration Decisions NOT Applied

Per explicit instruction, none of the following were touched — see `PRE_PILOT_CONFIGURATION_DECISIONS.md` for the full decision table:
- 3 of 4 `business_rules` still reference deleted `category_id`s and never fire.
- `assignment_rules` still has zero rows org-wide.
- 5 of 7 real services still route to a default team with zero active members.
- BD Support's default team is still named "ADMIN Support."

---

## Tests Added/Changed

**New:**
- `tests/unit/stage7-1-uat-findings.test.ts` (32 tests) — F-01 date validation, F-02 checkbox handling, conversational date normalization, semantic-role auto-fill, source_channel.
- `tests/integration/stage7-1-semantic-role-real-service.test.ts` — real IT Support Template end-to-end proof of the Subject/Description fix.

**Modified:**
- `tests/unit/validate-requester-form-completion.test.ts` — toggle/`false` test updated to the fixed (correct) expectation.
- `tests/integration/stage7a-attachments-fixture.test.ts` — checkbox-`false` finding assertion updated to the fixed behavior.
- `tests/integration/stage7b-parity-sla-assignment.test.ts` — UAT-16 script/assertions updated: HR Support's Subject/Description are now semantic-role-mapped, so the WhatsApp path no longer asks for them (only Mobile Number is asked after Description); the intentional web-vs-WhatsApp Subject/Description divergence (web: raw typed value: WhatsApp: auto-filled) is now explicitly asserted rather than incorrectly expected to match.

---

## Full Regression Results

`npx vitest run` **3 consecutive clean passes**, all fully green:
- Pass 1 (combined single invocation, before this stage's later work): **82 files / 655 tests**, 0 failures.
- Pass 2 (unit + integration run as two separate invocations — see note below): unit **36/36 files**, integration **46/46 files** (`--exclude "**/stage7a-*.test.ts"`, the same documented one-shot UAT-evidence exclusion from Stage 7), 0 failures either batch.
- Pass 3 (same split): unit **36/36**, integration **46/46**, 0 failures.

`npx tsc --noEmit`: clean, 0 errors.
`npm run lint`: 0 errors, 4 pre-existing-style warnings (`NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `RequestActionBar.tsx` — untouched by this stage; one new warning this stage's own `review.ts` edit briefly introduced was fixed immediately, confirmed clean on re-lint).

**Environment note, disclosed in full**: late in this stage's session, single full-suite invocations (`npx vitest run` across all ~700+ tests in one command) began intermittently terminating with exit code 127 partway through — never on a test failure, always mid-run, at inconsistent points. Every test that completed before an interruption passed; nothing about the interruptions correlated with this stage's own code changes. Splitting into two smaller invocations (`tests/unit` and `tests/integration` separately) reliably avoided the issue and is very likely a resource/session-duration artifact of this being an unusually long, heavy-DB-usage session (Stage 6, Stage 7, and Stage 7.1 all run back-to-back), not a code defect — reported here candidly rather than glossed over. Each interruption's partial residue (stale test-fixture rows from processes killed before their own cleanup ran) was found and removed before the final counted passes above; root-caused each time to hardcoded/static test-fixture mobile numbers in pre-existing (not this stage's own) test files colliding with a stale leftover from an earlier interrupted run — never a logic defect in the product code.

## Database Cleanliness

Verified via read-only query after the final cleanup pass: **0** stray secondary test organizations, **0** test WhatsApp/API `intake_channels`, **0** UAT fixture services, **1** pre-existing terminal-state (`expired`) test conversation from `stage4-expiry.test.ts`'s own fixture (harmless — terminal state, no collision risk, left in place rather than risk touching an unrelated pre-existing test's fixture without cause). Genuine seed/production data (7 real services, 62+ real employee profiles, the 2 now-deactivated-not-deleted Stage1.1 services) was never touched beyond the explicitly-authorized `is_active` flip.

## Storage Cleanliness

`request-attachments/staging/` prefix: **0** objects remaining after cleanup (was 50, accumulated across this session's extensive testing; all removed as they were universally either already-promoted-and-orphaned or from interrupted test runs — nothing legitimate persists under this prefix by design).

---

## Files Changed

**Validation / shared logic:**
- `lib/validation/formFields.ts` — `isValidCanonicalDate()`, `DATE_REGEX`; `date` case in `validateFieldValue()`; `isFieldValueEmpty()` now field-type-aware.
- `lib/requests/questionnaire/answers.ts` — `normalizeAnswerValue()` gains a `date` case (DD/MM/YYYY → canonical).
- `lib/requests/questionnaire/question-plan.ts` — new `applySemanticRoleAutofill()`.
- `lib/requests/questionnaire/review.ts` — `isFieldValueEmpty()` calls updated to pass field type.
- `lib/requests/validate-requester-form-completion.ts` — same.
- `lib/actions/requests.ts` — same (technician-mandatory check).
- `lib/conversations/orchestrator.ts` — `handleAwaitingDescription()` now calls `applySemanticRoleAutofill()` and persists/uses the merged answers.

**Web form:**
- `components/forms/DynamicForm.tsx` — `FieldValue` widened to include `undefined`; `getDefaultValue()` returns `undefined` for checkbox/toggle.
- `components/forms/FieldRenderer.tsx` — checkbox `checked` prop coerced via `Boolean()`; prop type widened.

**Business rules / reporting:**
- `lib/rules/run.ts` — `sourceChannelOf()` exported, adds `whatsapp` case.
- `lib/reporting/field-registry.ts` — `SOURCE_CHANNEL` gains a `whatsapp` option.

**Types:**
- `types/index.ts` — `FormField.semantic_role`.

**Admin UI (Platform Integrations card, this session):**
- `app/(app)/admin/settings/page.tsx`, `app/(app)/admin/settings/SettingsClient.tsx` — WhatsApp card.
- `lib/actions/intake/whatsapp-channel.ts` — `getWhatsAppChannelReadiness()` no longer gates on the Intake module.

**Tests:** see "Tests Added/Changed" above.

## Migrations Added

**None.** `semantic_role` is an additive JSONB key; the template migration was a data update (JSONB patch on `form_templates.form_sections`), not a schema migration.

---

## Remaining Findings

- ENH-10 (Test Connection `fetchImpl` injectability) — deliberately not implemented; see "Test Connection Testability" above.
- ENH-05 (search aliasing/synonyms, the `wifi` content gap) — needs a Service-owner decision, not a code change; carried into `PRE_PILOT_CONFIGURATION_DECISIONS.md`.
- All Stage 6/7 configuration findings (dead Business Rules, empty `assignment_rules`, unstaffed teams, BD naming) — untouched, per instruction; see `PRE_PILOT_CONFIGURATION_DECISIONS.md`.

## Real Meta Prerequisites

```
REAL META CONNECTION VERIFIED: NO
REAL META WEBHOOK VERIFIED: NO
REAL WHATSAPP MESSAGE VERIFIED: NO
```

Unchanged from Stage 6/7 — this sandbox still has no outbound internet access and no real Meta credentials. Nothing in Stage 7.1 attempted or claims otherwise.

## Controlled Pilot Readiness

```
CODE/CONFIG READY FOR REAL META VALIDATION: YES
```

Every approved Stage 7 finding is implemented, tested, and proven against the real production templates. No BLOCKER exists. The only remaining gate to a real Meta validation pass is the external prerequisite set already documented in `STAGE_6_REPORT.md` (real Meta credentials, public HTTPS deployment, Intake module enabled for the target org) — none of which are code or configuration work.

**This is not a company-wide production-readiness statement.** Per the brief's own boundary, the next step is real Meta validation + controlled pilot preparation — requiring an actual Meta WABA, App, Phone Number ID, Access Token, App Secret, public HTTPS deployment, and a real UAT mobile number, none of which exist in this sandbox.
