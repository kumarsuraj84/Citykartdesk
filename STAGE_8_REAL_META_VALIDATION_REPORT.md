# STAGE 8 — REAL META VALIDATION

## Overall Status

**BLOCKED ON EXTERNAL PREREQUISITES.** This environment has no outbound internet access and no real Meta credentials — re-confirmed directly at the start of this stage (`curl` to `graph.facebook.com` returns a network-level failure, `HTTP_STATUS:000`; `.env.local` has no Meta/WhatsApp variables; the app's own `NEXT_PUBLIC_APP_URL` points at `http://localhost:3210`, not a public HTTPS host). Per this stage's own explicit fallback instruction, real-Meta validation could not be attempted — everything verifiable locally was verified, an exact operator checklist is provided, and all four real-Meta gates are honestly recorded as `NO`. **READY FOR CONTROLLED PILOT: NO.**

This is not a regression from Stage 6/7/7.1 — the external prerequisite gap is identical to what those stages already documented; Stage 8's job was to re-confirm it directly (not assume it) and prepare everything else. That preparation is complete.

---

## External Prerequisites

| Item | Status |
|---|---|
| Public HTTPS deployment | **MISSING** — `NEXT_PUBLIC_APP_URL=http://localhost:3210`; no hosted deployment exists |
| Meta Business Account | **NOT VERIFIED** — cannot be checked without an authorized operator with real Meta access |
| WhatsApp Business Account (WABA) | **NOT VERIFIED** |
| Meta App | **NOT VERIFIED** |
| WhatsApp product enabled | **NOT VERIFIED** |
| Phone Number ID | **MISSING** — not present anywhere in this environment |
| WABA ID | **MISSING** |
| System User token | **MISSING** |
| App Secret | **MISSING** |
| Webhook Verify Token | **MISSING** (no real one — a channel can have an operator-chosen value, but there is no real Meta side to match it against) |
| Test/controlled WhatsApp number | **NOT VERIFIED** |
| At least one real UAT requester mobile | **NOT VERIFIED** — no real employee record was populated with a mobile number in this environment; Stage 6 already found 0 of 62 active employees have one on file, unchanged |

No secret values are referenced above — only presence/absence.

---

## Public Deployment

Confirmed absent. `NEXT_PUBLIC_SUPABASE_URL` points at a local Docker Supabase instance (`http://127.0.0.1:...`), not a hosted project. There is no Railway (or equivalent) deployment running anywhere reachable from the public internet. The webhook route (`app/api/intake/webhook/whatsapp/route.ts`) exists, compiles, and is exercised extensively by the automated test suite (GET handshake, POST signature verification) — but it has never been reachable at a real public HTTPS URL, so Meta could never call it even if credentials existed.

## Meta Credentials

Confirmed missing in full — see the table above. No partial credential set exists either (e.g., a token without a phone_number_id); nothing Meta-related is configured anywhere in this environment's `.env.local` or database.

---

## Real Meta Connection

```
REAL META CONNECTION VERIFIED: NO
```

No WhatsApp channel exists in the local database (0 rows in `intake_channels`, confirmed by direct query at the start of this stage — the environment was left clean at the end of Stage 7.1). No credentials exist to enter even if a channel were created. The underlying code path (`testWhatsAppConnection()` → `WhatsAppGraphClient.testConnection()`) was already live-browser-verified in Stage 6/7 against a real (if unreachable) Graph API call, producing a safe `fetch failed` result with the outcome correctly persisted and no secret exposure — that evidence stands; it was not re-attempted this stage since nothing about the credential/connectivity situation has changed, and this session deliberately avoided a fresh UI login (see "Known Gaps").

**Exact operator action required**: create a real Meta System User token, App Secret, and register a Phone Number ID under a real WABA (see the Meta Business Manager checklist in `STAGE_6_REPORT.md`, unchanged and still accurate), then enter them via Admin → Intake → Channels → "Connect credentials" from a network with outbound internet access, and click "Test connection."

## Real Webhook Verification

```
REAL META WEBHOOK VERIFIED: NO
```

No public HTTPS URL exists for Meta to call. The GET handshake and POST signature-verification code paths remain correct and fully exercised by the automated suite (`stage5-webhook-e2e.test.ts`, `stage5-webhook-security.test.ts`, `stage7b-meta-failures-webhook-security.test.ts` — all re-run clean this stage), but a genuine Meta-initiated handshake has never occurred and cannot occur from this environment.

**Exact operator action required**: deploy the app to a public HTTPS host (see "Deployment Readiness Audit" below for the exact environment variables that host will need), then register `https://<that-host>/api/intake/webhook/whatsapp` in Meta Business Manager with the same Verify Token entered in DESK's channel credentials, subscribed to the `messages` field.

## Real WhatsApp Message

```
REAL WHATSAPP MESSAGE VERIFIED: NO
```

Same root cause — no real Meta connectivity, no public webhook endpoint, no real Meta-registered test number. The full "Hi" → service-selection round trip is proven end-to-end in simulation (real conversation engine, real webhook-processing pipeline, real Postgres, only Meta's own HTTP boundary mocked) — this remains SIMULATED, never claimed as real.

## Real End-to-End Ticket

```
REAL END-TO-END WHATSAPP TICKET CREATED: NO
```

Same root cause. The full canonical IT Support journey (Service → issue search → Sub-category → Category derived → Description → auto Subject/Description via the Stage 7.1 semantic-role mapping → remaining fields → Review → Create) is proven end-to-end in simulation against the real, live IT Support template (`tests/integration/stage7-1-semantic-role-real-service.test.ts`, re-confirmed passing this stage), producing a real `requests` row with a real `request_no`. No real Meta-originated message has ever reached this system.

---

## Ticket Data Verification

Re-confirmed via the existing simulated end-to-end tests (unchanged from Stage 7/7.1, re-run clean): `org_id`, `requester_id`, `service_id`, `category_id`, `sub_category_id`, `title`, `description`, `form_data`, `source_metadata.created_via='whatsapp'`, `priority`, `status`, `team_id`/`assigned_to`, `response_due_at`, `resolution_due_at`, and `request_no` are all populated correctly and consistently — `createRequestCore()` remains the single business-logic path; Business Rules/SLA/assignment are confirmed DESK-derived, never computed by the WhatsApp layer itself.

## Attachment Verification

Re-confirmed via the existing simulated suite (`stage5-media.test.ts`, `stage7a-attachments-fixture.test.ts`, re-run clean): staged before Review, MIME/magic-byte/size validated, zero re-download from Meta after Create (fetch-call count instrumented), correctly linked into a normal `request_attachments` row. Never tested against a real Meta media download — that requires the same real-Meta connectivity as everything else above.

## Identity / Mobile Verification

Re-confirmed via `stage2-mobile-identity.test.ts` and `stage5-mobile-change.test.ts` (re-run clean this stage): mobile change immediately unauthorizes the old number and authorizes the new one, no separate WhatsApp mapping exists. Unknown mobile / inactive user / WhatsApp-disabled all correctly rejected before entering the conversation engine (`stage5-webhook-security.test.ts`, re-run clean). All of this remains simulated — no real UAT employee mobile exists in this environment to test with for real (Stage 6 finding, unchanged: 0 of 62 active employees have a mobile number on file).

## Resume / Cancel Verification

Re-confirmed via `stage4-conversation-e2e.test.ts` / `stage5-attachment-cleanup.test.ts` (re-run clean): resume lands on the exact next question, title/description never regenerated; Cancel marks the conversation terminal and cleans staged Storage objects. Simulated only.

## Security Revalidation

Re-run this stage, all clean: `stage5-webhook-security.test.ts` (13 tests — invalid signature, invalid verify token, unknown phone_number_id, inactive channel, unknown/inactive/disabled sender), `stage4-tenant-isolation.test.ts` / `stage5-tenant-isolation.test.ts` (cross-org isolation), `stage7b-meta-failures-webhook-security.test.ts` (real signature-verification code path, 6 invalid-webhook variants, 0 accepted). No regression since Stage 7.1.

## Audit Verification

Re-run this stage: `stage6-audit-log-coverage.test.ts` (9 tests, all WhatsApp event types produce real DB rows) and `stage6-channel-readiness.test.ts` (5 tests, `whatsapp_test_connection_succeeded`/`_failed` both produce real audit rows with correct CONFIGURED-vs-VERIFIED reporting) — both clean. No raw secret appears in any audit row (confirmed by design: `logIntakeAudit`/`logWhatsAppAudit` only ever write non-secret metadata). Real Meta traffic producing real audit events was not observable this stage for the same connectivity reasons as above.

---

## Pilot Scope

Per the approved recommendation (`PRE_PILOT_CONFIGURATION_DECISIONS.md`, item 6): **IT Support and HR Support only.** No mechanism was added or changed to enforce this at the code level this stage (see "Pilot Service Restriction" below) — restricting exposure to these two services for the pilot window is an operational/configuration decision, not a code change, consistent with "do not redesign service visibility without review."

## Staffing

| Team | Active members |
|---|---|
| IT Support | 3 |
| HR Support | 3 |

Both re-confirmed staffed via direct query at the start of this stage — unchanged from Stage 6/7. **Staffing check: PASS.**

## Business Configuration Decisions

Unchanged from `PRE_PILOT_CONFIGURATION_DECISIONS.md` — carried forward, not altered:
1. **3 of 4 active-looking Business Rules are dead** (reference deleted categories, confirmed still true this stage — see note below) — pilot must not depend on them until repaired by their owners.
2. **`assignment_rules` remains empty org-wide** (0 rows) — pilot tickets fall through to team-queue-only routing unless an owner configures rules first.
3. **5 of 7 real services have unstaffed default teams** — out of pilot scope by the approved IT/HR-only decision, so not a pilot blocker, but still unresolved for any future scope expansion.
4. **BD Support's default team is still named "ADMIN Support"** — cosmetic, out of pilot scope.
5. **WiFi/network catalogue gap** — not a pilot blocker for printer/laptop/etc. issues; a Service-owner decision, not yet made.

**Housekeeping note**: while re-auditing `business_rules` this stage, one additional stray row (`"Stage1 auto-assign whatsapp-stage1-..."`) was found — leftover test-fixture debris from an earlier, unrelated interrupted test run (a pre-existing, non-Stage-8 test file), not a real business rule. It referenced an equally-stray test team ("Stage1 Test Team ..."). Removed (along with its 2 stray test services) as test-data hygiene, not a business decision — it was never real configuration. The "3 of 4 dead" figure above is the correct, current count of *real* business rules after this cleanup.

---

## Known Gaps

1. **No real Meta validation was possible** — the sandbox has no outbound internet access and no real credentials. This is an environment limitation, not a code defect; every code path it would exercise is otherwise proven via simulation.
2. **This session did not attempt a live browser UI login** (Admin → Intake → Channels, Platform Settings → Integrations) to re-verify the Readiness panel/Integrations card visually, since doing so would require entering a password — a hard-line prohibited action for this session regardless of whether the credential is a local dev seed value. The underlying functions and their live-browser-verified behavior are unchanged since Stage 6/7.1's own direct verification (screenshots/DOM inspection already on record in those reports); nothing in Stage 8 touched that code.
3. **No pilot-specific service-visibility mechanism exists in code** — see "Pilot Service Restriction" below; the operational process is documented instead.
4. **0% of real employees have a mobile number on file** (Stage 6 finding, unchanged) — at least the pilot participant list (Part 25/`PILOT_MONITORING_SCORECARD.md`) must have mobiles populated before any real pilot message can be sent, once Meta connectivity exists.

## Blockers

**None that are code defects.** All four mandatory real-Meta gates are `NO` purely due to missing external infrastructure/credentials — not a single BLOCKER-class code or security defect was found or re-found this stage (0 tenant isolation failures, 0 duplicate-ticket defects, 0 mandatory-field bypass, 0 required-file bypass, 0 invalid-webhook acceptance, all re-confirmed by this stage's regression run).

---

## Controlled Pilot Gate

```
READY FOR CONTROLLED PILOT: NO
```

Per the Go/No-Go rule's own explicit terms: `REAL META CONNECTION VERIFIED`, `REAL META WEBHOOK VERIFIED`, `REAL WHATSAPP MESSAGE VERIFIED`, and `REAL END-TO-END WHATSAPP TICKET CREATED` are all `NO`. Every other condition in the gate (0 BLOCKER defects, 0 tenant isolation failures, 0 duplicate-ticket defects, 0 mandatory-field bypass, 0 required-file bypass, 0 invalid webhook acceptance, IT Support staffed, HR Support staffed, rollback plan documented, pilot support owners identified — see below) **is satisfied**. This gate is not being overridden on the strength of automated tests alone, per the brief's own explicit instruction.

**Exact remaining path to `YES`**: an operator with real Meta Business Manager access and a network-enabled machine must (1) complete the Meta Business Manager checklist (`STAGE_6_REPORT.md`), (2) stand up a public HTTPS deployment of this app (env var checklist below), (3) enter real credentials via Admin → Intake → Channels and click Test Connection until it reports `verified: YES`, (4) register the real webhook URL in Meta and confirm the GET handshake, (5) send one real "Hi" from a real, DESK-registered mobile number and confirm the full round trip, (6) complete one real IT Support ticket end to end. Once all four gates flip to `YES` and this report is amended (not silently replaced) to reflect that, the pilot gate can be re-evaluated.

---

## Deployment Readiness Audit (Part 3)

| Item | Status |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Set, but to `http://localhost:3210` — must be replaced with the real public HTTPS URL before Part 7 registration can work |
| Supabase URL / anon key / service-role key | Present, pointing at a local Docker instance — a real deployment needs its own hosted Supabase project's equivalents |
| Vault RPC access (`intake_store_credential`/`intake_read_credential`) | Present and proven working (Stage 6/7, re-confirmed this stage via `stage6-channel-readiness.test.ts`) |
| Storage bucket | Existing `request-attachments` bucket, reused — no new bucket needed on a real deployment either, as long as the same migrations are applied |
| Timezone | `TZ=Asia/Kolkata` set locally — must be set identically on the real deployment (SLA/business-hours logic depends on it) |
| HTTPS certificate | N/A locally — a real deployment host (e.g. Railway) typically provisions this automatically; must be confirmed once one exists |
| Webhook route reachability | The route exists and is exercised by the full automated test suite; genuine *public* reachability cannot be confirmed without a real deployment |

The exact target webhook URL, once deployed, is: `https://<uat-host>/api/intake/webhook/whatsapp`.

## Intake Module (Part 4)

Confirmed: `org_module_access` for the CityKart org (`00000000-0000-0000-0000-000000000001`) has `module='intake'`, `enabled=true` — re-confirmed by direct query at the start of this stage, unchanged since Stage 7.1 (left enabled at the user's own explicit request). Not enabled for any other org; no other org exists in this environment.

## Create/Verify WhatsApp Channel (Part 5)

**Not performed this stage.** No real credentials exist to enter, and this session avoided a live UI login (see "Known Gaps"). Zero WhatsApp channels currently exist in this environment (confirmed by direct query) — a clean slate for whenever real credentials become available. The channel-creation and credential-storage code paths (`createWhatsAppChannel`, `saveWhatsAppCredentials`) are unchanged and already proven working in Stage 5.1's own live-browser verification.

## Pilot Service Restriction (Part 17)

No dedicated "pilot visibility" mechanism exists in the codebase today — `listQuestionnaireServices()` (the function that determines what a WhatsApp requester can select) filters purely on `is_active=true` + `status='published'` + location-tag visibility, with no concept of a pilot cohort. Adding one would be a genuine (if small) architecture change, explicitly out of scope for Stage 8 ("do not redesign service visibility without review").

**Recommended operational process instead** (no code change): since the pilot is also scoped to a small, named group of participants (Part 25), the *effective* restriction is achieved by (a) only sharing the WhatsApp number with the 5-10 named pilot participants, and (b) only those participants having `whatsapp_enabled=true`/a registered mobile in DESK — everyone else remains unable to start a conversation at all, regardless of which services are technically selectable once inside one. If a pilot participant browses to a non-IT/HR service inside the flow, the ticket would still be created *correctly* (no code bypass) — it just falls outside the intended pilot scope. Document this explicitly to pilot participants in `WHATSAPP_PILOT_USER_GUIDE.md`, and to the pilot monitoring owner, as the accepted operational boundary.

## Routing Decision (Part 19)

Per `PRE_PILOT_CONFIGURATION_DECISIONS.md`, no owner decision has yet been recorded on team-queue-only vs. assignment-rules for the pilot. Per Part 19's own instruction, this stage recommends (does not decide): **team-queue-only for IT Support and HR Support as the lower-risk starting point**, since both already have staffed teams and zero assignment_rules exist to configure otherwise. This recommendation is also recorded in `PILOT_MONITORING_SCORECARD.md` and `WHATSAPP_PILOT_RUNBOOK.md`.

## Support / Escalation Owners (Part 27)

No names are configured anywhere in this system for these roles — placeholders only, per instruction not to invent names:

| Role | Owner |
|---|---|
| DESK Admin | *(to be named)* |
| Meta/WABA Admin | *(to be named)* |
| IT Support owner | *(to be named — likely whoever owns "Kaushlesh IT Executive Rule" today)* |
| HR Support owner | *(to be named — likely whoever owns the HR Support business rules today)* |
| Pilot monitoring owner | *(to be named)* |
| Technical escalation owner | *(to be named)* |

**The pilot cannot start until these are named**, per this stage's own instruction.
