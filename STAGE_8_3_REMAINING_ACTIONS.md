# STAGE 8.3 — REMAINING ACTIONS

Nothing from `STAGE_8_2_OPERATOR_ACTIONS.md` has been completed yet — this is the same list, not a new one. Work through it there in full detail (cross-referencing `UAT_DEPLOYMENT_HANDOFF.md` and `META_OPERATOR_HANDOFF.md`). Once any of the following becomes true, a re-verification pass can confirm it and move the corresponding gate to `YES`:

1. **A public UAT deployment exists** (Railway + hosted Supabase) — nothing else in this list can be verified until this is done, since every later step depends on having a real, reachable host.
2. **The Intake module is enabled for that UAT org.**
3. **At least one real, named pilot participant** has a real mobile number and `whatsapp_enabled=true` in that UAT deployment.
4. **The six pilot owner roles are named** (DESK Admin, Meta/WABA Admin, IT Support owner, HR Support owner, pilot monitoring owner, technical escalation owner).
5. **Meta Business Manager setup is complete** (Business Account, WABA, App, WhatsApp product, test number, System User, token, App Secret, Verify Token).
6. **A real DESK WhatsApp channel is created and its credentials connected.**
7. **Test Connection succeeds against real Meta.**
8. **The webhook is registered in Meta and the real GET handshake succeeds.**
9. **The channel is activated** (only after 7 and 8 both succeed).
10. **A real "Hi" is sent and one real IT Support ticket is completed end to end.**

Nothing on this list requires a Railway token, Supabase password/service-role key, Meta access token, App Secret, or Verify Token to be shared with this AI session — every verification step only needs a non-secret outcome reported back (a URL, an HTTP status, a "verified: YES/NO," a masked mobile number, a ticket number).
