# Stage 2 — Mobile Identity & WhatsApp User Resolution

## Status

**Complete.** TypeScript clean, ESLint clean (repo-wide), full test suite green (284/284 tests, 32/32 files) across two consecutive full runs.

**Mid-stage requirement change incorporated.** The original task brief specified E.164 storage (`+919876543210`) with a separate `mobile_normalized` column. Partway through implementation — after the database layer was built and before any UI/action/resolver code was written — the user explicitly narrowed this to an **India-only, single-column design**: a bare 10-digit canonical number (`9876543210`, no `+91`, no country selector), with `profiles.mobile_number` itself being the normalized source of truth rather than a separate `mobile_normalized` column. This report describes the **final, India-only design actually shipped** throughout; the section "Design Change Mid-Stage" below documents exactly what was reverted and why.

---

## Repository Audit Findings

### Existing profile/user architecture
- `profiles` (base table `supabase/migrations/20240101000000_initial_schema.sql`, extended by ~10 later migrations) had **no phone/mobile column anywhere** before this stage — confirmed by grepping `types/database.ts` and every migration for `phone`/`mobile`/`telephone`/`contact_number`. The only hits repo-wide were (a) `MobileNav.tsx`/`AutoPushPrompt.tsx`/`Sidebar.tsx` — unrelated responsive-layout "mobile" — and (b) the ticket-form dynamic field type `phone` (`lib/validation/formFields.ts`'s `PHONE_REGEX = /^[0-9]{10}$/`, `components/forms/FieldRenderer.tsx`) — a per-ticket `form_data` value a requester types into one specific request's form, structurally unrelated to who they are. This confirms the discovery report's original finding and is why a brand-new column was needed, not a rename of something existing.
- Confirmed columns: `id, full_name, org_id (NOT NULL — migration 121), is_active, role, employee_id, department_id, location_id, store_id, cost_center_id, function_id, designation_id, manager_id, job_title, must_reset_password, avatar_url, created_at, updated_at`. Email lives only in Supabase Auth (`auth.users`), not on `profiles`.
- No existing unique constraint or index relevant to a mobile column (the closest precedent, `idx_profiles_store` — migration 130 — is a plain non-unique FK index).
- RLS: standard org-scoped `profiles_select`/`profiles_admin` pattern; nothing mobile-specific needed since every new write path already goes through the same service-role admin client the rest of `lib/actions/admin/users.ts` uses.
- No trigger/function touches `profiles.mobile_number` — it is written directly by application code only (Add User, Edit User, bulk import), matching the task's "server-controlled" requirement by construction.

### User-management files (exact paths)
- `app/(app)/admin/users/page.tsx` — server component, fetches `profiles.select('*')` (already picks up new columns automatically), `UserManagementClient` prop wiring.
- `app/(app)/admin/users/UserManagementClient.tsx` — client component containing `EditDrawer` (Edit User), `InviteModal` (Add User), `UserRow` (list), `ToggleActiveButton` (activate/deactivate).
- `lib/actions/admin/users.ts` — Server Actions: `updateUserProfile`, `inviteUser`, `bulkCreateUsers`, `updateUserRole`, `toggleUserActive`, `setUserTeams`, `adminSendPasswordReset`, `adminSetPassword`.
- `components/admin/BulkImportUsersDialog.tsx` + generic `components/ui/ImportModal.tsx` (CSV parsing, `lib/import/csv.ts`) — bulk import UI.

### Bulk-import architecture (verified by reading the code, not assumed)
- **Create-only, not upsert.** An existing email is always **skipped** (`"already has an account, skipped"`) — `bulkCreateUsers()` never updates an existing profile. This directly resolves the task's "CREATE VS UPDATE IMPORT BEHAVIOR" question: since every successfully-processed row is, by construction, a brand-new profile, there is no "does this row's mobile falsely conflict with the very user being edited" scenario for bulk import at all (that self-exclusion case only applies to `updateUserProfile()`'s Edit User path, and is handled there — see below).
- CSV parsing (`components/ui/ImportModal.tsx` → `lib/import/csv.ts`) hands every value through as a plain string — no existing boolean-column convention anywhere to reuse, so `whatsapp_enabled` needed its own small, explicit parser (see below).
- Row-level errors accumulate in a flat `string[]` (one line per skipped row, `"Row N: <reason>."`), never a hard failure for the whole batch — the new mobile validation follows this exact existing convention.
- Duplicate detection today (pre-Stage-2) only covers email, via a prefetched `Map<email, profileId>`. No transaction wrapping — each row is created independently, matching the existing code's own behavior (unchanged by this stage).

---

## Database Changes

### Migration
`supabase/migrations/20240101000133_profile_mobile_identity.sql`:
```sql
ALTER TABLE profiles ADD COLUMN mobile_number TEXT;
ALTER TABLE profiles ADD COLUMN whatsapp_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX idx_profiles_org_mobile_number_unique
  ON profiles (org_id, mobile_number)
  WHERE mobile_number IS NOT NULL;
```

### Columns
| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `mobile_number` | `TEXT` | Yes | `NULL` | The single source of truth — always stored in canonical bare-10-digit form (e.g. `9876543210`), never anything else. No separate raw/display or normalized column (see "Design Change Mid-Stage"). |
| `whatsapp_enabled` | `BOOLEAN` | No | `true` | Capability toggle, independent of `is_active` and of whether `mobile_number` is set. |

### Indexes / uniqueness behavior
`idx_profiles_org_mobile_number_unique` is a **partial** unique index on `(org_id, mobile_number) WHERE mobile_number IS NOT NULL`:
- Any number of profiles may have `mobile_number IS NULL` without colliding (partial index excludes NULLs entirely from the uniqueness check).
- Two profiles in the **same** org can never share a normalized number.
- The **same** number may exist in **different** orgs without conflict (org-scoped, not global) — proven by a dedicated test (`"the same normalized number CAN independently exist in two different orgs without conflict"`).
- `profiles.org_id` is already `NOT NULL` (migration 121), so no NULL-org_id edge case exists to handle.

### Backward compatibility
- Every existing profile got `mobile_number = NULL, whatsapp_enabled = true` (the `ADD COLUMN` defaults) — no existing row was touched, no existing constraint violated (verified: the migration ran cleanly against the live local dataset with real, pre-existing profiles).
- Mobile is not required at the database level for any existing operation — login, profile reads, ticket creation, and every pre-Stage-2 test all continue to pass unchanged (see Existing Tests / Regression Results).

### How this migration was actually applied (a discovery worth recording)
This local Supabase instance's `supabase_migrations.schema_migrations` tracking table stops at `20240101000105` even though 27 more migration **files** (106–132) already existed in the repo before this stage and their effects (e.g. `requests.paused_ms_total` from migration 125) are demonstrably live in the database. This confirms the project's actual working practice for a while now has been to apply migrations directly against the running Postgres container (`docker exec supabase_db_citykart_desk psql ...`) rather than through the Supabase CLI's own `migration up`/`db push` tracking — consistent with the `supabase/manual/*.sql` files already present in the repo. This migration was applied the same way, for consistency with the established (if untracked) practice; noted here rather than silently deviating from what the repo actually does.

### TypeScript types
A full `supabase gen types typescript` regeneration was attempted and evaluated, but **reverted** — it surfaced ~15 pre-existing, unrelated type errors across `lib/actions/requests.ts`, `lib/actions/tasks.ts`, and multiple test fixture files (all `org_id missing` errors, caused by other tables' generated types having drifted out of sync with the live schema over many migrations, exactly matching `next.config.ts`'s own documented warning: *"Tables added in migrations after types were generated — safe to skip"*). Doing a full regeneration would have either left `tsc --noEmit` non-clean (violating this stage's own acceptance criteria) or required fixing a wave of unrelated pre-existing issues (scope creep). Instead, `types/database.ts` was **hand-edited**, adding only `mobile_number`/`whatsapp_enabled` to `profiles`' `Row`/`Insert`/`Update` shapes — the `Profile` type (`types/index.ts`) derives automatically via `Tables<'profiles'>`, so every consumer picks up the new fields with no further changes needed. This is a narrower, lower-risk action than the repository's own type-generation state currently supports cleanly.

---

## Mobile Normalization

`lib/users/mobile.ts` — `normalizeMobileNumber(input: string)`. India-only; no `validateMobileNumber()` was added separately since the normalize function's own `{ok: false, error}` result already encodes validity.

**Accepted (all normalize to the bare 10-digit form):**
| Input | Normalized |
|---|---|
| `9876543210` | `9876543210` |
| `09876543210` | `9876543210` |
| `919876543210` | `9876543210` |
| `+919876543210` | `9876543210` |
| `+91 98765 43210` | `9876543210` |
| `+91-98765-43210` | `9876543210` |
| `91-98765-43210` | `9876543210` |
| `(987) 654-3210` | `9876543210` |
| leading/trailing whitespace | trimmed first |

**Rejected:**
| Input | Why |
|---|---|
| empty / whitespace-only | required |
| `123`, `98765` | too short |
| `abcdefghij` | non-numeric |
| `++++919876543210` | malformed (more than one `+`) |
| `+14155552671`, `+442079460958` | non-Indian E.164 — explicitly out of scope now |
| `5876543210`, `0876543210` | 10 digits but first digit not in the 6–9 mobile range |
| `98765432100` | 11 digits, not the valid 0-prefix shape |
| `919876543211234` | too long |

**Disambiguation rule (tested explicitly):** a bare 10-digit input is never reinterpreted based on its leading digits — only a **12-digit total** input starting with `91`, or an **11-digit total** input starting with `0`, is treated as a prefixed number. `9187654321` (10 digits, happens to start with "91") is correctly read as a plain 10-digit mobile number, not a country-code-prefixed one.

**Library decision:** no phone-number library (e.g. `libphonenumber-js`) was added. None was already installed (`grep` of `package.json`/`node_modules` confirmed), and the actual requirement — India-only, one canonical format, no per-country metadata — doesn't need one; a ~15-line regex-based implementation is simpler to audit and has zero new dependency surface. Documented here per the task's explicit request to record this decision either way.

---

## User Master Changes

### Add User (`InviteModal` → `inviteUser()`)
New "Mobile Number" text input (client-side live validation via the same `normalizeMobileNumber()`, imported directly into the client component — it's a plain, dependency-free module, safe to run in the browser) and a "WhatsApp ticketing enabled" checkbox (defaults checked). Server-side: normalize → validate → org-scoped duplicate check, **all before** the Supabase Auth user is created — a rejected mobile number never leaves behind an orphaned auth account, matching the existing pattern already used for org-reference validation in this same function.

### Edit User (`EditDrawer` → `updateUserProfile()`)
New "WhatsApp" section: Mobile Number input (pre-filled with the current value) + WhatsApp toggle, in the same drawer as every other profile field. Admin can add, change, or clear the number, and independently enable/disable WhatsApp eligibility. **Atomicity:** there is exactly one `mobile_number` column — normalization happens once, server-side, and the normalized value is what's written; there is no possible intermediate state where a "new raw input" and an "old normalized value" disagree, because no second column exists to disagree with. **Removal:** an empty input sets `mobile_number = NULL` in the same update call as every other field. **Self-conflict handling:** `checkMobileNotTaken()` takes an `excludeUserId` so re-saving a user's own unchanged number never false-positives against itself — proven by a dedicated test.

### Detail / List
Per the task's own width caution, the already-dense user list row (a fixed 6-column grid) was **not** given a new column. Instead, a small emerald "WhatsApp" badge (with the number in its tooltip) appears inline next to the existing job-title/department/manager badges, shown only when a user has both a mobile number and WhatsApp enabled — consistent with the existing badge pattern, no layout/width change. Full detail (the actual number, the toggle) lives in the Edit drawer, per the task's own prioritization guidance.

### WhatsApp toggle behavior (verified by test)
Confirmed independent of `is_active` and of `mobile_number` itself: toggling `whatsapp_enabled` off leaves the mobile number, active status, and every other profile field untouched — proven directly (`"disabling whatsapp_enabled does not touch mobile_number, is_active, or normal DESK account state"`).

---

## Bulk Import Changes

### Supported columns
`mobile_number`, `whatsapp_enabled` added to `UserImportRow` and the sample-CSV template (`BulkImportUsersDialog.tsx`).

### Normalization
Every row's `mobile_number` goes through the exact same `normalizeMobileNumber()` used by Add/Edit User — no CSV-specific phone logic exists anywhere.

### Duplicate handling (two-pass design)
A **pre-pass**, before any auth account in the batch is created, normalizes every row's mobile number and detects:
- **In-CSV duplicates** — compared by *normalized* value (so `9876543210` and `+919876543210` in two different rows are correctly caught as the same number), blocking **both** colliding rows with a message naming the other row (`"Row 2: same mobile number as Row 3."` / `"Row 3: same mobile number as Row 2."`).
- **Invalid format** — same per-row error convention as every other column (`"Row N: <message>, skipped."`).

The main creation loop then also checks each surviving row's normalized number against `existingMobileNumbers` — every mobile already registered to an existing profile in this org (prefetched once, extended in-memory as each new row is successfully created, so row 5 correctly conflicts with row 2's just-created number too). A `23505` (`idx_profiles_org_mobile_number_unique`) catch remains as the final race-condition backstop, matching the same pattern used in `updateUserProfile()`/`inviteUser()`.

### Empty mobile
Allowed — an empty `mobile_number` cell simply leaves the profile with `mobile_number = NULL`, exactly like a normal Add/Edit User with no number entered.

### `whatsapp_enabled` parsing
`parseImportWhatsAppEnabled()` — explicit allow-list only: `true/yes/1` → `true`, `false/no/0` → `false` (case-insensitive), empty/omitted → leave unset (schema default `true` applies). Anything else (e.g. `"maybe"`) is a row-level error, never silently coerced — proven by test.

### Create vs. update
Confirmed (see Repository Audit Findings): `bulkCreateUsers()` is create-only. The task's "ensure a user's own existing mobile doesn't falsely conflict with itself during an update" scenario does not apply to this action at all — every successfully-imported row is a new profile by construction. This is recorded as a factual finding, not assumed.

---

## WhatsApp Identity Resolver

### API
```ts
// lib/users/resolveWhatsAppUser.ts
resolveUserByWhatsAppNumber(params: {
  orgId: string
  phoneNumber: string
  client?: AnyClient   // defaults to the service-role admin client
}): Promise<
  | { ok: true; profile: WhatsAppIdentity }
  | { ok: false; reason: 'invalid_phone' | 'not_registered' | 'inactive' | 'whatsapp_disabled' }
>

type WhatsAppIdentity = {
  profileId: string; orgId: string; fullName: string
  employeeId: string | null; role: string
  storeId: string | null; departmentId: string | null; locationId: string | null
}
```

### Tenant scoping
`orgId` is a **required** parameter — there is no phone-only overload. The resolver never performs a global mobile-number lookup; every query is explicitly `.eq('org_id', orgId).eq('mobile_number', normalized)`, regardless of which client is passed. A future WhatsApp webhook must resolve `orgId` **first** (from the inbound Intake Channel/Meta Phone Number ID — `intake_channels` already models a per-org channel today) and only then call this resolver — documented directly in the module's own top-of-file comment so a future implementer can't accidentally reach for a phone-only shortcut.

### Eligibility rules (checked in this order, each with its own structured failure reason)
1. `normalizeMobileNumber(phoneNumber)` succeeds → else `invalid_phone`
2. A profile in `orgId` has that exact `mobile_number` → else `not_registered`
3. That profile's `is_active` → else `inactive`
4. That profile's `whatsapp_enabled` → else `whatsapp_disabled`

Querying the candidate row **without** filtering `is_active`/`whatsapp_enabled` in SQL (checking them in application code afterward instead) is what makes these four distinct, structured reasons possible — filtering them in the `WHERE` clause would collapse every failure into an indistinguishable `not_registered`.

### Failure results
A typed discriminated union, not string parsing — matches the pattern already used throughout this codebase (`WorkResult` in `lib/actions/intake/work.ts`, `CreateRequestCoreResult`, etc.). No cross-org or cross-user information is ever included in a failure result — a caller cannot tell "wrong org" apart from "number doesn't exist anywhere" apart from "belongs to someone else," which is the point (see Security Review).

---

## Security Review

- **Service-role behavior:** the resolver defaults to `createAdminClient()` — the exact shape a future webhook (no browser session) will call it with — and every query carries an explicit `org_id` filter regardless. RLS is never relied on for tenant isolation here, consistent with the pattern already established in `createRequestCore()` (Stage 1.1).
- **Org scoping:** proven directly — a service-role lookup for Org B against an Org A user's number returns `not_registered`, with a same-org control proving the number itself is valid (`"a service-role lookup for Org B cannot resolve an Org A user with the same number"`).
- **Duplicate identity:** enforced at the database level (partial unique index), not only in application code — `checkMobileNotTaken()` in `lib/actions/admin/users.ts` gives a clear error before the DB constraint would ever be hit in the normal case, and the `23505` catch at every write site is the final, race-safe backstop.
- **Client cannot set the normalized identity directly:** every write path (`updateUserProfile`, `inviteUser`, `bulkCreateUsers`) accepts only the raw, human-entered `mobile_number` string and always derives the stored value itself via `normalizeMobileNumber()` server-side — there is no code path where a client-supplied pre-normalized value is trusted or stored as-is.
- **No second mapping system:** confirmed by design and by the AC-2.9 test — changing `profiles.mobile_number` is the *only* action taken; no other table, cache, or mapping is written or needs to be, and the resolver has nothing else to consult.

---

## Tests Added

`tests/unit/mobile-normalization.test.ts` (24 tests) — every accepted/rejected format in the table above, plus the length-based disambiguation rule.

`tests/integration/stage2-mobile-identity.test.ts` (22 tests, real local Postgres/Auth):
- Add User stores canonical form regardless of input formatting; rejects malformed input with no orphaned auth account.
- Duplicate mobile within org rejected (different formatting still collides); no orphaned auth account.
- Edit User: add/change/remove mobile atomically; re-saving own number never false-positives; stealing another user's number is rejected.
- WhatsApp toggle independence (mobile/active/other fields untouched).
- Resolver: valid active enabled user resolves with the correct identity shape; format-equivalence across 5 representations of one number; unregistered number → `not_registered`; malformed input → `invalid_phone`; inactive user → `inactive`; disabled → `whatsapp_disabled` then re-enabled → resolves again; NULL-mobile profile → clean `not_registered`, no crash.
- **Cross-org isolation** (AC-2.8) with a same-org control; same number independently valid in two different orgs.
- **The headline mobile-change test** (AC-2.9): old number → `not_registered`, new number → resolves, with no second mapping touched anywhere in the test.
- Bulk import: creates with mobile/whatsapp columns; invalid row doesn't block the batch; in-CSV duplicate blocks both rows; DB duplicate against an existing profile rejected; unparseable `whatsapp_enabled` rejected.
- Regression: a legacy NULL-mobile profile continues to update/read normally on unrelated fields.

## Existing Tests / Regression Results

All 238 tests from Stage 1.1 (unit + integration, including the Task 2 cross-org `createRequestCore()` suite and Task 3/4 Email Intake suite) pass **unchanged** — nothing in Stage 2 touches `createRequestCore()`, `validateRequesterFormCompletion()`, the web request path, or Email Intake. No regression in web ticket creation, Email Intake conversion, approvals, or assignment.

## Commands Run

```
npx vitest run
```
**284/284 tests, 32/32 files — two consecutive clean full runs** (238 pre-existing + 24 new unit + 22 new integration).

```
node node_modules/typescript/lib/tsc.js --noEmit
```
Clean, zero errors.

```
node node_modules/eslint/bin/eslint.js app lib components types proxy.ts
```
Zero errors. 3 pre-existing warnings in files this stage never touched (`components/projects/NewMilestonePanel.tsx`, `NewProjectPanel.tsx`, `components/requests/RequestActionBar.tsx` — confirmed via `git status` showing no modifications to any of them) — not introduced by Stage 2.

---

## Files Changed

**New:**
- `lib/users/mobile.ts` — `normalizeMobileNumber()`.
- `lib/users/resolveWhatsAppUser.ts` — `resolveUserByWhatsAppNumber()`.
- `tests/unit/mobile-normalization.test.ts`
- `tests/integration/stage2-mobile-identity.test.ts`

**Modified:**
- `lib/actions/admin/users.ts` — `updateUserProfile`, `inviteUser`, `bulkCreateUsers` extended; new `checkMobileNotTaken()`/`parseImportWhatsAppEnabled()` helpers.
- `app/(app)/admin/users/UserManagementClient.tsx` — Mobile Number + WhatsApp toggle in `EditDrawer` and `InviteModal`; WhatsApp badge in `UserRow`.
- `components/admin/BulkImportUsersDialog.tsx` — sample CSV columns.
- `types/database.ts` — `mobile_number`/`whatsapp_enabled` added to `profiles` (hand-edited; see Database Changes).

## Migrations Added

- `supabase/migrations/20240101000133_profile_mobile_identity.sql`

---

## Design Change Mid-Stage

The database layer was initially built per the original brief's E.164 design (`mobile_number` for display + a separate `mobile_normalized` column for matching, unique index on `(org_id, mobile_normalized)`, normalizer producing `+91XXXXXXXXXX`). This was applied to the local dev database and evaluated (including a full `supabase gen types` regeneration test) **before** any UI, Server Action, or resolver code was written. Once the user explicitly narrowed the requirement to India-only with a single canonical column, the database change was **reverted** (columns dropped, index dropped) and **reapplied** in its final single-column form — not layered as a second, follow-up migration — since the E.164 version was never relied upon by any other code, and squashing avoids leaving a confusing "add X, immediately obsolete X" migration pair in the repo's history. `lib/users/mobile.ts`'s normalizer and every downstream write path were then built directly against the final design; nothing needed a second revision pass.

## Important Design Decisions

1. **Single column, not two.** `mobile_number` is both the admin-facing and canonical matching value. Under the India-only design there is no formatting variance left to justify a second column (unlike a hypothetical E.164 design where "+91 98765 43210" as typed and "+919876543210" as matched could legitimately differ) — a second column would always exactly duplicate the first.
2. **No `validateMobileNumber()` as a separate export.** `normalizeMobileNumber()`'s own `{ok: false, error}` result already fully encodes validity; a redundant wrapper would just be another thing to keep in sync.
3. **No phone-number library dependency.** See "Mobile Normalization" above.
4. **`whatsapp_enabled` defaults to `true`.** Matches the task's own recommendation; justified by the same "capability defaults on, inert until its real precondition is met" pattern already used for `form_field.requester_can_view`/`requester_can_set` — a `true` default with no mobile number costs nothing.
5. **Mobile-error rows in bulk import skip the entire row** (no partial account-without-mobile creation on a mobile error) — consistent with how every other column's validation failure in this same function already behaves (department not found, invalid role, etc. all `continue` past account creation).
6. **Resolver checks `is_active`/`whatsapp_enabled` in application code, not the `WHERE` clause** — required to produce the four distinct structured failure reasons the task asked for, rather than collapsing them all into `not_registered`.

## Known Gaps

- The user list row's WhatsApp badge shows only a boolean-ish "registered/not" signal (tooltip has the number) — no inline edit; matches the task's own "prioritize Detail/Edit over List" guidance.
- `types/database.ts` was hand-edited rather than fully regenerated — correctly typed for this stage's own columns, but the file's pre-existing staleness for unrelated tables (see Database Changes) remains exactly as it was found, not improved or worsened.
- No rate limiting on `resolveUserByWhatsAppNumber()` itself (unlike `inviteUser`'s invite-email rate limit) — appropriate for Stage 2 (no webhook calls it yet), worth revisiting once a real WhatsApp webhook exists and can be hit by an external, potentially adversarial party guessing numbers.

## Pre-Production Hardening Backlog

Carried forward, explicitly not addressed in this stage:
- **`validateFieldValue()` does not cross-check a `select`/`radio` value against its configured option list** (confirmed in Stage 1.1; out of scope here since nothing in Stage 2 touches that validator).
- **Strict required-file handling** for a future WhatsApp questionnaire (`validateRequesterFormCompletion()`'s `treatFileFieldsAsSatisfied` carve-out, documented in Stage 1.1) — still relevant once the questionnaire engine is built.
- **New this stage:** `resolveUserByWhatsAppNumber()` has no rate limiting/abuse protection — fine while nothing external calls it, but should be added alongside the actual WhatsApp webhook in a later stage (an attacker with webhook access could otherwise brute-force-guess valid 10-digit numbers against the resolver).
- **New this stage:** the admin-facing Mobile Number input has no input mask/format-as-you-type UX — functional (validates and normalizes correctly) but not maximally friendly; a minor UX polish item, not a correctness gap.

## Stage 3 Readiness

**READY FOR STAGE 3: YES**

Mobile schema, Add/Edit User, bulk import, normalization, and the resolver are all complete and independently tested, including the two properties Stage 3's questionnaire engine will most depend on: (1) tenant isolation is proven under a service-role client — the exact calling shape a WhatsApp webhook will use — and (2) the mobile-change/no-second-mapping guarantee is proven end-to-end, confirming the User Master really is the sole source of truth an eventual webhook can trust with zero additional bookkeeping. All 284 tests pass, TypeScript and ESLint are clean, and nothing in Stage 1/1.1's shared ticket-creation core or Email Intake path was touched.
