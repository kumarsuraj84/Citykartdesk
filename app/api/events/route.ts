import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordEvents, type AppEventInput } from '@/lib/events/record'

// Browser -> server event intake. Session-gated by proxy.ts (not a public route);
// the user id comes from the verified header proxy.ts sets, never from the body.
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 40
const hits = new Map<string, { start: number; n: number }>()

export async function POST(req: Request) {
  const h = await headers()
  const userId = h.get('x-verified-user-id')
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 })

  const now = Date.now()
  const slot = hits.get(userId)
  if (!slot || now - slot.start > WINDOW_MS) hits.set(userId, { start: now, n: 1 })
  else if (++slot.n > MAX_REQUESTS_PER_WINDOW) return NextResponse.json({ ok: false }, { status: 429 })

  let body: { sessionId?: string; events?: AppEventInput[] }
  try {
    const text = await req.text()
    if (text.length > 64_000) return NextResponse.json({ ok: false }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!Array.isArray(body.events) || body.events.length === 0) return NextResponse.json({ ok: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin.from('profiles').select('org_id').eq('id', userId).maybeSingle()

  await recordEvents(body.events, {
    orgId: data?.org_id ?? null,
    userId,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    userAgent: h.get('user-agent'),
  })
  return NextResponse.json({ ok: true })
}
