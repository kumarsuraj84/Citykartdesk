# STAGE 8.1 — EXTERNAL PREREQUISITE CLOSURE

## Status

**BLOCKED ON EXTERNAL PREREQUISITES, ONE REAL CODE DEFECT FOUND AND FIXED.** No deployment credentials (Railway, hosted Supabase) and no Meta credentials exist in this environment — re-confirmed directly. Neither could be closed this stage. However, while auditing "network reachability" for the webhook route (Part 3), this stage found and fixed a genuine, previously-undiscovered defect: **the app's own session-auth proxy was redirecting every unauthenticated call to `/api/intake/webhook/whatsapp` — including from Meta itself — to `/login` instead of letting it reach the route handler.** This would have made real Meta webhook verification fail in *any* real deployment, entirely independent of the missing external credentials. It is fixed, tested, and regression-proven. `READY FOR CONTROLLED PILOT` remains **NO** — purely on the still-missing external prerequisites, not on this defect (which no longer exists).

---

## Public HTTPS Deployment

```
PUBLIC HTTPS DEPLOYMENT VERIFIED: NO
```

No deployment credentials (Railway account/token, hosted Supabase project) are available in this environment — confirmed: `railway` CLI is not installed/authenticated, `.env.local` has no hosted Supabase URL (only a local Docker instance), and `NEXT_PUBLIC_APP_URL` is `http://localhost:3210`. Per Part 1's audit: this repository already has a complete, established deployment pattern (`docs/RAILWAY-DEPLOYMENT.md`, `Dockerfile`, `railway.toml`, health check at `/api/health`) — **no second deployment architecture was invented**. The existing pattern is correct and sufficient; it simply requires a human operator with real Railway/Supabase account access to execute, exactly as that doc's own opening line states ("Do the account creation, login, and secret-entry steps yourself... an AI assistant should never see your Supabase DB password, service-role key, or Railway tokens"). See `UAT_DEPLOYMENT_HANDOFF.md` for the exact steps.

**What WAS verified locally** (the closest available proxy for "network reachability" testing): `GET /api/health` → `{"status":"ok","db":"ok","latency_ms":69,...}`. `GET /api/intake/webhook/whatsapp` → (after the fix below) `403 Forbidden` from the route's own verification logic, not a redirect. `POST /api/intake/webhook/whatsapp` with an empty body → `200 {"ok":true}` (the documented malformed-payload behavior). All three are exactly the responses a real deployment should also produce once it's actually reachable — the *logic* is proven; only the *public reachability* remains unverified.

### Real Defect Found and Fixed: Webhook Route Was Session-Gated

