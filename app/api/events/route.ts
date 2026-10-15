import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { readVerifiedUserId } from '@/lib/auth/verified-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordEvents, type AppEventInput } from '@/lib/events/record'
import { recordSystemLog } from '@/lib/syslog/record'

// Browser -> server event intake. Session-gated by proxy.ts (not a public route);
// the user id comes from the verified header proxy.ts sets, never from the body.
const CLIENT_KINDS = new Set(['pageview', 'click', 'js_error', 'render_error'])
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 40
const hits = new Map<string, { start: number; n: number }>()

export async function POST(req: Request) {
  const h = await headers()
  const userId = readVerifiedUserId(h)
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
  // A browser may only report what a browser can observe. 'server_error' and 'system' are written by the server itself, so a signed-in user
  // can no longer put rows of those kinds into the log.
  body.events = body.events.filter((e) => e && CLIENT_KINDS.has(e.kind)).slice(0, 50)
  if (body.events.length === 0) return NextResponse.json({ ok: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin.from('profiles').select('org_id').eq('id', userId).maybeSingle()

  await recordEvents(body.events, {
    orgId: data?.org_id ?? null,
    userId,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    userAgent: h.get('user-agent'),
  })

  // Browser errors also go to the System Log, with the page, the user, and whether a click caused them.
  for (const e of body.events) {
    if (e.kind !== 'js_error' && e.kind !== 'render_error') continue
    const detail = (e.detail && typeof e.detail === 'object' ? e.detail : {}) as { click?: { target?: string; ms?: number } | null; digest?: string; type?: string; stack?: string }
    void recordSystemLog({
      category: 'error', source: 'browser', severity: 'error', action: `browser.${e.kind}`,
      message: typeof e.message === 'string' ? e.message.slice(0, 500) : null,
      errorCode: detail.digest ?? detail.type ?? null,
      stack: typeof detail.stack === 'string' ? detail.stack : null,
      path: typeof e.path === 'string' ? e.path : null,
      actorId: userId, orgId: data?.org_id ?? null,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      userAgent: h.get('user-agent'),
      fromClick: detail.click ? true : false,
      clickTarget: detail.click?.target ?? null,
      detail: e.detail,
    })
  }
  return NextResponse.json({ ok: true })
}
