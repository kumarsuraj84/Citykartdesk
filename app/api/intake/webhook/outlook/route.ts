import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secureCompare } from '@/lib/secure-compare'

// POST /api/intake/webhook/outlook?token=<INTAKE_WORKER_SECRET>
// GET  /api/intake/webhook/outlook?validationToken=...   (Microsoft subscription validation)
//
// Receives Microsoft Graph change notifications when a new message arrives in a
// connected M365 mailbox. Microsoft sends a validation GET before activating the
// subscription — we echo the token back as text/plain.
//
// Notification body:
//   { value: [{ changeType, resource, resourceData: { id }, subscriptionId, clientState }] }
//
// clientState is the INTAKE_WORKER_SECRET we passed when creating the subscription,
// so we can verify the push came from Microsoft (not a spoofed request).

export async function GET(req: NextRequest) {
  // Microsoft subscription validation handshake.
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const secret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!secret || !token || !secureCompare(token, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Microsoft Graph also sends a validationToken in some POST scenarios.
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const notifications = (body as Record<string, unknown>)?.value as Array<{
    changeType?: string
    resourceData?: { id?: string }
    subscriptionId?: string
    clientState?: string
  }> | undefined

  if (!notifications?.length) return NextResponse.json({ ok: true })

  const workerUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!workerUrl || !workerSecret) return NextResponse.json({ ok: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any }

  for (const notification of notifications) {
    // Only process new messages; skip updates/deletes.
    if (notification.changeType !== 'created') continue
    const messageId = notification.resourceData?.id
    if (!messageId) continue

    // Verify clientState matches our secret.
    if (!notification.clientState || !secureCompare(notification.clientState, secret)) continue

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
