# STAGE 7 — WHATSAPP UAT PLAN

**This is a TEST PLAN ONLY. No test case in this document has been executed.** It was produced during Stage 6 (see `STAGE_6_REPORT.md`) as a Stage 7 readiness deliverable. Execution requires: real Meta credentials/connectivity, a public HTTPS deployment, the Intake module enabled for the UAT org, and the UAT personas below populated with real mobile numbers — none of which exist in the Stage 6 sandbox. Do not execute any case here until `STAGE_6_REPORT.md`'s Go/No-Go gate is reviewed and the External Prerequisites are satisfied.

Scope stays within the approved Stage 1–6 feature set: Service → issue search → Sub-category → auto Category → Description → auto Subject → template fields → attachment → Review → Create. **No Phase-2 feature** (My Tickets, status lookup, agent replies, approvals, reopen, CSAT, proactive notifications) is in scope for any case below.

---

## UAT Personas

Use dedicated UAT test identities in the target UAT org — not real employees' personal data. Suggested naming: `uat-a@<org>`, etc., with mobiles from a carrier test range agreed with the Meta test number's allowed recipient list.

| ID | Description | Setup |
|---|---|---|
| UAT-A | Registered active employee, mobile present, WhatsApp enabled | Active profile, `mobile_number` set, WhatsApp-eligible flag on |
| UAT-B | Active employee, mobile missing | Active profile, `mobile_number` left null |
| UAT-C | Active employee, WhatsApp explicitly disabled | Active profile, mobile set, WhatsApp-eligible flag off |
| UAT-D | Inactive employee | Profile with `is_active=false`, mobile set (to prove inactivity still blocks WhatsApp use) |
| UAT-E | Admin changes this employee's mobile mid-test | Starts like UAT-A; an admin action re-points `mobile_number` to a second test number during the scenario |
| UAT-F | Same mobile number reused in a second org (tenant isolation) | Mobile number identical to UAT-A's, but the profile belongs to a different `org_id` |

---

## UAT Service Matrix

Selection favors the 7 real production services already audited in Stage 6, adding exactly one isolated UAT-only fixture service for field types absent from real config (radio, multiselect, checkbox/toggle, dedicated `email` type) — per Stage 6's explicit instruction not to fabricate fake production services when a real equivalent exists.

| Matrix need | Service | Why |
|---|---|---|
| Simple service, few sub-categories, no required file | LEGAL Support (10 sub-categories, 3 mandatory fields, no file) | Fastest canonical-journey smoke case |
| Many sub-categories | IT Support (73) or HR Support (72) | Tests sub-category search/selection UX at real scale |
| Mandatory fields, mixed types | FINANCE & ACCOUNTS Support (text, textarea, phone, number, date, all mandatory) or Vendor Creation Support (adds `select`) | Field-collection coverage using real config |
| Required attachment | IT Support, BD Support, FINANCE & ACCOUNTS Support, or Vendor Creation Support (all have a mandatory `file` field) | Proves Stage 5.1's required-file contract on a real, in-use service |
| `select` field | Vendor Creation Support (Bank Name, Company Type, Industry Type) | Only real service with `select` |
| SLA-backed, staffed team (real assignment outcome observable) | IT Support or HR Support (the only 2 of 7 real services with a staffed default team, per Stage 6 Finding 5) | Any other real service will create the ticket correctly but leave it effectively unowned — not useful for observing an assignment outcome |
| Business Rule routing | **None available** — Stage 6 Finding 3 confirmed all "active" business rules in the seed org reference deleted categories and never fire. Either fix/repoint a real rule before this case runs, or add one isolated UAT-fixture rule scoped to a UAT-only sub-category, then delete it after the UAT window closes. | — |
| radio / multiselect / checkbox-toggle / email field types | **UAT-Fixture-Service** (new, isolated, UAT-only — not a real production service) | These 4 types exist nowhere in real production config (Stage 6 Part 8 finding); an isolated fixture is the only way to exercise them without fabricating fake "real" services |

`UAT-Fixture-Service` setup: one active/published service, one sub-category, a template with: one `radio` mandatory field, one `multiselect` mandatory field, one `checkbox`/toggle mandatory field, one `email`-typed mandatory field. Create it explicitly as a UAT fixture (clearly named, e.g. `UAT Fixture — Field Types`), and delete it (or set `is_active=false`) once the UAT window closes — do not leave it as permanent seed data.

