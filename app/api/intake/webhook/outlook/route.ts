import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secureCompare } from '@/lib/secure-compare'
import { getSecret } from '@/lib/secrets'
import { firstDelivery, sharedRateLimited } from '@/lib/security/shared-limits'
import { logger } from '@/lib/observability/logger'
import { forgetDelivery, forwardToWorker, intakeWorkerTarget, readCappedBody } from '@/lib/intake/webhook-forward'

const REPLAY_WINDOW_SECONDS = 24 * 60 * 60
// A real notification batch is a few kilobytes; this is only the upper limit while reading (G-08/G-09).
const MAX_BODY_BYTES = 256 * 1024
const MAX_NOTIFICATIONS = 100
// Microsoft's validation token is a short opaque string. Only that shape is echoed back (VAPT-042): the endpoint cannot be used to reflect arbitrary text.
// (Microsoft's real token reads like "Validation: Testing client application reachability for subscription Request-Id: <guid>", so spaces and colons are allowed.)
const VALIDATION_TOKEN_SHAPE = /^[A-Za-z0-9 ._~+=:/-]{1,512}$/
function echoValidationToken(token: string): NextResponse {
  if (!VALIDATION_TOKEN_SHAPE.test(token)) return new NextResponse('Bad Request', { status: 400 })
  return new NextResponse(token, { status: 200, headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } })
}

// POST /api/intake/webhook/outlook?token=<INTAKE_WEBHOOK_TOKEN>
// GET  /api/intake/webhook/outlook?validationToken=...   (Microsoft subscription validation)
//
// Receives Microsoft Graph change notifications when a new message arrives in a
// connected M365 mailbox. Microsoft sends a validation GET before activating the
// subscription — we echo the token back as text/plain.
//
// Notification body:
//   { value: [{ changeType, resource, resourceData: { id }, subscriptionId, clientState }] }
//
// clientState is the INTAKE_WEBHOOK_TOKEN we passed when creating the
// subscription, so we can verify the push came from Microsoft (not a
// spoofed request). Deliberately NOT the same value as INTAKE_WORKER_SECRET
// (used only for the outbound x-intake-worker-secret header below) — that
// secret grants full worker-admin access, and this one sits in a public URL
// query string / gets echoed back by Microsoft, which routinely ends up in
// proxy/CDN logs and Referer headers.

export async function GET(req: NextRequest) {
  // Microsoft subscription validation handshake.
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return echoValidationToken(validationToken)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  // The shared value is no longer carried in the URL (it would sit in proxy and access logs and in Microsoft's subscription record): Graph sends it back inside
  // every notification as clientState, and each one is checked below (VAPT-030). An older subscription that still has ?token= in its address keeps working.
  const webhookToken = getSecret('intake_webhook')
  if (!webhookToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Microsoft Graph also sends a validationToken in some POST scenarios (the subscription handshake carries no clientState).
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return echoValidationToken(validationToken)

  // Limited BEFORE the body is read: clientState is inside the body, so until it is checked a caller is unknown, and an unknown caller must not be able to
  // make this server read and parse large bodies without limit.
  if (await sharedRateLimited('outlook-webhook', 600, 60)) return NextResponse.json({ error: 'too many requests' }, { status: 429 })

  // No worker to hand the notification to: say so with an error status, so Microsoft keeps the notification and tries again later. A 200 here lost the mail
  // for good (it was never picked up and the sender believed it was delivered).
  if (!intakeWorkerTarget()) {
    logger.error({ event: 'intake.outlook_webhook_worker_missing', message: 'An Outlook notification arrived but INTAKE_WORKER_URL / the worker secret is not configured; answering 503 so it is retried.', route: 'api/intake/webhook/outlook' })
    return NextResponse.json({ error: 'worker not configured' }, { status: 503 })
  }

  // The size limit is applied while the body is read (a chunked request has no Content-Length, and req.json() would read it all first).
  const read = await readCappedBody(req, MAX_BODY_BYTES)
  if (!read.ok) return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(read.text) } catch { return NextResponse.json({ ok: true }) }

  const notifications = (body as Record<string, unknown>)?.value as Array<{
    changeType?: string
    resourceData?: { id?: string }
    subscriptionId?: string
    clientState?: string
  }> | undefined

  if (!Array.isArray(notifications) || !notifications.length) return NextResponse.json({ ok: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any }

  let failed = false
  for (const notification of notifications.slice(0, MAX_NOTIFICATIONS)) {
    // Only process new messages; skip updates/deletes.
    if (notification.changeType !== 'created') continue
    const messageId = notification.resourceData?.id
    if (!messageId) continue

    // Verify clientState matches our webhook token (not the worker secret).
    if (!notification.clientState || !secureCompare(notification.clientState, webhookToken)) continue

    // Find the channel for this subscription.
    const { data: channel } = await admin
      .from('intake_channels')
      .select('id, org_id, config')
      .eq('type', 'email')
      .eq('provider', 'm365')
      .eq('status', 'active')
      .filter('config->>graph_subscription_id', 'eq', notification.subscriptionId ?? '')
      .maybeSingle()

    if (!channel) continue

    // the same notification delivered again is not forwarded twice (VAPT-042). The mark is made before the hand-over (so two simultaneous deliveries cannot both
    // forward) and taken back below if the hand-over fails, so a notification that did not reach the worker can still be retried.
    const deliveryKey = `outlook:${notification.subscriptionId ?? ''}:${messageId}`
    if (!(await firstDelivery(deliveryKey, REPLAY_WINDOW_SECONDS))) continue

    // Hand it to the worker for the Graph API sync and WAIT for the answer (it used to be fire-and-forget, so a lost call lost the mail silently).
    const sent = await forwardToWorker('/intake/graph-sync', { channelId: channel.id, graphMessageId: messageId })
    if (!sent.ok) {
      failed = true
      await forgetDelivery(deliveryKey)
      logger.error({ event: 'intake.outlook_forward_failed', message: 'An Outlook notification could not be handed to the intake worker; answering 503 so Microsoft retries.', route: 'api/intake/webhook/outlook', context: { reason: sent.reason } })
    }
  }

  // Microsoft retries the whole batch; the notifications that did go through are recognised as repeats and skipped.
  if (failed) return NextResponse.json({ error: 'worker unavailable' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
