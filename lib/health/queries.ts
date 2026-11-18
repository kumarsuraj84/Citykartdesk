import 'server-only'
/**
 * What the Health & Performance page (and the alert bar) read. Everything goes through the server key; the page itself refuses anybody who is not a platform owner
 * (app/(app)/health/layout.tsx), and every function here is only ever called after that check.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { CHECKS, type CheckDef } from './catalog'
import { isNotApplicable, levelOf, overallStatus, type Level } from './evaluate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any }
const db = () => createAdminClient() as unknown as AnyClient

export type CheckState = CheckDef & {
  enabled: boolean
  level: Level
  /** the app looked and there is nothing to check right now (no active mailbox, no sheet set up): shown as "Not in use", never counted as a problem */
  notApplicable: boolean
  lastAt: string | null
  lastMs: number | null
  detail: string | null
  uptime: { d1: number | null; d7: number | null; d30: number | null }
  /** the open outage of this check, if any */
  openSince: string | null
  /** newest day last: ok share (0..1) of the minutes known that day, or null when there is no data that day */
  days: { day: string; share: number | null }[]
}

export type Incident = { id: number; checkKey: string; startedAt: string; endedAt: string | null; detail: string | null; failedSamples: number }

export type HealthOverview = {
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  checks: CheckState[]
  incidents: Incident[]
  /** when the probe on the app server last reported (any check), to say "monitoring is not running" plainly */
  lastSampleAt: string | null
  /** the moment the figures were read (pages show ages against this, not against their own clock) */
  nowMs: number
}

const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

async function uptimeMap(days: number): Promise<Map<string, number | null>> {
  const { data } = await db().rpc('health_uptime', { p_days: days })
  return new Map(((data ?? []) as { check_key: string; uptime_pct: unknown }[]).map((r) => [r.check_key, num(r.uptime_pct)]))
}

export async function getHealthOverview(): Promise<HealthOverview> {
  const d = db()
  const nowMs = Date.now()
  const since = new Date(nowMs - 15 * 60_000).toISOString()
  const [settings, recent, u1, u7, u30, open, incidents] = await Promise.all([
    d.from('health_check_settings').select('check_key, enabled'),
    d.from('health_samples').select('check_key, ok, ms, detail, at').gte('at', since).order('at', { ascending: false }).limit(CHECKS.length * 25),
    uptimeMap(1), uptimeMap(7), uptimeMap(30),
    d.from('health_incidents').select('check_key, started_at').is('ended_at', null),
    d.from('health_incidents').select('id, check_key, started_at, ended_at, detail, failed_samples').order('started_at', { ascending: false }).limit(40),
  ])
  const off = new Set(((settings.data ?? []) as { check_key: string; enabled: boolean }[]).filter((r) => r.enabled === false).map((r) => r.check_key))
  const newest = new Map<string, { ok: boolean; ms: number | null; detail: string | null; at: string }>()
  for (const r of (recent.data ?? []) as { check_key: string; ok: boolean; ms: number | null; detail: string | null; at: string }[]) if (!newest.has(r.check_key)) newest.set(r.check_key, r)
  const openBy = new Map(((open.data ?? []) as { check_key: string; started_at: string }[]).map((r) => [r.check_key, r.started_at]))

  // the 30-day strip of every check that is switched on
  const strip = await Promise.all(CHECKS.filter((c) => !off.has(c.key)).map(async (c) => {
    const { data } = await d.rpc('health_daily', { p_check: c.key, p_days: 30 })
    return [c.key, (data ?? []) as { day: string; samples: number; ok_samples: number }[]] as const
  }))
  const stripBy = new Map(strip)

  // the app's own collector is alive when any check it measures has a fresh answer
  const appCollectorAlive = CHECKS.some((c) => c.by === 'app' && !off.has(c.key) && levelOf(newest.get(c.key) ? { ok: newest.get(c.key)!.ok, at: newest.get(c.key)!.at } : null, nowMs) !== 'nodata')
  const checks: CheckState[] = CHECKS.map((c) => {
    const n = newest.get(c.key) ?? null
    const enabled = !off.has(c.key)
    // the last 30 calendar days in India time, oldest first
    const rows = new Map((stripBy.get(c.key) ?? []).map((r) => [String(r.day).slice(0, 10), r]))
    const days: { day: string; share: number | null }[] = []
    for (let i = 29; i >= 0; i--) {
      const day = new Date(nowMs + 5.5 * 3_600_000 - i * 86_400_000).toISOString().slice(0, 10)
      const r = rows.get(day)
      days.push({ day, share: r && Number(r.samples) > 0 ? Number(r.ok_samples) / Number(r.samples) : null })
    }
    const level: Level = enabled ? levelOf(n ? { ok: n.ok, at: n.at } : null, nowMs) : 'nodata'
    return {
      ...c,
      enabled,
      level,
      notApplicable: enabled && isNotApplicable(c.by, level, appCollectorAlive),
      lastAt: n?.at ?? null,
      lastMs: n?.ms ?? null,
      detail: n?.detail ?? null,
      uptime: { d1: u1.get(c.key) ?? null, d7: u7.get(c.key) ?? null, d30: u30.get(c.key) ?? null },
      openSince: openBy.get(c.key) ?? null,
      days,
    }
  })

  const lastSampleAt = [...newest.values()].map((n) => n.at).sort().pop() ?? null
  return {
    status: overallStatus(checks.filter((c) => c.enabled && !c.notApplicable).map((c) => ({ group: c.group, level: c.level }))),
    checks,
    incidents: ((incidents.data ?? []) as { id: number; check_key: string; started_at: string; ended_at: string | null; detail: string | null; failed_samples: number }[])
      .map((r) => ({ id: r.id, checkKey: r.check_key, startedAt: r.started_at, endedAt: r.ended_at, detail: r.detail, failedSamples: r.failed_samples })),
    lastSampleAt,
    nowMs,
  }
}