**Known pre-existing config issues that WILL surface during UAT unless fixed first** (see `STAGE_6_REPORT.md` Findings 1–5): the 2 stale "Stage1.1" services are still WhatsApp-selectable and dead-end; every real service double-asks Subject/Description; 5 of 7 real services route to an unstaffed team. None of these are UAT blockers by themselves, but testers should be briefed on them in advance so they aren't mistaken for new Stage 7 defects.

---

## Test Cases

Format: **Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence**

### Onboarding / Identity

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-01 | Onboarding | UAT-A eligible | Send "Hi" from UAT-A's number | Welcome + Service selection prompt | New `request_conversations` row, state=service_selection | `requester_id` resolves to UAT-A's profile via `resolveUserByWhatsAppNumber` | ☐ | Screenshot + conversation row |
| UAT-02 | Onboarding | UAT-B (no mobile anywhere in system) | Send "Hi" from an unregistered number | Polite "not recognized" message (rate-limited per Stage 6 Part 24 invalid-sender limiter) | No conversation created | `whatsapp_sender_rejected` audit row | ☐ | Audit log row |
| UAT-03 | Onboarding | UAT-C (WhatsApp disabled) | Send "Hi" | Rejection message, same as UAT-02 | No conversation created | `whatsapp_sender_rejected`, reason=whatsapp_disabled | ☐ | Audit log row |
| UAT-04 | Onboarding | UAT-D (inactive employee) | Send "Hi" | Rejection message | No conversation created | `whatsapp_sender_rejected`, reason=inactive_user | ☐ | Audit log row |

### Service Selection / Issue Search / Sub-category / Category Derivation

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-05 | Service selection | UAT-A, conversation at service_selection | Select "IT Support" | Prompt: describe/search the issue | state=issue_search | conversation `service_id`=IT Support | ☐ | |
| UAT-06 | Issue search | UAT-A, IT Support selected | Type "printer issue" | Matching sub-category list incl. "Printer Issue" | state=sub_category_selection | — | ☐ | |
| UAT-07 | Sub-category / Category derivation | UAT-A | Select "Printer Issue" | Move to Description prompt; Category auto-derived, never asked | state=description | `category_id` auto-set from sub-category mapping, no category question ever sent | ☐ | |
| UAT-08 | Dead-end config (known gap) | UAT-A | Select one of the 2 "Stage1.1" test services at service_selection | Either a graceful "no options" message or a stuck state — document actual behavior | — | Confirms/refutes Stage 6 Finding 1 in a live run | ☐ | |

### Description / Subject / Dynamic Fields

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-09 | Description | UAT-A at description state | Send free-text description | Auto-generated Subject shown/confirmed; then template's own Subject field asked again (known double-ask, Stage 6 Finding 2 — expected, not a defect) | state advances to template fields | `captured_description` set; engine-generated title set | ☐ | |
| UAT-10 | Dynamic fields — text/textarea/phone/number/date | UAT-A, FINANCE & ACCOUNTS Support | Answer each mandatory field in order | Correct next-field prompt each time, correct field label/type validation (e.g. reject non-numeric for Refundable Amount) | All fields captured in `form_data` | Values match template field ids exactly | ☐ | |
| UAT-11 | Dynamic fields — select | UAT-A, Vendor Creation Support | Answer Bank Name / Company Type / Industry Type from the offered options | Only offered options accepted | `form_data` values are exactly the selected option values | — | ☐ | |
| UAT-12 | Dynamic fields — radio/multiselect/checkbox/email | UAT-A, UAT-Fixture-Service | Answer each fixture field | Correct prompt/validation per type; multiselect accepts multiple; email rejects invalid format | `form_data` correctly typed per field | — | ☐ | |

### Required Attachments

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-13 | Required attachment | UAT-A, IT Support (required file field reached) | Send a real small image | Confirmation the file was received/staged | Media downloaded, MIME + magic-byte + size validated, staged in `request-attachments` bucket | `conversation_attachments` row created; field marked satisfied | ☐ | Staged object path |
| UAT-14 | Required attachment — wrong type | UAT-A, same state | Send a disallowed file type or oversized file | Rejection message, re-prompt for a valid file | No staged object created | No `conversation_attachments` row; no crash | ☐ | |
| UAT-15 | Required attachment — Review/Create | UAT-A, after UAT-13, through Review → Create | Confirm Create | Ticket confirmation with request number | Staged object moved/linked to a normal `request_attachments` row | No second Meta download occurs after Create | ☐ | Attachment visible on ticket in DESK web UI |

