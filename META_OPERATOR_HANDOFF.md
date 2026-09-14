# META OPERATOR HANDOFF

For whoever has (or can get) access to a real Meta Business Manager account and a network-enabled machine. No secret values are provided or requested in this document — every step tells you what to create in Meta and where to type the result into DESK, never what the value should be.

---

## What You Need to Create in Meta

Do these in order, in [Meta Business Manager](https://business.facebook.com) and the [Meta for Developers](https://developers.facebook.com) console:

1. **Confirm/create a Meta Business Account** — the umbrella account everything else lives under.
2. **Confirm/create a WhatsApp Business Account (WABA)** — this is what gets a phone number attached to it.
3. **Create or select a Meta App** — Meta for Developers → My Apps → Create App (Business type).
4. **Enable the WhatsApp product** on that App — App Dashboard → Add Product → WhatsApp.
5. **Register a controlled/test phone number** under that WABA — this should be a number your organization controls specifically for this pilot, not a real employee's personal number.
6. **Note the Phone Number ID and WABA ID** — both are shown in the WhatsApp → API Setup screen once the number is registered. You'll need both later.
7. **Create a System User** — Business Settings → Users → System Users → Add. This is the identity DESK will authenticate as.
8. **Grant that System User access to the WhatsApp asset** (the WABA/App you just set up) — Business Settings → System Users → [your user] → Add Assets.
9. **Generate a long-lived access token** for that System User with the WhatsApp messaging permission (`whatsapp_business_messaging`) — System Users → Generate Token.
10. **Obtain the App Secret** — App Dashboard → Settings → Basic → App Secret (click "Show").
11. **Choose a Webhook Verify Token** — this one you invent yourself; it's a shared secret between you and DESK, not something Meta generates. Pick something long and random, store it the same way you'd store a password.

## What Values Must Be Copied Into DESK

Once you have all of the above, log into DESK as an admin and go to:

```
Admin → Intake → Channels → New Channel → WhatsApp
```

Enter:
- **Display Name** — anything descriptive, e.g. "WhatsApp Pilot"
- **Phone Number ID** — from step 6
- **WABA ID** — from step 6

Click **Create**, then on that new channel click **Connect Credentials** and enter:
- **Access Token** — from step 9
- **App Secret** — from step 10
- **Webhook Verify Token** — from step 11

These are stored encrypted in Supabase Vault, never in plain text, never in source code, never in an environment variable, and never visible again in the UI after you save them (only "leave blank to keep current" placeholders show on re-open).

## The Exact Webhook Callback URL

Once your DESK deployment has a real public URL (see `UAT_DEPLOYMENT_HANDOFF.md` if that doesn't exist yet), the callback URL to register in Meta is exactly:

```
https://<your-uat-host>/api/intake/webhook/whatsapp
```

Register this in Meta: App Dashboard → WhatsApp → Configuration → Webhook → Edit → paste the URL and the same Verify Token you chose in step 11.

## Which Webhook Field to Subscribe To

In that same Webhook Configuration screen, subscribe to the **`messages`** field. No other field is required by the current implementation — do not subscribe to fields DESK doesn't use.

## How to Run Test Connection

Back in DESK: Admin → Intake → Channels → your new channel → click **Test Connection**. A real success shows `display_phone_number` and `verified_name` and the channel's Readiness panel will read **"Meta connection verified: YES"**. A failure shows a safe, generic error (never your token) — if it fails, double-check the Phone Number ID and Access Token are exactly right, and that the System User's token hasn't expired.

Only **Activate** the channel (the Play button) after Test Connection succeeds.

## How to Send the First Real "Hi"

From a phone with an active WhatsApp installation and a number that's already registered in DESK's User Master (Admin → Users → that person → mobile number field, 10 digits, no `+91`) with **WhatsApp** turned on for them: message the real WhatsApp number you registered in step 5 with the word **"Hi"**. You should get a welcome message with a list of Services within a few seconds.

## How to Capture Evidence

For your own records (and for whoever reviews pilot readiness afterward), safely capture:
- A screenshot of the Test Connection success (Readiness panel showing "Meta connection verified: YES")
- A screenshot of the real WhatsApp conversation (your phone, showing the actual message exchange)
- The resulting ticket number in DESK
- A screenshot or export of the relevant Admin → Audit Log rows (`whatsapp_test_connection_succeeded`, `whatsapp_message_processed`, etc.)

**Never** screenshot or share the Access Token, App Secret, or Verify Token themselves — none of the evidence above requires showing them.
