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

let soleOrgCache: { id: string | null; at: number } | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function soleOrgId(admin: any): Promise<string | null> {
  if (soleOrgCache && Date.now() - soleOrgCache.at < 10 * 60_000) return soleOrgCache.id
  const { data } = await admin.from('organizations').select('id').limit(2)
  const id = Array.isArray(data) && data.length === 1 ? (data[0].id as string) : null
  soleOrgCache = { id, at: Date.now() }
  return id
}

/** Fire-and-forget safe: never throws, so logging can never break the app. */
export async function recordEvents(
  events: AppEventInput[],
  ctx: { orgId: string | null; userId: string | null; sessionId?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // Server-side events (email sends, profile-load failures) don't know their organisation.
    // The Event Log only shows an organisation's own rows, so resolve it: from the user if
    // there is one, otherwise the only organisation on this server.
    let orgId = ctx.orgId
    if (!orgId && ctx.userId) {
      const { data } = await admin.from('profiles').select('org_id').eq('id', ctx.userId).maybeSingle()
      orgId = data?.org_id ?? null
    }
    if (!orgId) orgId = await soleOrgId(admin)
    const rows = toEventRows(events, { ...ctx, orgId })
    if (rows.length === 0) return
    await admin.from('app_event_log').insert(rows)
  } catch {
    /* logging must never take the app down */
  }
}
