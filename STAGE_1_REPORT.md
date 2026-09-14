# Stage 1 — Shared Ticket-Creation Core

**STAGE:** 1 (Extract channel-agnostic ticket creation core; fix Email Intake to use it)
**STATUS:** Complete, all tests green.

---

## Files changed

**New:**
- `lib/requests/create-request-core.ts` — `createRequestCore()`, the shared, channel-agnostic ticket-creation business logic (moved out of `createRequest()`), plus `runOemAutoRouting()` (moved here unchanged).
- `lib/requests/validate-requester-form-completion.ts` — `validateRequesterFormCompletion()`, the Stage 1C mandatory-field completion gate, built entirely from existing reused pieces (`resolveServiceFormSections`, `filterFlatFieldsForRequester`, `isRequesterMandatory`, `validateFieldValue`, `isFieldValueEmpty`).
- `tests/unit/validate-requester-form-completion.test.ts` — 15 pure unit tests for the gate utility.
- `tests/integration/whatsapp-stage1-create-request-core.test.ts` — 8 real-DB integration tests covering web/core-direct/Email-Intake parity.

**Modified:**
- `lib/actions/requests.ts` — `createRequest()` reduced from a ~360-line function to a thin adapter (auth, module gate, "book on behalf of" resolution, `FormData` parsing → call the core). `runOemAutoRouting()` and its only imports (`sendEmail`, `escapeHtml`, `filterFlatFieldsForRequester`) removed (moved/no-longer-needed). No other function in this file was touched.
- `lib/actions/intake/work.ts` — `approveAndCreate()`'s `'request'`/`'approval'` branches now call `createRequestCore()` instead of a direct `INSERT`. The `'approval'` type's extra behavior (approvals row + status flip) is now a follow-up step, guarded to only flip status when an approval row was actually created. Added an `org_id` filter to the "any default workflow" fallback query (was previously unscoped — see Known gaps). `'task'`/`'informational'`/`'ignore'` branches, `convertToWork()`, and `reclassifyReview()` are untouched.

**Migrations added:** none.

---

## Tests added/changed

- 15 new unit tests (`validate-requester-form-completion.test.ts`) — pure function, no DB.
- 8 new integration tests (`whatsapp-stage1-create-request-core.test.ts`) — real local Supabase Postgres/Auth, covering:
  - Web path (`createRequest`): valid submission → fully governed ticket (SLA, Business-Rule assignment, activity log); missing mandatory select field → rejected pre-insert; technician-only field never blocks requester submission.
  - Core-direct call (admin client, no browser session — the shape a WhatsApp webhook will use): identical governed output to the web path; same mandatory-field gate applies.
  - Email Intake `'request'` conversion: now receives SLA deadlines and Business Rule assignment (previously both were silently null/skipped); trusted priority override preserved.
  - Email Intake `'approval'` conversion: creates the `approvals` row and enters `pending_approval` when a workflow is bound; never leaves a ticket stuck in `pending_approval` with zero approval rows (a strict improvement over the prior unconditional-status-set behavior).
- No existing test was modified.

## Tests run

```
npx vitest run
```
Full suite, twice (once immediately after the code changes, once after adding the new test files) — **28 test files / 221 tests, all passing.** (Baseline before any Stage 1 change: 26 files / 198 tests, all passing — 221 = 198 + 15 + 8.)

One transient failure was observed on an intermediate run in a pre-existing, untouched test (`desk-uat-001-reopen.test.ts` case 2, a 72-hour-deadline check) — traced to a 60-second in-memory cache in `lib/settings/reopenWindow.ts` that is shared across test files within the same Vitest worker process (a pre-existing architectural fragility, not something Stage 1 introduced or touched). A clean re-run of the full suite immediately after was 100% green; the failure did not reproduce.

```
node node_modules/typescript/lib/tsc.js --noEmit
```
Clean except two **pre-existing** errors in `lib/actions/requests.ts`'s `submitForApproval()` (lines ~2024/2040, `usedWorkflowId: string | null` narrowing) — confirmed via `git diff` that this code was already present in the working tree, uncommitted, before this session started; Stage 1 never touches `submitForApproval()`. Left as-is (out of scope).

```
node node_modules/eslint/bin/eslint.js lib/requests lib/actions/requests.ts lib/actions/intake/work.ts tests/unit/validate-requester-form-completion.test.ts tests/integration/whatsapp-stage1-create-request-core.test.ts
```
Clean, no errors or warnings.

## Result

All Stage 1 goals achieved:
- `createRequestCore()` exists and is the single place service resolution, mandatory-field validation, title/priority/SLA derivation, insert, Business Rules, activity logging, OEM auto-routing, and notifications happen — verified byte-for-byte behaviorally identical to the pre-refactor `createRequest()` for the web channel (all pre-existing tests pass unchanged; new parity tests confirm SLA/assignment/activity match exactly between a web-path call and a bare `createRequestCore()` call with an admin client and no browser session).
- Email Intake's `approveAndCreate()` now produces governed tickets: **SLA deadlines are set** (integration-test-proven; previously always `null` for every intake-created ticket) and **Business Rules now fire** (integration-test-proven; previously never invoked for this path) — closing the two most important gaps identified in the discovery report's §11/§21.
- `validateRequesterFormCompletion()` is a standalone, reusable gate — unit-tested against every field type in the requested matrix — ready for WhatsApp's questionnaire engine (Stage 3) to reuse for its own "is this ticket ready to submit" check.

