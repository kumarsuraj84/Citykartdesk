import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { readVerifiedUserId } from '@/lib/auth/verified-user'
import { toRow } from './row'
import { fileSpool } from './spool'
import { SystemLogWriter } from './writer'
import { type SystemLogInput, normalizeMessage, sourceOfLoggerEvent } from './shape'

// The one place the application writes to system_log. Never throws, never blocks the caller for long, and adds the request context
// (request id, user, path, address, browser) when it is called inside a request.

let writer: SystemLogWriter | null = null
let timers = false

// A plain client WITHOUT the retrying fetch wrapper: the wrapper itself reports failures here, so using it would loop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawClient(): any {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  })
  return client
}

function getWriter(): SystemLogWriter {
  if (writer) return writer
  writer = new SystemLogWriter({
    insert: async (rows) => {
      const c = rawClient()
      if (!c) throw new Error('no database configuration')
      const { error } = await c.from('system_log').insert(rows)
      if (error) throw new Error(error.message)
    },
    spool: fileSpool(),
    onDrop: (rows, reason) => console.error(JSON.stringify({ level: 'error', event: 'system_log.dropped', reason, rows: rows.length, first: rows[0]?.action })),
  })
  if (!timers) {
    timers = true
    const flush = setInterval(() => { void writer?.flush() }, 1000)
    const retry = setInterval(() => { void writer?.retrySpool() }, 30_000)
    flush.unref?.(); retry.unref?.()
    void writer.retrySpool()                       // send what an earlier outage or crash left behind
  }
  return writer
}

const actors = new Map<string, { orgId: string | null; role: string | null; at: number }>()
let soleOrg: { id: string | null; at: number } | null = null

async function resolveActor(id: string): Promise<{ orgId: string | null; role: string | null }> {
  const hit = actors.get(id)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit
  try {
    const c = rawClient()
    const { data } = await c.from('profiles').select('org_id, role').eq('id', id).maybeSingle()
    const v = { orgId: (data?.org_id as string) ?? null, role: (data?.role as string) ?? null, at: Date.now() }
    actors.set(id, v)
    if (actors.size > 1000) actors.delete(actors.keys().next().value as string)
    return v
  } catch {
    return { orgId: null, role: null }
  }
}

async function soleOrgId(): Promise<string | null> {
  if (soleOrg && Date.now() - soleOrg.at < 10 * 60_000) return soleOrg.id
  try {
    const { data } = await rawClient().from('organizations').select('id').limit(2)
    soleOrg = { id: Array.isArray(data) && data.length === 1 ? (data[0].id as string) : null, at: Date.now() }
  } catch {
    soleOrg = { id: null, at: Date.now() }
  }
  return soleOrg.id
}

/** What can be learned from the current request, if there is one (outside a request this is empty). */
async function requestContext(): Promise<Partial<SystemLogInput>> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
    const parts = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const ip = Number.isInteger(hops) && hops >= 1 && parts.length >= hops ? parts[parts.length - hops] : null
    const verified = readVerifiedUserId(h)
    return {
      requestId: h.get('x-request-id'),
      path: h.get('x-request-path'),
      method: h.get('x-request-method'),
      userAgent: h.get('user-agent'),
      ip,
      actorId: typeof verified === 'string' ? verified : null,
    }
  } catch {
    return {}
  }
}

/** Queue one row. Fire-and-forget safe. */
export async function recordSystemLog(input: SystemLogInput, opts: { floodKey?: string | false } = {}): Promise<void> {
  try {
    const ctx = await requestContext()
    const merged: SystemLogInput = { ...ctx, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== null)) } as SystemLogInput
    if (merged.actorId && (!merged.orgId || !merged.actorRole)) {
      const a = await resolveActor(merged.actorId)
      merged.orgId = merged.orgId ?? a.orgId
      merged.actorRole = merged.actorRole ?? a.role
    }
    if (!merged.orgId) merged.orgId = await soleOrgId()
    const floodKey = opts.floodKey === false || merged.category === 'audit' || merged.category === 'security'
      ? undefined
      : opts.floodKey ?? `${merged.source}|${merged.errorCode ?? ''}|${normalizeMessage(merged.message ?? merged.action).slice(0, 80)}|${merged.path ?? ''}`
    getWriter().enqueue(toRow(merged), floodKey)
  } catch { /* logging must never break the app */ }
}

/** Write now (used for audit rows, process crashes and tests). */
export async function flushSystemLog(): Promise<void> {
  try { await getWriter().flush() } catch { /* ignore */ }
}

export function systemLogStats() {
  return writer ? { ...writer.stats, pending: writer.pending } : { written: 0, spooled: 0, dropped: 0, suppressed: 0, pending: 0 }
}

// Error codes that mean "the caller did something expected" (a duplicate, a missing row, no permission): recorded, but only as warnings.
const EXPECTED_CODES = new Set(['23505', '23503', '42501', 'PGRST116', 'PGRST204'])

interface LoggerPayload {
  level?: string; event?: string; message?: string; route?: string; requestId?: string; actorId?: string; orgId?: string
  correlationId?: string; errorCode?: string; context?: Record<string, unknown>; error?: { message?: string; stack?: string }
}

/** The structured logger's warnings and errors flow in here. */
export function recordFromLogger(p: LoggerPayload): void {
  const event = p.event ?? 'log'
  const code = p.errorCode ?? (typeof p.context?.code === 'string' ? (p.context.code as string) : null)
  const denied = code === '42501'
  void recordSystemLog({
    category: denied ? 'security' : 'error',
    source: sourceOfLoggerEvent(event, p.route),
    severity: p.level === 'warn' || (code && EXPECTED_CODES.has(code)) ? 'warning' : 'error',
    outcome: denied ? 'denied' : 'failure',
    action: event,
    message: p.error?.message ?? p.message ?? event,
    errorCode: code,
    stack: p.error?.stack ?? null,
    actorId: p.actorId ?? null,
    orgId: p.orgId ?? null,
    requestId: p.requestId ?? null,
    correlationId: p.correlationId ?? null,
    path: p.route ?? null,
    detail: p.context ?? null,
  })
}
