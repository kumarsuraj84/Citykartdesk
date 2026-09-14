# WHATSAPP PILOT — OPERATIONAL RUNBOOK

For whoever operates the WhatsApp channel day to day during the controlled pilot (IT Support + HR Support only). No secret values appear in this document — every check below uses the app's own UI or the Audit Log, never a raw credential.

---

## Daily Checks (5 minutes)

Do these once a day while the pilot is live:

1. **Is the channel active?** Admin → Intake → Channels → find the WhatsApp channel → confirm status badge reads **active**, not *paused*. A paused channel silently stops receiving messages — Meta will retry briefly, then give up.
2. **Is Meta connection still verified?** Same page → click the **Readiness** button (or check **Platform Settings → Integrations**, which shows the same status) → confirm **"Meta connection verified: YES"** with a recent **"Last tested"** timestamp. If it says NO or the timestamp looks stale (days old), click **Test Connection** to refresh it.
3. **Is webhook health OK?** Same Readiness panel → **Webhook health** should read **OK**. **"Errors detected"** means recent signature/channel-resolution failures — check the Audit Log (below) for the specific rows.
4. **Any send failures?** Admin → Audit Log → filter for `whatsapp_send_failed`. A small number of transient ones (429/5xx that eventually recover) are normal and self-heal within the same request; a cluster of them, or the same conversation ID appearing more than once, is worth investigating.
5. **Any attachment failures?** Audit Log → filter for `whatsapp_attachment_link_failed`. Each one means a pilot user's photo/file didn't make it onto their ticket — worth a manual follow-up with that requester.
6. **Any sender rejections?** Audit Log → filter for `whatsapp_sender_rejected`. During the pilot, this should only ever be pilot participants who mistyped something or aren't yet registered — anything else (an unrecognized number entirely) may mean word of the pilot number spread beyond the intended group.

## Where to Check

| What | Where |
|---|---|
| Channel status, credentials, Test Connection | Admin → Intake → Channels |
| Quick at-a-glance status (Configured vs. Verified, webhook health, mobile coverage) | Platform Settings → Integrations |
| Every WhatsApp event (processed, rejected, failed, etc.) | Admin → Audit Log — filter by action starting with `whatsapp_` |
| Active/stuck conversations | `request_conversations` table (via a database admin) — filter by `state` |
| Created tickets | Normal DESK ticket list — filter by source, or check `source_metadata.created_via = 'whatsapp'` |

## Common Failures and What They Mean

| Symptom | Likely cause | What to do |
|---|---|---|
| "Meta auth expired" / Test Connection suddenly fails after previously working | The System User access token expired or was revoked in Meta Business Manager | Generate a new token in Meta, re-enter it via "Connect credentials," re-test |
| Channel shows `phone_number_id` mismatch errors | The registered Phone Number ID in DESK no longer matches what Meta has on file (e.g. number re-registered) | Confirm the correct Phone Number ID in Meta Business Manager, update it in DESK's channel config |
| `whatsapp_invalid_signature` rows appearing | Either the App Secret in DESK doesn't match Meta's, or something is calling the webhook that isn't really Meta | Re-check the App Secret matches exactly; if it's already correct and rows keep appearing, treat as a possible probing attempt and note it for the technical escalation owner |
| `whatsapp_channel_not_found` / `whatsapp_channel_conflict` rows | An inbound message arrived for a `phone_number_id` DESK doesn't recognize (wrong number registered, or a second channel accidentally created with the same number) | Confirm only one WhatsApp channel exists with the expected Phone Number ID |
| `whatsapp_sender_rejected` for someone who should be recognized | Their mobile number in DESK (User Master) doesn't exactly match what they're messaging from, or their profile is inactive / WhatsApp-disabled | Check their profile's mobile number field and active/WhatsApp-enabled flags |
| Media/attachment failures | Meta's media download failed, or the file didn't pass MIME/size checks | Ask the requester to resend; if it keeps failing for the same file type, check the allowed MIME list |
| Outbound send failures | Transient Meta-side issue (429/5xx) — the app retries automatically a couple of times within the same request | If persistent, check Meta's own status page; the conversation state itself is never lost even if a message fails to deliver |
| A conversation stuck in "submitting" indefinitely | A rare edge case (a crash during ticket creation) — deliberately not auto-recovered, to avoid ever risking a duplicate ticket | Check whether a ticket was actually created for that requester before doing anything; if not, the requester can safely send a new message to restart |
| Meta's webhook verification (or every real inbound message) fails, and hitting the webhook URL directly in a browser/curl redirects to a login page instead of a plain error | A Stage 8.1 defect (now fixed) where the app's session gate wasn't exempting the WhatsApp webhook route the way it already exempted the Gmail/Outlook ones | Confirm the deployed build includes the `proxy.ts` fix — `curl -i https://<host>/api/intake/webhook/whatsapp` should return `403 Forbidden`, never a `/login` redirect (see `UAT_DEPLOYMENT_HANDOFF.md`'s reachability check) |

## Safe Actions an Operator Can Take

- **Pause** the channel (Admin → Intake → Channels) if something looks wrong and you want to stop new inbound messages while investigating. This does not delete anything.
- **Re-run Test Connection** any time — it's read-only against Meta, safe to run as often as needed.
- **Check the Audit Log** — always safe, read-only.
- **Update credentials** via "Connect credentials" if a token needs rotating — leave fields blank to keep the current value for anything you're not changing.

## What NOT to Do

- Do not delete `request_conversations` or `intake_audit_log` rows to "clean up" — they're the only record of what happened for a given requester.
- Do not delete a created ticket to undo a mistake — correct or close it through the normal ticket workflow instead.
- Do not share the pilot WhatsApp number outside the named pilot group without the pilot monitoring owner's sign-off (see `WHATSAPP_PILOT_USER_GUIDE.md` / support-owner list in `STAGE_8_REAL_META_VALIDATION_REPORT.md`).

---

## Rollback Plan

If the pilot needs to stop (planned or emergency):

1. **Pause/deactivate the WhatsApp intake channel** (Admin → Intake → Channels → Pause). This immediately stops new inbound messages from being processed.
2. **Preserve all conversations and audit records** — do not delete `request_conversations`, `conversation_events`, or `intake_audit_log` rows. They're the evidence trail for whatever prompted the rollback.
3. **Do not delete any created tickets** — every real ticket created during the pilot is a genuine DESK request and should be handled through the normal ticket lifecycle (resolved, closed, or reassigned), never deleted.
4. **Stop new WhatsApp conversations** — pausing the channel (step 1) achieves this; any conversation already in progress at the moment of pause will simply not receive a further response until the channel is reactivated (no data is lost — it will resume normally once reactivated, or lazily expire after 24h if left alone).
5. **Continue the normal DESK web channel without interruption** — nothing about pausing WhatsApp affects the web portal, Email Intake, or any other channel.
6. **Investigate before reactivating** — determine root cause (see "Common Failures" above) before turning the channel back on. Reactivation is the same Pause/Activate toggle, reversible at any time.

This is a **pause-and-preserve** rollback, never a delete. Nothing about a rollback should ever require deleting data.
