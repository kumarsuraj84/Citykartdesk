# STAGE 7.1 — ENHANCEMENT PLAN

Produced from `STAGE_7_UAT_RESULTS.md`'s findings. Nothing in this document has been implemented as part of Stage 7 — it is a prioritized backlog for review, not an execution log. (Exception, per Step 28's explicit allowance: Findings F-29/F-30, classified HIGH with a clear, small, well-tested root cause, were fixed during Stage 7 itself and are recorded as CLOSED below, not as open backlog items.)

---

## Must Fix Before Pilot

None. No BLOCKER was found, and the two HIGH findings from this stage (F-29, F-30) were already fixed and re-verified during Stage 7 — see "Closed During Stage 7" below.

## Should Fix Before Wider Rollout

### ENH-01 — Mandatory `date` fields accept unvalidated input
- **Finding ID**: F-01
- **Problem**: `validateFieldValue()` has no case for `field.type === 'date'` — any non-empty string satisfies a mandatory date field, including garbage like `"not-a-real-date"`.
- **Evidence**: Reproduced live — the literal string `"not-a-real-date"` was accepted and persisted into a real FINANCE & ACCOUNTS Support ticket's `form_data` during Stage 7 Step 11.
- **Impact**: Data-quality defect, not a bypass (the field is still required to be non-empty). Affects both web and WhatsApp equally — a pre-existing gap in the shared validator, not WhatsApp-specific. Low immediate risk (no downstream logic currently parses these values as real dates), but will surface as bad data the longer it's live.
- **Recommended change**: Add an ISO-8601 (or the app's existing date format) format check to `validateFieldValue()` for `type: 'date'`, mirroring how `number`/`phone`/`email`-style fields are presumably already validated.
- **Code vs configuration**: Code (`lib/validation/formFields.ts`).
- **Risk**: Low — additive validation, no existing behavior removed; should not break any currently-passing real submission, since a genuinely valid date string will still pass.
- **Suggested stage**: Stage 7.1 (before any date-field-bearing service is used at scale, currently limited to Finance's Transaction Date).

### ENH-02 — A mandatory checkbox can never be honestly answered "No"
- **Finding ID**: F-02
- **Problem**: `isFieldValueEmpty()` treats a boolean `false` as "empty," so a mandatory checkbox rejects `false` as if unanswered, forcing the requester toward "Yes."
- **Evidence**: Reproduced on the `UAT Fixture — Field Types` service's checkbox field during Stage 7 Step 11/12.
- **Impact**: Zero current production impact — Stage 6 confirmed no real template has a required checkbox field. Becomes a real defect the moment one is added.
- **Recommended change**: `isFieldValueEmpty()` should special-case `checkbox`/boolean-typed fields — only `null`/`undefined` (never explicitly answered) counts as empty; `false` is a valid, complete answer.
- **Code vs configuration**: Code (the same validator module as F-01).
- **Risk**: Low — narrow, type-specific fix.
- **Suggested stage**: Stage 7.1, ideally bundled with ENH-01 as one small validator-hardening PR.

### ENH-03 — Deactivate the two stale "Stage1.1" dead-end services
- **Finding ID**: Stage 6 Finding 1, re-confirmed relevant at UAT-08
- **Problem**: `Stage1.1 Service A` and `Stage1.1 Location-Restricted Service A` remain `is_active=true`/`status='published'` (WhatsApp-visible) with zero sub-categories and no resolved template — a dead-end if a real requester selects either.
- **Evidence**: Confirmed via direct DB query in Stage 6 and unchanged as of Stage 7.
- **Impact**: A real WhatsApp requester who selects either service gets stuck with no way to proceed to a sub-category.
- **Recommended change**: Set `is_active=false` (or `status='retired'`) on both — a pure configuration/admin action, no code change.
- **Code vs configuration**: Configuration.
- **Risk**: None (they are confirmed test artifacts, not real business services).
- **Suggested stage**: Immediately, before any pilot — this is a one-click admin fix, not worth deferring.

---

## UX Improvements

### ENH-04 — Resolve the Subject/Description double-ask
- **Finding**: All 7 real production templates ask their own mandatory Subject (text) and Description (textarea) fields, separate from the conversation engine's own auto-generated Subject and captured Description — a requester effectively enters the same information twice.
- **Evidence**: Re-confirmed live in Stage 7 Step 10 — purely repetitive, zero data corruption (the two are stored independently: `requests.title`/`requests.description` vs. `form_data[fieldId]`, never overwritten or conflicting).
- **Recommended options** (per the Stage 7 brief's own framing, presented for a product decision — none implemented here):
  - **Option A — Explicit semantic core-field mapping (recommended)**: introduce a way to mark a template field as "maps to the engine's title" / "maps to the engine's description" (e.g. a `semantic_role` on the field definition), and when present, auto-fill that field from `draft.title`/`draft.description` without asking again. Preserves the Stage 3.1 "no label-guessing" principle exactly (the mapping is explicit, per-field, per-template — never inferred from a label string), while closing the double-ask for any template whose owner opts in.
  - **Option B — Remove the duplicate Subject/Description fields from templates**: simplest, but requires each Service owner to confirm the engine's own generated values are an acceptable substitute for their template's Subject/Description semantics — a content/ownership decision, not a technical one.
  - **Option C — Keep as-is**: only if real UAT (a real pilot, not this stage's simulation) shows requesters aren't actually confused/burdened by it in practice.
- **Code vs configuration**: Option A is code (new field-schema capability) + configuration (each template opts in); Option B is pure configuration; Option C is a decision, not a change.
- **Risk**: Option A — low, additive, opt-in. Option B — low-risk technically, but a real content change each Service owner must approve.
- **Suggested stage**: Stage 7.1 for the technical capability (Option A) if the product decision favors it; otherwise defer to a pilot debrief to gather real user feedback before deciding between B and C.

---

## Search Improvements

### ENH-05 — Sub-category search: no results for "wifi"; no aliasing/synonym support
- **Finding**: Real `searchSubCategories()` testing (Stage 7 Step 8) found "printer"/"print"/"printer issue" all correctly surface printer-related sub-categories, "laptop"/"password"/"salary"/"vendor"/"invoice"/"refund" all work well — but "wifi" returns **zero results** because no WiFi-related sub-category exists under IT Support at all (a content gap, not an algorithm defect).
- **Evidence**: Direct calls to the real search function, documented in `STAGE_7_UAT_RESULTS.md`'s "Search Findings" table. No algorithm change was made or tested this stage.
- **Recommended change**: Two independent tracks — (1) a content review: does IT Support need a WiFi/network-connectivity sub-category? (2) a technical evaluation of aliases/keywords/typo-tolerance/ranking improvements for the search function itself, so near-miss queries (a typo, an abbreviation) still surface the right sub-category.
- **Code vs configuration**: (1) is configuration (add the missing sub-category if warranted); (2) is code, and should be evaluated on real pilot query logs, not synthetic UAT terms, before investing in algorithm changes.
- **Risk**: Low for (1); (2) needs real usage data first to avoid over-engineering against guessed queries.
- **Suggested stage**: (1) immediately if IT confirms the content gap is real; (2) after the pilot, informed by real query logs.

---

## Configuration Cleanup

### ENH-06 — Repoint or retire the 3 dead Business Rules
- **Finding**: Stage 6 Finding 3, unchanged as of Stage 7 — 3 of the org's 4 `business_rules` are flagged active but reference `category_id` values deleted from `service_categories`, so their conditions are permanently unsatisfiable.
- **Recommended change**: For each, either repoint `conditions` to a currently-valid `category_id`, or explicitly disable (`is_active=false`) if no longer needed.
- **Code vs configuration**: Configuration.
- **Risk**: None to fix (they currently do nothing); some risk if repointed carelessly (could start firing against unintended tickets) — should be reviewed by whoever owns IT/HR Support's routing intent.
- **Suggested stage**: Before or alongside the pilot, so assignment behavior during the pilot is intentional rather than accidental.

### ENH-07 — Configure `assignment_rules` or accept default-team-only routing
- **Finding**: Stage 6 Finding 4, unchanged — `assignment_rules` has 0 rows org-wide; every ticket (web or WhatsApp) falls through to the service's default team, unassigned.
- **Recommended change**: A product decision — either configure direct/round-robin/load-balanced assignment for the services in the pilot scope, or explicitly accept "lands in the team queue, a human picks it up" as the intended pilot-phase behavior.
- **Code vs configuration**: Configuration (if rules are added); no code change needed either way — the engine already correctly evaluates whatever is configured (proven by UAT-18c).
- **Risk**: None — purely a configuration decision.
- **Suggested stage**: Before the pilot, scoped to whichever services the pilot will actually use.

### ENH-08 — Staff the remaining default teams
- **Finding**: Stage 6 Finding 5 — only IT Support and HR Support have a staffed default team (3 active members each); Finance, L&D, BD, Legal, and Vendor Creation Support all route to teams with 0 active members.
- **Recommended change**: Add active team members to each, or scope the pilot to IT Support/HR Support only until the others are staffed.
- **Code vs configuration**: Configuration/operational (HR/people action, not a code change).
- **Risk**: None to the system; real operational risk if a pilot ticket lands in an unstaffed team and is never picked up.
- **Suggested stage**: Before the pilot — recommend scoping the initial pilot to IT Support and HR Support specifically for this reason.

### ENH-09 — Fix BD Support's misnamed default team
- **Finding**: Stage 6 Finding 5 — BD Support's `default_team_id` resolves to a team literally named "ADMIN Support," a naming/config mismatch.
- **Recommended change**: Point BD Support at a correctly-named/owned team, or rename the team if it is in fact the intended owner.
- **Code vs configuration**: Configuration.
- **Risk**: None.
- **Suggested stage**: Whenever BD Support enters pilot/production scope.

---

## Operational Hardening

### ENH-10 — Add an injectable `fetchImpl` to `testWhatsAppConnection()`
- **Finding**: Flagged during Stage 7 test-writing (not a correctness bug) — `testWhatsAppConnection()` constructs its `WhatsAppGraphClient` with no injectable `fetchImpl`, unlike the webhook-processing path's pattern, so tests must work around it via global-`fetch` stubbing.
- **Recommended change**: Add an optional `fetchImpl` parameter (or equivalent seam) matching the existing convention used elsewhere in `lib/whatsapp/`.
- **Code vs configuration**: Code, purely a testability improvement — no behavior change.
- **Risk**: None.
- **Suggested stage**: Low-priority housekeeping, any time.

### ENH-11 — Give WhatsApp-created requests a `source_channel`/`created_via` marker
- **Finding**: `lib/rules/run.ts`'s `sourceChannelOf()` has no `'whatsapp'` case, so a WhatsApp-created request never gets `source_metadata.created_via` set — a web-created and a WhatsApp-created ticket are indistinguishable to Business Rules via `source_channel` today.
- **Impact**: Not a bypass (no active rule currently filters on `source_channel`), but blocks any future rule that would want to treat WhatsApp-originated tickets differently (e.g. a different SLA, a different initial queue).
- **Recommended change**: Add a `'whatsapp'` case to `sourceChannelOf()`.
- **Code vs configuration**: Code, small and additive.
- **Risk**: Low — should be reviewed for whether any existing rule's absence of a `source_channel` condition implicitly depends on this gap (Stage 6/7 found none, but worth a final check before shipping).
- **Suggested stage**: Stage 7.1, low priority unless a specific channel-differentiated rule is already planned.

### ENH-12 — Rate limiter remains single-instance (documented, not a new item)
- **Finding**: Re-confirmed unchanged from Stage 6 — `lib/rate-limit.ts` is a deliberate, documented, single-instance in-memory limiter. Fine for the current single-instance deployment; must be replaced (its own comment already says so — Upstash Redis) before any horizontal scaling.
- **Recommended change**: None now; track for the deployment stage that introduces multiple replicas.
- **Code vs configuration**: Code, deferred.
- **Risk**: None today; becomes relevant only at horizontal scale.
- **Suggested stage**: Whenever horizontal scaling is planned — not before.

### ENH-13 — WhatsApp integration visibility in Settings → Integrations
- **Finding**: Raised directly by the user during this stage's live UI review — the existing **Platform Settings → Integrations** tab (which already surfaces "Email Sending") does not currently surface the WhatsApp channel/integration; it is only visible under the separate Admin → Intake → Channels page (gated by the Intake module toggle).
- **Recommended change**: Add a WhatsApp integration card to Platform Settings → Integrations, following the same pattern as the existing "Email Sending" card, so admins have one consistent place to see integration status — being addressed as an immediate follow-up to this stage, outside Stage 7's own test-execution scope.
- **Code vs configuration**: Code (new UI card + read of the same `getWhatsAppChannelReadiness()`/channel data already built in Stage 6).
- **Risk**: Low — additive UI, reuses already-proven data/actions.
- **Suggested stage**: Immediate follow-up (in progress).

---

## Phase-2 Candidates

Unchanged from the original scope boundary — explicitly out of scope for Stage 7 and this plan, listed here only for completeness per the brief's requested structure: My Tickets over WhatsApp, ticket status lookup, agent replies over WhatsApp, approvals over WhatsApp, reopening an existing ticket over WhatsApp, CSAT over WhatsApp, proactive notifications over WhatsApp.

---

## Closed During Stage 7 (for reference — not open backlog items)

- **F-29 (HIGH)** — `awaiting_service` missing self-loop transition, crashing on any invalid first-step reply. Fixed in `lib/conversations/state-machine.ts`; re-verified by a new unit-test block and the re-run UAT-29 attack scenario; full 3× regression clean afterward.
- **F-30 (HIGH)** — config-drift safety net (`sendBackToServiceSelection()`) crashing when triggered from `awaiting_description`. Fixed in the same file (`awaiting_description → awaiting_service` added as a legal transition); re-verified by the re-run UAT-30(b) scenario; full 3× regression clean afterward.