### Review / Create

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-16 | Review | UAT-A, all fields answered | Reach Review step | Full summary of all captured answers shown before Create | state=review | — | ☐ | |
| UAT-17 | Create | UAT-A, confirms at Review | Send confirmation | Ticket-created confirmation with request number | `createRequestCore()` invoked once | New `requests` row; `intake_channel_id`/provenance set to WhatsApp | ☐ | |

### Assignment / SLA

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-18 | Assignment | UAT-A creates an IT Support ticket | — | — | — | Ticket routes to IT Support's staffed default team (3 active members); no business rule fires (Finding 3) | ☐ | Request assignment field |
| UAT-19 | SLA | UAT-A creates any real-service ticket | — | — | — | Response/resolution due timestamps set per that service's active SLA policy, same as an equivalent web-created ticket | ☐ | SLA due fields |

### Resume / Cancel / Restart / Expiry

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-20 | Resume | UAT-A mid-conversation (e.g. at template fields), goes silent, sends a new message hours later (same day) | Resumes at the exact next question; Subject not regenerated | Same conversation row continues | — | ☐ | |
| UAT-21 | Cancel | UAT-A mid-conversation with a staged attachment | Send "cancel" | Cancellation confirmed | Conversation marked terminal | Staged attachment cleaned up | ☐ | |
| UAT-22 | Restart | UAT-A, after UAT-21 | Send "Hi" again | Starts a clean new flow | Exactly one active conversation, no leftover draft | — | ☐ | |
| UAT-23 | Expiry | UAT-A mid-conversation, waits >24h, sends a new message | Told the previous session expired; starts clean | Old conversation is terminal/expired, not silently continued | Staged attachments from the expired conversation cleaned up | ☐ | |

