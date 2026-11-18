import 'server-only'
/**
 * The checks the APP itself can make: the database, the sign-in and file services, and how fresh each sync is. (The one-minute probe on the app server measures what only an
 * outside observer can: whether the app answers at all, the data service, the gateway and the NAS.)
 * A check that does not apply here (no Zoho login, no Google sheet set up, no active mailbox) is simply not returned: it is not "down", it is not there.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { zohoDbStatus, zohoQuery } from '@/lib/zoho/db'
import { istParts, istDay } from '@/lib/reporting/ist'
import { emailVerdict, sheetsVerdict, weatherVerdict, zohoSyncVerdict, type Verdict } from './evaluate'

export type Probe = { key: string; ok: boolean; ms: number; detail: string }

const PROBE_MS = 4000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
const db = () => createAdminClient() as unknown as AnyClient

async function timed(key: string, fn: () => Promise<Verdict | null>): Promise<Probe | null> {
  const t0 = Date.now()
  try {
    const v = await fn()
    if (!v) return null
    return { key, ok: v.ok, ms: Date.now() - t0, detail: v.detail.slice(0, 240) }
  } catch (e) {
    return { key, ok: false, ms: Date.now() - t0, detail: `could not check: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}` }
  }
}

async function http(url: string): Promise<Verdict> {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const res = await fetch(url, { headers: anon ? { apikey: anon } : {}, signal: AbortSignal.timeout(PROBE_MS), cache: 'no-store' })
  return res.status < 500 ? { ok: true, detail: `answered (${res.status})` } : { ok: false, detail: `answered with an error (${res.status})` }
}

export async function runInAppProbes(enabled: (key: string) => boolean): Promise<Probe[]> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const nowMs = Date.now()
  const jobs: Promise<Probe | null>[] = []
  const add = (key: string, fn: () => Promise<Verdict | null>) => { if (enabled(key)) jobs.push(timed(key, fn)) }

  add('database', async () => {
    const { error } = await db().from('profiles').select('id').limit(1).maybeSingle()
    return error ? { ok: false, detail: `the database returned an error: ${String(error.message).slice(0, 100)}` } : { ok: true, detail: 'answered' }
  })
  add('auth', () => (base ? http(`${base}/auth/v1/health`) : Promise.resolve({ ok: false, detail: 'the service address is not set' })))
  add('storage', () => (base ? http(`${base}/storage/v1/`) : Promise.resolve({ ok: false, detail: 'the service address is not set' })))

  add('sync_zoho', async () => {
    if (!zohoDbStatus().ready) return null
    const [good, last] = await Promise.all([
      zohoQuery<{ finished_at: Date | null }>(`select max(finished_at) as finished_at from zoho_sync_run where ok`),
      zohoQuery<{ ok: boolean | null; error: string | null }>(`select ok, error from zoho_sync_run where finished_at is not null order by finished_at desc limit 1`),
    ])
    return zohoSyncVerdict({ lastOkAt: good[0]?.finished_at ? new Date(good[0].finished_at).toISOString() : null, lastRunOk: last[0]?.ok ?? null, lastError: last[0]?.error ?? null }, nowMs)
  })

  add('sync_google_sheets', async () => {
    const [src, conn] = await Promise.all([
      db().from('master_sources').select('kind, last_checked_at, last_status, last_error'),
      db().from('master_google_connection').select('status'),
    ])
    const rows = ((src.data ?? []) as { kind: string; last_checked_at: string | null; last_status: string | null; last_error: string | null }[])
      .map((r) => ({ kind: r.kind, lastCheckedAt: r.last_checked_at, lastStatus: r.last_status, lastError: r.last_error }))
    const broken = ((conn.data ?? []) as { status: string }[]).some((c) => c.status === 'broken')
    return sheetsVerdict(rows, broken, nowMs)
  })

  add('sync_email', async () => {
    const { data } = await db().from('intake_channels').select('name, last_polled_at').eq('status', 'active').eq('type', 'email')
    return emailVerdict(((data ?? []) as { name: string; last_polled_at: string | null }[]).map((r) => ({ name: r.name, lastPolledAt: r.last_polled_at })), nowMs)
  })

  add('sync_weather', async () => {
    const { data } = await db().from('weather_city_daily').select('day').order('day', { ascending: false }).limit(1)
    const latest = ((data ?? []) as { day: string }[])[0]?.day ?? null
    const now = new Date(nowMs)
    return weatherVerdict(latest, istParts(now).day, istDay(new Date(nowMs - 24 * 3_600_000)), istParts(now).hour)
  })

  return (await Promise.all(jobs)).filter((p): p is Probe => p !== null)
}