## Important design decisions

1. **`priorityOverride` (new, narrow escape hatch).** Routing Email Intake through the core would otherwise have silently discarded the reviewer's human-confirmed priority (`decision.final_priority`) in favor of the sub-category/service default — a real regression, since intake's priority has already passed AI-classification-plus-human-review, unlike a raw web/WhatsApp submission. Added `priorityOverride?: RequestPriority` to the core, explicitly documented as reserved for a channel where the value has already been vetted by a human or trusted process, never for an unreviewed self-serve channel. The web adapter never sets it.
2. **`teamIdOverride` (new, narrow escape hatch).** Email Intake reviewers can route a converted ticket to a different team than the service's own default — a real, pre-existing, UI-driven capability of that one channel. Preserved via an explicit, org-validated override parameter rather than either breaking it or baking team-choice logic into the core's general contract.
3. **`description` passthrough.** Email Intake stores a plain description column value the web form never has (web derives everything from `form_data`). Added as an optional, default-`null` passthrough so web behavior is byte-identical and intake's existing column behavior is preserved.
4. **The `'approval'` payload type's extra behavior stays in `work.ts`, not the core.** Only Email Intake auto-enters `pending_approval` + creates an `approvals` row at creation time; the web path never does this (approval entry is always a separate, deliberate `submitForApproval()`/`sendAdHocApproval()` call — confirmed in the discovery report). Folding this into the core would have made it do something channel-specific by default. Kept as a small follow-up step in `work.ts`, mirroring how the web path's own `submitForApproval()` is already a separate step from creation.
5. **Deliberate behavior improvement, not preserved as-is: the `'approval'` conversion no longer sets `status: 'pending_approval'` unconditionally.** The original direct-insert code set that status regardless of whether a workflow actually existed to bind an `approvals` row to — an org with zero configured approval workflows would get a ticket permanently stuck in `pending_approval` with no way to ever resolve it (the exact "stepless workflow" failure class the web path's `submitForApproval()` already has an explicit, commented guard against — "Product Decision D"). The new code only flips status after a real `approvals` row is confirmed created. Test-proven (`"never leaves a ticket stuck in pending_approval with zero approvals rows"`).
6. **Added an `org_id` filter to intake's "any default approval workflow" fallback query.** The original query (`admin.from('approval_workflows').select('id').limit(1).maybeSingle()`, no filter) ran on the service-role client, which bypasses RLS — meaning "any default workflow" could pick literally any organization's workflow, a genuine cross-tenant leak. Fixed alongside this work since it's the exact line being touched and the fix is one clause; flagged here rather than silently bundled in.
7. **`store_address` and `file` field carve-outs in the new gate utility.** `store_address` is always system-populated (exempted, matching `validateFieldValue()`'s own existing exemption — this was a bug I introduced and caught via the unit test, fixed before this report). `file`-type required-ness stays client-side-only by default (`treatFileFieldsAsSatisfied: true`), matching `createRequest()`'s pre-existing, documented, unchanged limitation (a file can't be in `form_data` at creation time — `request_attachments.request_id` is a NOT NULL FK). The utility supports a `false` "strict" mode for a future channel (WhatsApp's attachment stage) that has real attachment-presence data to check against.

## Known gaps

- **Email Intake's mandatory-field/category enforcement is now real, and can newly reject a conversion that previously silently produced an incomplete ticket.** This is explicitly requested by the Stage 1 brief ("Tickets created from Email Intake should also correctly receive ... normal validation") and is the intended, correct outcome — but two concrete consequences are worth flagging for whoever picks up Intake Review UI work next: (1) `buildFormData()`'s entity-autofill only fills text/date/number/email fields matching specific label patterns — a required select/radio/multiselect/checkbox/phone field, or a text field with an unrecognized label, will now surface a clear `"<Field> is required."` error with no UI affordance for the reviewer to supply it. (2) A service with tagged Sub-Categories will now require one — the `WorkPayload` type has no field for it at all, so **every** such service will now fail Email Intake conversion until a Sub-Category picker is added to the Review UI. Neither is a data-corruption risk (the conversion just fails loudly instead of succeeding silently with missing data), but both are real, user-visible behavior changes worth calling out before this ships.
- **`createRequestCore()`'s catalog/profile reads accept a caller-supplied `client` and add `org_id` filters as defense-in-depth, but this is not exhaustively audited against every table it touches.** I added filters everywhere the original code visibly relied on RLS for tenant scoping (`services`, `profiles`, `stores`, `teams` via `teamIdOverride`); a full security review before wiring up a real WhatsApp webhook (which will call this with the admin client) is still warranted, per the discovery report's own Security/Permissions section.
- **The pre-existing `submitForApproval()` TypeScript errors** (untouched by this work, confirmed present in the working tree before this session) remain unresolved — flagged, not fixed, as out of scope for Stage 1.

## Next stage

Stage 2 — add mobile number to the user master (`profiles.mobile_number`/`mobile_normalized`/`whatsapp_enabled`), a dedicated E.164 normalizer, uniqueness enforcement, admin UI + bulk-import support, and `resolveUserByWhatsAppNumber()`, per the discovery report's confirmed finding that no phone-to-employee identity mechanism exists today.
