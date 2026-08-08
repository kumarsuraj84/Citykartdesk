import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/intake/webhook/gmail?token=<INTAKE_WORKER_SECRET>
//
// Receives Google Cloud Pub/Sub push notifications when Gmail delivers new mail
// to a connected mailbox. Pub/Sub wraps the Gmail notification in:
//   { message: { data: base64(JSON), messageId, publishTime }, subscription }
// where data decodes to { emailAddress: string, historyId: string }.
//
// We authenticate via the token query param that is appended to the push
// subscription URL when it's created in Google Cloud Console.
//
// Security: Always return 200 OK (even for bad requests) once the token is
// verified. Pub/Sub interprets non-2xx as delivery failures and will retry,
// which creates noise. We swallow bad/duplicate pushes silently.

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const secret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const message = (body as Record<string, unknown>)?.message as Record<string, string> | undefined
  if (!message?.data) return NextResponse.json({ ok: true })

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as unknown as { from: (t: string) => any }
  const { data: channel } = await admin
    .from('intake_channels')
    .select('id, org_id')
    .eq('type', 'email')
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .filter('config->>user', 'eq', emailAddress)
    .maybeSingle()

  if (!channel) return NextResponse.json({ ok: true })

  // Forward to the worker for Gmail API sync. Fire and forget — Pub/Sub has
  // already delivered the notification; the worker handles retries internally.
  const workerUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (workerUrl && workerSecret) {
    fetch(`${workerUrl}/intake/gmail-sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-intake-worker-secret': workerSecret,
      },
      body: JSON.stringify({ channelId: channel.id, historyId }),
    })
      .catch(err => {
        console.error(`[gmail-webhook] worker call failed`, err)
      })
  } else {
    console.error(`[gmail-webhook] worker URL or secret not configured`, { workerUrl: !!workerUrl, workerSecret: !!workerSecret })
  }

  return NextResponse.json({ ok: true })
}