**Finding**: `proxy.ts` (this app's Next.js middleware-equivalent) gates every route behind a Supabase session check by default, with an exact-match allowlist (`PUBLIC_API_ROUTES`) for routes that "authenticate themselves" instead (cron jobs, Gmail/Outlook webhooks, health check) — its own comment explicitly names the reason: these callers "carry no Supabase session cookie." **`/api/intake/webhook/whatsapp` was missing from that allowlist.** Meta's real webhook calls never carry a session cookie either — so both the GET verification handshake and the POST inbound-message delivery would have been intercepted and 307-redirected to `/login` before ever reaching the route's own signature/token checks.

**Reproduced directly** against the local dev server, before the fix:
```
curl -i http://localhost:3210/api/intake/webhook/whatsapp
HTTP/1.1 307 Temporary Redirect
location: /login?next=%2Fapi%2Fintake%2Fwebhook%2Fwhatsapp
```

**Fixed**: added `/api/intake/webhook/whatsapp` to `PUBLIC_API_ROUTES` in `proxy.ts`, with the comment updated to explicitly name Meta's WhatsApp Cloud API alongside the other non-session callers already documented there.

**Re-verified after the fix**:
```
GET  /api/intake/webhook/whatsapp  → 403 Forbidden (the route's own verifyWebhookChallenge rejecting missing hub.mode/hub.verify_token — correct)
POST /api/intake/webhook/whatsapp  → 200 {"ok":true} (the route's own malformed-payload handling — correct, no /login redirect)
```

**New regression test** (`tests/unit/proxy-public-routes.test.ts`, 3 tests): asserts `/api/intake/webhook/whatsapp` is never redirected; asserts every other documented public route stays exempt too (the whole allowlist, not just the one fix); and asserts an ordinary protected route (`/api/admin/audit`) *still* redirects — proving the fix didn't turn into an accidental blanket bypass.

**Why this was never caught before**: every prior stage's webhook testing called `processWhatsAppWebhookPayload()` directly, or hit the route handler in a test context — neither path goes through the actual Next.js middleware layer. No test anywhere in the suite exercised `proxy.ts` itself before this stage's new file. This is a genuine, real BLOCKER-class defect for real Meta connectivity that has now been closed at the code level, independent of the deployment/credential gaps that remain.

**Regression**: `npx vitest run tests/unit` and `tests/integration` (excluding the one-shot `stage7a-*.test.ts` files, per Stage 7's established documented exclusion) — **3 consecutive clean passes**, 37/37 unit files and 46/46 integration files each pass, 0 failures. `npx tsc --noEmit` clean. `npm run lint` clean.

---

## UAT Database

Schema completeness re-confirmed by direct query against the local instance (the same schema a hosted UAT Supabase project would get from `npx supabase db push`): `profiles`, `services`, `requests`, `request_attachments`, `intake_channels`, `intake_audit_log`, `request_conversations`, `conversation_events`, `conversation_attachments` — all present. Vault RPCs `intake_store_credential`/`intake_read_credential` — both present. No hosted UAT Supabase project exists to push this same schema to; that requires a real operator (see `UAT_DEPLOYMENT_HANDOFF.md`).

## UAT Storage

```
UAT ATTACHMENT STORAGE VERIFIED: YES (local instance)
```

`request-attachments` bucket confirmed present, `public=false` (correct — access is via unguessable UUID paths + service-role, never public listing). A live server-side upload → download → delete cycle was performed against it directly and succeeded cleanly. This verifies the storage *mechanism* works correctly; a real hosted UAT project needs the same migrations applied to get this same bucket — not a new bucket, not new policies (per `STAGE_6_REPORT.md`'s deployment checklist, unchanged).

## UAT Org / Intake

Confirmed: `org_module_access` for the CityKart org has `module='intake'`, `enabled=true` — unchanged since Stage 7.1, not enabled for any other org (none exists). No hosted UAT org exists yet to enable this for; the same one-row `UPDATE`/`INSERT` this local instance already has would apply there too, once it exists.

## Pilot Users

**Not created this stage.** Part 9 asks for "5-10 users... dedicated UAT identities." This stage deliberately did **not** fabricate placeholder pilot participants with invented mobile numbers — a synthetic "UAT Pilot User 1...6" with a made-up phone number can never actually receive a real WhatsApp message, and recording them as "configured" would misrepresent real pilot readiness. This mirrors Part 10's own instruction not to invent names, applied to the same underlying problem: **real pilot participants need to be real, named people with real mobile numbers, chosen by the business.**

**What IS ready, mechanically**: the exact schema/process for adding one is simple and already proven (Stage 2/Stage 7 test suite exercises it extensively): set an existing employee profile's `mobile_number` to their real 10-digit number (no `+91`, e.g. `9876543210`) and `whatsapp_enabled=true`, `is_active=true`. Meta senders arrive as `+919876543210`/`919876543210`-shaped identifiers and are normalized to the bare 10-digit form internally (`lib/users/resolveWhatsAppUser.ts`, unchanged, still covered by `stage2-mobile-identity.test.ts`) — no additional mapping step is needed. Once 5-10 real pilot participants are named (by the business, per Part 10's process), applying this to their profiles is a 2-minute Admin → Users edit per person, not a code or migration task.

**Stage 6 finding, unchanged**: 0 of 62 active employees currently have any mobile number on file — so this genuinely starts from zero, not from an existing-but-unconfirmed pool.

## Pilot Services

Re-confirmed unchanged: IT Support and HR Support are both `is_active=true`, `status='published'`, template-resolvable (real templates, semantic-role-mapped per Stage 7.1), and staffed:

| Team | Active members |
|---|---|
| IT Support | 3 |
| HR Support | 3 |

**Pilot Service Restriction**: no dedicated pilot-visibility mechanism exists in code, and none was added this stage (per explicit instruction not to redesign service visibility). The accepted operational boundary — documented in `WHATSAPP_PILOT_USER_GUIDE.md` — is that only the named pilot participants will have `whatsapp_enabled=true` and know the pilot number; anyone technically able to reach the flow can browse to any published service, but only the intended 5-10 people can start a conversation at all.

## Pilot Owners

Unchanged from Stage 8 — none provided this stage either. Per explicit instruction, **not invented**:

| Role | Owner |
|---|---|
| DESK Admin | TBD |
| Meta/WABA Admin | TBD |
| IT Support owner | TBD |
| HR Support owner | TBD |
| Pilot monitoring owner | TBD |
| Technical escalation owner | TBD |

---

## Meta Business Manager

No authorized human operator with real Meta access participated in this stage — none of the 11 checklist items in `META_OPERATOR_HANDOFF.md` could be attempted, let alone completed. All recorded as:

```
1. Confirm/create Meta Business Account       — NOT COMPLETE
2. Confirm/create WABA                        — NOT COMPLETE
3. Create/select Meta App                     — NOT COMPLETE
4. Enable WhatsApp product                    — NOT COMPLETE
5. Register controlled/test phone number      — NOT COMPLETE
6. Obtain Phone Number ID / WABA ID           — NOT COMPLETE
7. Create System User                         — NOT COMPLETE
8. Grant WhatsApp asset access                — NOT COMPLETE
9. Generate long-lived access token           — NOT COMPLETE
10. Obtain App Secret                         — NOT COMPLETE
11. Choose a webhook Verify Token             — NOT COMPLETE
```

See `META_OPERATOR_HANDOFF.md` for the exact, detailed steps.

## Real Channel Configuration

Not performed — no real credentials exist to enter. `intake_channels` has 0 rows in this environment (confirmed clean start). The credential-entry and Vault-storage mechanism itself is unchanged and already proven (Stage 5.1's own live-browser verification, Stage 6/7's automated coverage) — nothing about it needed re-verification this stage.

## Real Meta Connection

```
REAL META CONNECTION VERIFIED: NO
```

No credentials exist. Re-confirmed connectivity is still absent: `curl` to `graph.facebook.com` returns a network-level failure (no route to host), unchanged since Stage 6.

## Real Meta Webhook

```
REAL META WEBHOOK VERIFIED: NO
```

No public HTTPS deployment exists for Meta to call. **Important distinction**: this gate remaining `NO` is now purely about missing infrastructure (no public URL, no real Meta App to register a callback in) — the proxy.ts defect that would have *additionally* broken this even with a public URL has been fixed this stage.

## Real WhatsApp Message

```
REAL WHATSAPP MESSAGE VERIFIED: NO
```

Same root cause as above.

## Real End-to-End Ticket

```
REAL END-TO-END WHATSAPP TICKET CREATED: NO
```

Same root cause. The full canonical journey remains proven only in simulation (unchanged from Stage 7/7.1/8) — `tests/integration/stage7-1-semantic-role-real-service.test.ts`, re-run clean this stage, against the real, live IT Support template.

---

## Attachment (Real)

Not applicable — no real inbound message exists yet. The mechanism (staging → validation → linking, no re-download) remains proven only in simulation; re-confirmed clean this stage's regression run.

## Ticket Data Audit (Real)

Not applicable for the same reason. The field-by-field consistency guarantee (`form_data`, `source_metadata.created_via='whatsapp'`, SLA/priority/assignment all DESK-derived) remains proven only in simulation.

## Security

Re-run this stage as part of the full regression: webhook signature verification, verify-token checks, tenant isolation, sender rejection — all clean, no regression. The proxy.ts fix was itself verified not to weaken security: the new test explicitly asserts an ordinary protected route (`/api/admin/audit`) still redirects unauthenticated visitors — the allowlist stayed an allowlist, not a blanket bypass.

## Audit Events

Re-confirmed via regression (`stage6-audit-log-coverage.test.ts`, `stage6-channel-readiness.test.ts`): all WhatsApp audit event types, including `whatsapp_test_connection_succeeded`/`_failed`, produce real rows with no raw secret ever recorded. No real Meta traffic exists yet to generate a genuinely real-world instance of these.

## Monitoring Baseline

Current baseline, recorded before any real pilot traffic exists:

| Metric | Baseline value |
|---|---|
| Pilot participants configured | 0 |
| Active WhatsApp-enabled users (org-wide) | 0 |
| Existing `request_conversations` | 1 (a pre-existing, terminal-`expired` fixture row from `stage4-expiry.test.ts`, harmless, unrelated to any pilot) |
| WhatsApp-created tickets (`source_metadata.created_via='whatsapp'`) | 0 real ones; several simulated-test ones exist transiently during test runs and are cleaned up as part of each test's own lifecycle |
| `whatsapp_send_failed` rows | 0 outside of test runs |
| `whatsapp_attachment_link_failed` rows | 0 outside of test runs |

This baseline should be re-captured once real pilot participants are named and their profiles configured, and again immediately before the pilot officially starts, so pre-pilot test/validation traffic is never confused with real pilot activity.

## Rollback Readiness

The Pause/Activate control (Admin → Intake → Channels) exists, is unchanged, and was already exercised in Stage 5.1's own live-browser verification (pausing a real, UI-created channel correctly made it unresolvable to `findActiveWhatsAppChannelByPhoneNumberId()`). No real channel exists in this environment right now to re-test the control against without fabricating one — the control itself is proven; there is nothing new to disrupt.

---

## Remaining External Actions

Everything below requires a human operator with real credentials this session does not have:

1. Complete the Meta Business Manager checklist (`META_OPERATOR_HANDOFF.md`).
2. Stand up the public HTTPS UAT deployment (`UAT_DEPLOYMENT_HANDOFF.md`).
3. Name the 6 pilot support/escalation owners (Part 10).
4. Name and configure 5-10 real pilot participants with real mobile numbers (Part 9) — mechanically trivial once named.
5. Create the real DESK WhatsApp channel and run a real Test Connection, once 1-2 exist.
6. Register the real webhook URL in Meta and confirm the handshake.
7. Send and verify one real "Hi" and one real end-to-end IT Support ticket.

---

## Controlled Pilot Gate

```
READY FOR CONTROLLED PILOT: NO
```

`REAL META CONNECTION VERIFIED`, `REAL META WEBHOOK VERIFIED`, `REAL WHATSAPP MESSAGE VERIFIED`, and `REAL END-TO-END WHATSAPP TICKET CREATED` all remain `NO` — purely on missing external infrastructure and credentials, not on any known code defect (the one found this stage is fixed). Pilot users and pilot owners also remain unconfigured, both by design (not invented) rather than by omission. Every condition this stage *could* control — 0 BLOCKER defects, IT/HR staffing, rollback control availability, schema/storage completeness — is satisfied.
