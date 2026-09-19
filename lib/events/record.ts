import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export const EVENT_KINDS = ['pageview', 'click', 'js_error', 'render_error', 'server_error', 'system'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export interface AppEventInput {
  kind: string
  path?: string | null
  target?: string | null
  message?: string | null
  detail?: unknown
  at?: number
}

export const MAX_EVENTS_PER_BATCH = 50
export const RETENTION_DAYS = 90

const clip = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, n) : null

/** Trim a JSON-able value so one event can never be huge. */
function clipDetail(v: unknown): unknown {
  if (v === undefined || v === null) return null
  try {
    const s = JSON.stringify(v)
    return s.length <= 2000 ? v : { truncated: s.slice(0, 2000) }
  } catch {
    return null
  }
}

/** Validate and shape raw events (from the browser or the server) into table rows. */
export function toEventRows(
  events: AppEventInput[],
  ctx: { orgId: string | null; userId: string | null; sessionId?: string | null; userAgent?: string | null },
) {
  const now = Date.now()
  return events.slice(0, MAX_EVENTS_PER_BATCH).flatMap((e) => {
    if (!e || !(EVENT_KINDS as readonly string[]).includes(e.kind)) return []
    // Trust the browser clock only if it is close to ours (offline batches / skew).
    const at = typeof e.at === 'number' && Math.abs(now - e.at) < 10 * 60_000 ? e.at : now
    return [{
      created_at: new Date(at).toISOString(),
      org_id: ctx.orgId,
      user_id: ctx.userId,
      session_id: clip(ctx.sessionId, 64),
      kind: e.kind,
      path: clip(e.path, 300),
      target: clip(e.target, 120),
      message: clip(e.message, 500),
      detail: clipDetail(e.detail),
      user_agent: clip(ctx.userAgent, 200),
    }]
  })
}

/** Fire-and-forget safe: never throws, so logging can never break the app. */
export async function recordEvents(
  events: AppEventInput[],
  ctx: { orgId: string | null; userId: string | null; sessionId?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    const rows = toEventRows(events, ctx)
    if (rows.length === 0) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    await admin.from('app_event_log').insert(rows)
  } catch {
    /* logging must never take the app down */
  }
}
