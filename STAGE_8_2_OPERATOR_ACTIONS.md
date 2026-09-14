# STAGE 8.2 — REMAINING OPERATOR ACTIONS

Every item below requires a human with real account access — none of it can be done from this session. This is a consolidated, ordered checklist across the two detailed handoff documents already produced (`UAT_DEPLOYMENT_HANDOFF.md`, `META_OPERATOR_HANDOFF.md`, both from Stage 8.1, both still fully accurate and not repeated here in full) plus the two business decisions that were never a technical task to begin with. Work top to bottom — later steps depend on earlier ones.

## 1. Deploy the UAT Environment
Full detail: `UAT_DEPLOYMENT_HANDOFF.md`.
- [ ] Create a dedicated hosted Supabase UAT project (not production).
- [ ] Push migrations (`npx supabase db push`) and seed reference data.
- [ ] Deploy this repo to Railway using the existing `railway.toml`/`Dockerfile`.
- [ ] Set the Railway environment variables (Supabase URL/keys, `NEXT_PUBLIC_APP_URL`, `TZ`, `CRON_SECRET`).
- [ ] Confirm `GET https://<uat-host>/api/health` → `200 {"status":"ok","db":"ok"}`.
- [ ] Confirm `GET https://<uat-host>/api/intake/webhook/whatsapp` → `403 Forbidden`, **never** a redirect to `/login`. (This re-verifies the Stage 8.1 `proxy.ts` fix made it into the deployed build.)

## 2. Enable the Intake Module for the UAT Org Only
- [ ] `UPDATE org_module_access SET enabled = true WHERE org_id = '<uat-org-id>' AND module = 'intake';` — the UAT org only, never production.

## 3. Name the Pilot Owners (business decision, not a technical task)
- [ ] DESK Admin
- [ ] Meta/WABA Admin
- [ ] IT Support owner
- [ ] HR Support owner
- [ ] Pilot monitoring owner
- [ ] Technical escalation owner

## 4. Identify Real Pilot Participants (business decision)
- [ ] Choose 5-10 real, named pilot participants (start with at least 1 for initial Meta validation).
- [ ] For each: set their DESK profile's `mobile_number` (10 digits, no `+91`) and `whatsapp_enabled = true`, confirm `is_active = true`.

## 5. Complete Meta Business Manager Setup
Full detail: `META_OPERATOR_HANDOFF.md`.
- [ ] Meta Business Account
- [ ] WhatsApp Business Account (WABA)
- [ ] Meta App with WhatsApp product enabled
- [ ] Controlled/test phone number registered, Phone Number ID + WABA ID noted
- [ ] System User created, granted WhatsApp asset access
- [ ] Long-lived access token generated
- [ ] App Secret obtained
- [ ] A Webhook Verify Token chosen

## 6. Create the Real DESK WhatsApp Channel
- [ ] Admin → Intake → Channels → New Channel → WhatsApp — enter Display Name, Phone Number ID, WABA ID.
- [ ] Connect Credentials — enter Access Token, App Secret, Verify Token (stored in Vault; never re-displayed).

## 7. Run Test Connection
- [ ] Click Test Connection. Must show `display_phone_number`/`verified_name` and "Meta connection verified: YES" before continuing.

## 8. Register the Webhook in Meta
- [ ] Callback URL: `https://<uat-host>/api/intake/webhook/whatsapp`, same Verify Token as step 6.
- [ ] Subscribe to the `messages` field only.
- [ ] Confirm Meta's GET handshake succeeds (not a redirect to `/login` — if it redirects, the deployed build is missing the Stage 8.1 fix; redeploy from the current `main`/latest code).

## 9. Activate the Channel
- [ ] Only after steps 7 and 8 both succeed — Admin → Intake → Channels → Activate.

## 10. Send the First Real "Hi" and Complete One Real IT Support Ticket
- [ ] From the pilot participant's real phone, message the real number: "Hi".
- [ ] Walk one real IT Support ticket to completion (issue search → sub-category → description → remaining fields → attachment if applicable → Review → Create).
- [ ] Verify the resulting ticket in DESK's normal UI.

## 11. Update the Pilot Documents With Real Facts
- [ ] `WHATSAPP_PILOT_USER_GUIDE.md` — the real pilot WhatsApp number.
- [ ] `WHATSAPP_PILOT_RUNBOOK.md` — the real UAT host, channel display name, named owners.
- [ ] `PILOT_MONITORING_SCORECARD.md` — named owners.

## 12. Re-run Stage 8.2's Validation Once the Above Is Done
Once steps 1-10 are genuinely complete, ask for a Stage 8.2 (or later) re-evaluation — the report can then honestly move each `NO` to `YES` as each is actually verified, and only then can the Controlled Pilot Gate be re-assessed.

---

**Nothing above should be sent to or requested by an AI assistant** — no Railway token, Supabase password/service-role key, Meta access token, App Secret, or Verify Token. Every step above only asks for a **non-secret outcome** to be reported back (a URL, a status code, a "verified: YES/NO," a name) — never the credential itself.
