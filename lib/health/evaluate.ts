// Health & Performance: the decisions, as pure functions (no database, no clock unless passed in), so every rule has a test.
import { INCIDENT_AFTER, STALE_AFTER_MINUTES, SYNC_LIMITS } from './catalog'

export type Sample = { ok: boolean; at: string }

/** Open an incident when the newest INCIDENT_AFTER samples all failed and none is open; close the open one as soon as the newest sample is good. Samples newest first. */
export function decideIncident(samplesNewestFirst: Sample[], hasOpen: boolean): 'open' | 'close' | 'none' {
  if (samplesNewestFirst.length === 0) return 'none'
  if (hasOpen) return samplesNewestFirst[0].ok ? 'close' : 'none'
  const last = samplesNewestFirst.slice(0, INCIDENT_AFTER)
  return last.length >= INCIDENT_AFTER && last.every((s) => !s.ok) ? 'open' : 'none'
}

export type Level = 'good' | 'down' | 'nodata'

/** The state of one check right now, from its newest sample. A sample older than STALE_AFTER_MINUTES means the probe stopped: that is "no data", never "good". */
export function levelOf(newest: Sample | null, nowMs: number = Date.now()): Level {
  if (!newest) return 'nodata'
  if (nowMs - new Date(newest.at).getTime() > STALE_AFTER_MINUTES * 60_000) return 'nodata'
  return newest.ok ? 'good' : 'down'
}

/**
 * A check the APP measures that has no recent answer while the app's OTHER checks are answering means the app looked and found nothing to check (for example no active
 * mailbox for the e-mail poll, no Google Sheet set up). That is "not in use", not a problem. When none of the app's checks has answered, the collector itself has
 * stopped, and that stays "no recent data".
 */
export function isNotApplicable(by: 'probe' | 'app', level: Level, appCollectorAlive: boolean): boolean {
  return by === 'app' && level === 'nodata' && appCollectorAlive
}

/** The state of the whole system: down if any enabled core check is down, degraded if only a sync is late or data is missing, else healthy. */
export function overallStatus(items: { group: 'core' | 'sync'; level: Level }[]): 'healthy' | 'degraded' | 'down' | 'unknown' {
  if (items.length === 0) return 'unknown'
  if (items.some((i) => i.group === 'core' && i.level === 'down')) return 'down'
  if (items.some((i) => i.level === 'down' || i.level === 'nodata')) return 'degraded'
  return 'healthy'
}

/** "12 min", "3 h 20 min", "2 d 4 h" for an age or a duration given in minutes. */
export function humanMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 1) return 'under 1 min'
  if (m < 60) return `${m} min`
  if (m < 60 * 24) { const h = Math.floor(m / 60); const r = m % 60; return r ? `${h} h ${r} min` : `${h} h` }
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60)
  return h ? `${d} d ${h} h` : `${d} d`
}

export type Verdict = { ok: boolean; detail: string }

/** Zoho copy: the newest FINISHED run, and the last good one. Good when a good run finished within the limit. */
export function zohoSyncVerdict(p: { lastOkAt: string | null; lastRunOk: boolean | null; lastError: string | null }, nowMs: number): Verdict {
  if (!p.lastOkAt) return { ok: false, detail: 'no good Zoho sync run found' }
  const age = (nowMs - new Date(p.lastOkAt).getTime()) / 60_000
  if (age > SYNC_LIMITS.zohoMinutes) return { ok: false, detail: `last good run ${humanMinutes(age)} ago${p.lastRunOk === false && p.lastError ? '; the latest run failed: ' + p.lastError.slice(0, 80) : ''}` }
  return { ok: true, detail: `last good run ${humanMinutes(age)} ago` }
}

export type SheetRow = { kind: string; lastCheckedAt: string | null; lastStatus: string | null; lastError: string | null }
/** Google Sheet syncs: every sheet checked within the limit and not in error; a broken Google connection fails them all. */
export function sheetsVerdict(rows: SheetRow[], connectionBroken: boolean, nowMs: number): Verdict | null {
  if (rows.length === 0) return null
  if (connectionBroken) return { ok: false, detail: 'the Google connection is broken (sign in to Google again in Admin → Masters)' }
  const bad: string[] = []
  for (const r of rows) {
    const age = r.lastCheckedAt ? (nowMs - new Date(r.lastCheckedAt).getTime()) / 3_600_000 : Infinity
    if (r.lastStatus === 'error') bad.push(`${r.kind.toUpperCase()}: error${r.lastError ? ' (' + r.lastError.slice(0, 60) + ')' : ''}`)
    else if (age > SYNC_LIMITS.sheetsHours) bad.push(`${r.kind.toUpperCase()}: not checked for ${Number.isFinite(age) ? humanMinutes(age * 60) : 'ever'}`)
  }
  return bad.length ? { ok: false, detail: bad.join('; ') } : { ok: true, detail: `${rows.length} sheet${rows.length === 1 ? '' : 's'} checked on time` }
}

export type ChannelRow = { name: string; lastPolledAt: string | null }
/** E-mail intake: every ACTIVE mailbox polled within the limit. No active mailbox = not applicable (null). */
export function emailVerdict(rows: ChannelRow[], nowMs: number): Verdict | null {
  if (rows.length === 0) return null
  const late = rows.filter((r) => !r.lastPolledAt || (nowMs - new Date(r.lastPolledAt).getTime()) / 60_000 > SYNC_LIMITS.emailMinutes)
  return late.length ? { ok: false, detail: `${late.length} of ${rows.length} mailbox${rows.length === 1 ? '' : 'es'} not polled for over ${SYNC_LIMITS.emailMinutes} min` } : { ok: true, detail: `${rows.length} mailbox${rows.length === 1 ? '' : 'es'} polled on time` }
}

/** Weather loads once a day at 08:00 India time: before 10:00 yesterday's data is fine, after that today's must be there. `istHour` and the two dates are India time. */
export function weatherVerdict(latestDay: string | null, todayIst: string, yesterdayIst: string, istHour: number): Verdict {
  if (!latestDay) return { ok: false, detail: 'no weather data found' }
  const need = istHour < 10 ? yesterdayIst : todayIst
  return latestDay >= need ? { ok: true, detail: `latest weather day ${latestDay}` } : { ok: false, detail: `latest weather day is ${latestDay}, expected ${need}` }
}

/** The uptime figure shown to people: never "100" when something failed. */
export function uptimeText(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return '—'
  if (pct >= 100) return '100%'
  if (pct > 99.99) return '99.99%'
  return `${pct.toFixed(pct >= 99 ? 2 : 1)}%`
}
