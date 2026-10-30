import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secureCompare } from '@/lib/secure-compare'
import { getSecret } from '@/lib/secrets'
import { verifyGoogleOidc } from '@/lib/intake/google-oidc'
import { firstDelivery, sharedRateLimited } from '@/lib/security/shared-limits'
import { logger } from '@/lib/observability/logger'
import { forgetDelivery, forwardToWorker, intakeWorkerTarget, readCappedBody } from '@/lib/intake/webhook-forward'

// A delivery older than this is not acted on (Pub/Sub retries with back-off well inside it); a repeat of the same message id is dropped (VAPT-042).
const MAX_AGE_MS = 60 * 60 * 1000
const REPLAY_WINDOW_SECONDS = 24 * 60 * 60
// A Pub/Sub push is well under a kilobyte; this is only the upper limit while reading (G-08/G-09).
const MAX_BODY_BYTES = 64 * 1024

// POST /api/intake/webhook/gmail?token=<INTAKE_WEBHOOK_TOKEN>
//
// Receives Google Cloud Pub/Sub push notifications when Gmail delivers new mail
// to a connected mailbox. Pub/Sub wraps the Gmail notification in:
//   { message: { data: base64(JSON), messageId, publishTime }, subscription }
// where data decodes to { emailAddress: string, historyId: string }.
//
// We authenticate via the token query param that is appended to the push
// subscription URL when it's created in Google Cloud Console.
//
// Uses a token dedicated to this public URL (INTAKE_WEBHOOK_TOKEN), not
// INTAKE_WORKER_SECRET — that secret also grants full worker-admin access
// (send email as the org, trigger reclassification, etc. — see
// api/src/intake/routes.ts) and query strings routinely end up in
// proxy/CDN access logs and Referer headers, so it shouldn't double as a
// URL token. Falls back to INTAKE_WORKER_SECRET/CRON_SECRET if the
// dedicated one isn't set yet, so existing deployments keep working until
// they rotate to a separate value.
//
// Response codes: once the token is verified, a bad or duplicate push is answered
// 200 (retrying it would only create noise). A push that is VALID but could not be
// handed to the worker (worker missing, down or slow) is answered 5xx, so Pub/Sub
// keeps it and re-sends it with back-off instead of the mail being lost (G-07).

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const secret = getSecret('intake_webhook')
  if (!secret || !token || !secureCompare(token, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any }

  // Google's own signature (GMAIL_PUSH_OIDC_AUDIENCE and GMAIL_PUSH_OIDC_EMAIL): the shared token in the URL alone can be copied from a log, the signed token
  // cannot. Once a Gmail channel exists it is REQUIRED (G-30): without it anybody who learns the URL token could make the server act on invented notifications.
  // With no Gmail channel there is nothing to protect yet. GMAIL_PUSH_ALLOW_TOKEN_ONLY=true is the explicit, logged way to keep running on the shared token alone.
  const audience = process.env.GMAIL_PUSH_OIDC_AUDIENCE
  const pushEmail = process.env.GMAIL_PUSH_OIDC_EMAIL
  if (audience && pushEmail) {
    const check = await verifyGoogleOidc(req.headers.get('authorization'), { audience, email: pushEmail })
    if (!check.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  } else if (process.env.GMAIL_PUSH_ALLOW_TOKEN_ONLY !== 'true') {
    const { data: anyGmail } = await admin.from('intake_channels').select('id').eq('type', 'email').eq('provider', 'gmail').limit(1)
    if (anyGmail && anyGmail.length > 0) {
      logger.error({ event: 'intake.gmail_webhook_oidc_missing', message: 'A Gmail channel exists but GMAIL_PUSH_OIDC_AUDIENCE / GMAIL_PUSH_OIDC_EMAIL are not set, so Gmail push notifications are refused (503). Set both, or set GMAIL_PUSH_ALLOW_TOKEN_ONLY=true to accept the shared token alone.', route: 'api/intake/webhook/gmail' })
      return NextResponse.json({ error: 'push authentication is not configured' }, { status: 503 })
    }
  }

  // The caller is authenticated from here on; a flood of valid-looking deliveries still cannot cost more than this many database lookups a minute.
  // 429 (not 200): Pub/Sub retries with back-off, so a delivery that was only over the limit is not lost.
  if (await sharedRateLimited('gmail-webhook', 600, 60)) return NextResponse.json({ error: 'too many requests' }, { status: 429 })

  // No worker to hand the notification to: an error status makes Pub/Sub keep and re-send it (a 200 lost the mail for good).
  if (!intakeWorkerTarget()) {
    logger.error({ event: 'intake.gmail_webhook_worker_missing', message: 'A Gmail notification arrived but INTAKE_WORKER_URL / the worker secret is not configured; answering 503 so it is retried.', route: 'api/intake/webhook/gmail' })
    return NextResponse.json({ error: 'worker not configured' }, { status: 503 })
  }

  // The size limit is applied while the body is read, not from Content-Length (missing on a chunked request) and not after req.json() has read it all.
  const read = await readCappedBody(req, MAX_BODY_BYTES)
  if (!read.ok) return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(read.text) } catch { return NextResponse.json({ ok: true }) }

  const message = (body as Record<string, unknown>)?.message as Record<string, string> | undefined
  if (!message?.data) return NextResponse.json({ ok: true })

  // replay window
  const published = message.publishTime ? Date.parse(message.publishTime) : NaN
  if (Number.isFinite(published) && Date.now() - published > MAX_AGE_MS) return NextResponse.json({ ok: true })

  let payload: { emailAddress?: string; historyId?: string }
  try {
    payload = JSON.parse(Buffer.from(message.data, 'base64').toString())
  } catch {
    return NextResponse.json({ ok: true })
  }

  const { emailAddress, historyId } = payload
  if (!emailAddress || !historyId) return NextResponse.json({ ok: true })

  // Find the active gmail channel for this email address using the admin client
  // (no RLS needed here — the token already authenticates the request).
  const { data: channel } = await admin
    .from('intake_channels')
    .select('id, org_id')
    .eq('type', 'email')
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .filter('config->>user', 'eq', emailAddress)
    .maybeSingle()

  if (!channel) return NextResponse.json({ ok: true })

  // A repeat of the same Pub/Sub message is dropped (VAPT-042). The mark is made before the hand-over and taken back if the hand-over fails, so Pub/Sub's
  // retry of a notification that did NOT reach the worker is still acted on.
  const deliveryKey = message.messageId ? `gmail:${message.messageId}` : null
  if (deliveryKey && !(await firstDelivery(deliveryKey, REPLAY_WINDOW_SECONDS))) return NextResponse.json({ ok: true })

  // Hand it to the worker for the Gmail API sync and wait for the answer. A failure is answered with an error status so Pub/Sub re-sends it.
  const sent = await forwardToWorker('/intake/gmail-sync', { channelId: channel.id, historyId })
  if (!sent.ok) {
    if (deliveryKey) await forgetDelivery(deliveryKey)
    logger.error({ event: 'intake.gmail_forward_failed', message: 'A Gmail notification could not be handed to the intake worker; answering 503 so Pub/Sub retries.', route: 'api/intake/webhook/gmail', context: { reason: sent.reason } })
    return NextResponse.json({ error: 'worker unavailable' }, { status: 503 })
  }

  return NextResponse.json({ ok: true })
}
