import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

function isJsonObject(v: Json | null | undefined): v is { [key: string]: Json | undefined } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Vercel cron: runs every 5 minutes (see vercel.json).
// Checks whether any intake_messages lack a final classification and, if so,
// fires the worker's reclassify endpoint once.  The worker is idempotent —
// it skips messages that already have is_final=true — so double-runs are safe.
//
// Auth: Vercel sets the Authorization header to `Bearer ${CRON_SECRET}` on
// every cron invocation. We also accept the old x-cron-secret header so
// manual test calls (curl -H "x-cron-secret: ...") keep working.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }

  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get('authorization') ?? ''
  const legacyHeader = req.headers.get('x-cron-secret') ?? ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : legacyHeader
  if (provided !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawWorkerUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? cronSecret
  if (!rawWorkerUrl || !workerSecret) {
    return NextResponse.json({ skipped: true, reason: 'Worker not configured.' })
  }
  const workerUrl = (/^https?:\/\//.test(rawWorkerUrl) ? rawWorkerUrl : `https://${rawWorkerUrl}`).replace(/\/$/, '')

  const admin = createAdminClient()

  // Determine the effective "classify from" date.
  // Priority order:
  //   1. Earliest sync_from_date across active channels (set at channel creation time)
  //   2. INTAKE_CLASSIFY_SINCE_DAYS env var (fallback, default 60 days)
  //   3. No limit (classify all) if sinceDays = 0 and no channel dates
  let sinceDate: string | undefined

  const { data: activeChannels } = await admin
    .from('intake_channels')
    .select('config')
    .eq('status', 'active')

  const channelDates: string[] = (activeChannels ?? [])
    .map((ch) => {
      const cfg = ch.config
      const syncFromDate = isJsonObject(cfg) ? cfg.sync_from_date : undefined
      return typeof syncFromDate === 'string' ? syncFromDate : undefined
    })
    .filter((d): d is string => Boolean(d))

  if (channelDates.length > 0) {
    // Use the earliest date across all active channels so no in-scope message is missed.
    sinceDate = channelDates.sort()[0]
  } else {
    // Fall back to env-based window. Default 60 days, 0 = classify everything.
    const sinceDays = parseInt(process.env.INTAKE_CLASSIFY_SINCE_DAYS ?? '60', 10)
    if (sinceDays > 0) {
      sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
    }
  }

  // Quick count: unclassified = messages in scope with no is_final classification row.
  let messagesQuery = admin
    .from('intake_messages')
    .select('id', { count: 'exact', head: true })
  if (sinceDate) messagesQuery = messagesQuery.gte('received_at', sinceDate)
  const { count: totalMessages } = await messagesQuery

  let classifiedQuery = admin
    .from('intake_classifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_final', true)
  if (sinceDate) classifiedQuery = classifiedQuery.gte('created_at', sinceDate)
  const { count: classified } = await classifiedQuery

  const pending = (totalMessages ?? 0) - (classified ?? 0)

  if (pending <= 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No unclassified messages.', totalMessages, classified, sinceDate })
  }

  const body: Record<string, unknown> = { limit: 500 }
  if (sinceDate) body.since = sinceDate

  // Fire the worker. Don't wait longer than 25 s (Vercel cron limit is 30 s).
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)
    let res: Response
    try {
      res = await fetch(`${workerUrl}/intake/reclassify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-intake-worker-secret': workerSecret },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const data = (await res.json()) as { ok: boolean; processed?: number; error?: string }
    return NextResponse.json({ ok: data.ok, processed: data.processed ?? 0, pending, totalMessages, classified, sinceDate })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const timedOut = msg.includes('abort') || msg.includes('timed out')
    // A timeout doesn't mean classification failed — the worker may still be running.
    return NextResponse.json({ ok: !timedOut, timedOut, error: timedOut ? undefined : msg, pending, sinceDate })
  }
}
