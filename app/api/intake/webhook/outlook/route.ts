import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secureCompare } from '@/lib/secure-compare'
import { getSecret } from '@/lib/secrets'
import { firstDelivery, sharedRateLimited } from '@/lib/security/shared-limits'

const REPLAY_WINDOW_SECONDS = 24 * 60 * 60
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

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const notifications = (body as Record<string, unknown>)?.value as Array<{
    changeType?: string
    resourceData?: { id?: string }
    subscriptionId?: string
    clientState?: string
  }> | undefined

  if (!notifications?.length) return NextResponse.json({ ok: true })
  if (await sharedRateLimited('outlook-webhook', 600, 60)) return NextResponse.json({ ok: true })

  const workerUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = getSecret('intake_worker')
  if (!workerUrl || !workerSecret) return NextResponse.json({ ok: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any }

  for (const notification of notifications) {
    // Only process new messages; skip updates/deletes.
    if (notification.changeType !== 'created') continue
    const messageId = notification.resourceData?.id
    if (!messageId) continue

    // Verify clientState matches our webhook token (not the worker secret).
    if (!notification.clientState || !secureCompare(notification.clientState, webhookToken)) continue

    // the same notification delivered again is not forwarded twice (VAPT-042)
    if (!(await firstDelivery(`outlook:${notification.subscriptionId ?? ''}:${messageId}`, REPLAY_WINDOW_SECONDS))) continue

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

    // Forward to worker for Graph API sync. Fire and forget.
    fetch(`${workerUrl}/intake/graph-sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-intake-worker-secret': workerSecret,
      },
      body: JSON.stringify({
        channelId: channel.id,
        graphMessageId: messageId,
      }),
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