### Duplicate Delivery / Concurrency

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-24 | Duplicate delivery | UAT-A at Review, taps Confirm; simulate/observe a genuine Meta retry of the same `message.id` (e.g. via Meta's own delivery retry on a slow network) | Only one ticket-created confirmation reaches the user (or a harmless repeat of the same confirmation) | State advances once | Exactly one ticket created for that message.id | ☐ | request_no count |
| UAT-25 | Concurrency | UAT-A sends two messages in very quick succession (e.g. two answers typed back-to-back) | Both processed correctly in order, no corruption | No lost update | Answers reflect both messages correctly, no double state advancement | ☐ | |

### Mobile Change / Inactive-Disabled Requester

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-26 | Mobile change | UAT-E, admin changes User Master mobile mid-conversation | UAT-E's old number sends a message after the change | Old number no longer resolves to UAT-E | Existing conversation on the old number cannot silently continue as UAT-E | New number is immediately authorized to start a fresh conversation as UAT-E | ☐ | |
| UAT-27 | Disabled requester mid-flow | UAT-C-like: admin disables WhatsApp for UAT-A mid-conversation | UAT-A sends the next answer | Rejected/blocked | No further state advancement | `whatsapp_sender_rejected` or equivalent audit row | ☐ | |

### Tenant Isolation

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-28 | Tenant isolation | UAT-F (same mobile number as UAT-A, different org) | Send "Hi" against the second org's WhatsApp channel | Resolves to UAT-F's own org/profile only | Conversation scoped to UAT-F's org | Never resolves to UAT-A's org/profile/data | ☐ | |
| UAT-29 | Cross-org selection tampering | UAT-A mid-conversation | Attempt to replay/craft an interactive selection ID belonging to another org's conversation | Rejected safely | No cross-org state change | Security event logged, no data leak | ☐ | |

### Configuration Drift

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-30 | Config drift | UAT-A mid-conversation on IT Support; admin deactivates IT Support | UAT-A sends next answer | Safe re-prompt or clear abort message — never a stale/invalid ticket | Conversation reconciled safely | No ticket created against a now-invalid service | ☐ | |

### Meta Failures / Webhook Security

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-31 | Outbound failure | Simulate/observe a real Meta 429 or 5xx during an active conversation | Message eventually delivered after bounded retry, or failure surfaced without duplicate state advancement | No duplicate ticket/state change | Failure audited if retries exhaust | ☐ | |
| UAT-32 | Webhook security | Send a POST to the real production webhook URL with an invalid signature (from a non-Meta tool, authorized pentest-style check only) | `401`, request rejected before any processing | No conversation/state change | `whatsapp_invalid_signature` audit row | ☐ | |

### Audit Logging / Admin Configuration

| Test ID | Area | Preconditions | WhatsApp input/action | Expected WhatsApp response | Expected DESK state | Expected DB/business result | Pass/Fail | Evidence |
|---|---|---|---|---|---|---|---|---|
| UAT-33 | Audit logging | After running UAT-01 through UAT-25 | — | — | — | Every event type (processed, rejected, unsupported, rate limited, channel not found, invalid signature, status event, attachment failure, send failure, test connection) has at least one real row in Admin → Audit Log for this run | ☐ | Audit log export |
| UAT-34 | Admin configuration | Admin opens Admin → Intake → Channels → the UAT WhatsApp channel → Readiness | — | — | — | Panel shows `Meta connection verified: YES` with real `display_phone_number`, webhook health = `ok`, correct mobile-coverage count for the UAT org | ☐ | Screenshot |

---

## Go/No-Go Gate

Classification legend: **BLOCKER** (Stage 7 cannot begin until resolved) · **HIGH** (should be resolved before Stage 7, but a single scoped exception can be granted in writing) · **MEDIUM** (track, does not block Stage 7) · **LOW** (cosmetic/nice-to-have) · **EXTERNAL PREREQUISITE** (outside DESK's code, required before any real-Meta case can run).

| # | Item | Classification | Status after Stage 6 |
|---|---|---|---|
| 1 | Ticket duplication possible | BLOCKER if found | Not found — idempotency/concurrency suite clean |
| 2 | Tenant isolation failure | BLOCKER if found | Not found — tenant-isolation suite clean |
| 3 | Mandatory field can be bypassed | BLOCKER if found | Not found — zero mandatory fields are `requester_can_set=false` |
| 4 | Required attachment can be bypassed | BLOCKER if found | Not found — Stage 5.1 contract re-proven |
| 5 | Invalid webhook accepted | BLOCKER if found | Not found — signature verification fails closed |
| 6 | Wrong user / wrong org resolved | BLOCKER if found | Not found |
| 7 | `createRequestCore()` bypassed | BLOCKER if found | Not found — single business-logic path confirmed |
| 8 | Real Meta connection unverified | EXTERNAL PREREQUISITE | NO — no outbound internet in Stage 6 sandbox; code path implemented + simulated |
| 9 | Real webhook handshake unverified | EXTERNAL PREREQUISITE | NO — no public HTTPS endpoint available; code path implemented + simulated |
| 10 | Real WhatsApp message unverified | EXTERNAL PREREQUISITE | NO — same constraint |
| 11 | Intake module disabled for target org | EXTERNAL PREREQUISITE | Confirmed disabled in the dev/seed org — must be enabled for the UAT org before Test Case 1 runs |
| 12 | 0% employee mobile coverage | HIGH | Must populate at least the 6 UAT personas' mobiles before execution |
| 13 | 2 stale Stage1.1 services WhatsApp-visible, no sub-categories | HIGH | Recommend deactivating before UAT; otherwise brief testers (see UAT-08) |
| 14 | Subject/Description double-ask on all 7 real templates | MEDIUM | By design (Stage 3.1); a real UX finding for Service owners, not a UAT blocker |
| 15 | 3 of 4 business rules dead (deleted category references) | MEDIUM | Pre-existing, not WhatsApp-specific; affects web tickets equally |
| 16 | `assignment_rules` empty org-wide | MEDIUM | Pre-existing; means Test Case UAT-18's "assignment" is really "falls through to default team" |
| 17 | 5 of 7 services route to unstaffed teams | MEDIUM | Prefer IT Support/HR Support (staffed) for cases where a real assignment outcome matters |
| 18 | BD Support default team misnamed "ADMIN Support" | LOW | Cosmetic config error, independent of WhatsApp |
| 19 | No radio/multiselect/checkbox/email field type in real config | LOW | Covered instead by the isolated `UAT-Fixture-Service` |

**READY FOR STAGE 7: YES**, conditioned on External Prerequisites (8–11) being satisfied by an operator outside this sandbox, and HIGH items (12–13) being addressed or explicitly accepted in writing before execution begins. No BLOCKER was found. **This gate covers readiness for controlled UAT only — it is not a production-rollout gate.**