export type SeriesPoint = { at: string; samples: number; okSamples: number; p50: number; p95: number; max: number }
export async function getCheckSeries(checkKey: string, hours: number): Promise<SeriesPoint[]> {
  const bucket = hours <= 24 ? 10 : hours <= 24 * 7 ? 60 : 240
  const { data } = await db().rpc('health_series', { p_check: checkKey, p_hours: hours, p_bucket_min: bucket })
  return ((data ?? []) as { bucket: string; samples: number; ok_samples: number; p50_ms: number; p95_ms: number; max_ms: number }[])
    .map((r) => ({ at: r.bucket, samples: Number(r.samples), okSamples: Number(r.ok_samples), p50: Number(r.p50_ms), p95: Number(r.p95_ms), max: Number(r.max_ms) }))
}

export type PerfPoint = { at: string; n: number; p50: number; p95: number; max: number; errors5xx: number }
export type SlowRoute = { route: string; method: string; requests: number; p50: number; p95: number; slowest: number; errors5xx: number }
export async function getPerf(hours: number): Promise<{ series: PerfPoint[]; slowest: SlowRoute[] }> {
  const bucket = hours <= 24 ? 30 : hours <= 24 * 7 ? 120 : 480
  const [s, w] = await Promise.all([
    db().rpc('perf_series', { p_hours: hours, p_bucket_min: bucket }),
    db().rpc('perf_slowest', { p_hours: hours, p_limit: 15 }),
  ])
  return {
    series: ((s.data ?? []) as { bucket: string; n: number; p50: number; p95: number; max: number; errors5xx: number }[]).map((r) => ({ at: r.bucket, n: Number(r.n), p50: Number(r.p50 ?? 0), p95: Number(r.p95 ?? 0), max: Number(r.max ?? 0), errors5xx: Number(r.errors5xx) })),
    slowest: ((w.data ?? []) as { route: string; method: string; requests: number; p50: number; p95: number; slowest: number; errors5xx: number }[]).map((r) => ({ route: r.route, method: r.method, requests: Number(r.requests), p50: Number(r.p50 ?? 0), p95: Number(r.p95 ?? 0), slowest: Number(r.slowest ?? 0), errors5xx: Number(r.errors5xx) })),
  }
}

/** For the alert bar on top of a platform owner's screens: the checks that are in an open outage right now. Never throws (the bar must not break a page). */
export async function getOpenIncidents(): Promise<{ checkKey: string; startedAt: string }[]> {
  try {
    const { data } = await db().from('health_incidents').select('check_key, started_at').is('ended_at', null).order('started_at', { ascending: true })
    return ((data ?? []) as { check_key: string; started_at: string }[]).map((r) => ({ checkKey: r.check_key, startedAt: r.started_at }))
  } catch { return [] }
}
