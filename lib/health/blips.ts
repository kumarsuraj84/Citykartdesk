// Short interruptions: stretches when the app, the data service or the gateway did not answer, however brief (a restart, a deployment, a hiccup). The probe on the app server
// watches every 5 seconds and stores each stretch as a health_samples row with the check key blip_<check> (at = when it began, ms = how long it lasted). An OUTAGE alert still needs
// 3 failed minutes in a row; this is the record of everything shorter. Pure functions, tested.

export const BLIP_PREFIX = 'blip_'
export type BlipCheck = 'app' | 'postgrest' | 'proxy'
export type BlipRow = { check_key: string; at: string; ms: number; detail: string | null }
export type Interruption = { checkKey: BlipCheck; startedAt: string; endedAt: string; seconds: number; detail: string | null; ongoing: boolean }

const STILL = 'still not answering'
const JOIN_GAP_MS = 20_000

/** The stored rows as a list of interruptions, newest first. A stretch that was still going when one minute ended continues in the next minute's row: those are joined into one. */
export function mergeBlips(rows: BlipRow[]): Interruption[] {
  const sorted = rows
    .filter((r) => r.check_key.startsWith(BLIP_PREFIX) && Number.isFinite(new Date(r.at).getTime()))
    .map((r) => ({ key: r.check_key.slice(BLIP_PREFIX.length) as BlipCheck, start: new Date(r.at).getTime(), end: new Date(r.at).getTime() + Math.max(0, Number(r.ms) || 0), detail: r.detail }))
    .sort((a, b) => a.start - b.start)
  const out: { key: BlipCheck; start: number; end: number; detail: string | null; ongoing: boolean }[] = []
  const last = new Map<string, number>()   // key -> index in out
  for (const r of sorted) {
    const ongoing = (r.detail ?? '').includes(STILL)
    const i = last.get(r.key)
    const prev = i === undefined ? undefined : out[i]
    if (prev && prev.ongoing && r.start <= prev.end + JOIN_GAP_MS) {
      prev.end = Math.max(prev.end, r.end)
      prev.ongoing = ongoing
      continue
    }
    out.push({ key: r.key, start: r.start, end: r.end, detail: r.detail ? r.detail.replace(` (${STILL} when this minute ended)`, '') : null, ongoing })
    last.set(r.key, out.length - 1)
  }
  return out
    .map((o) => ({ checkKey: o.key, startedAt: new Date(o.start).toISOString(), endedAt: new Date(o.end).toISOString(), seconds: Math.max(1, Math.round((o.end - o.start) / 1000)), detail: o.detail, ongoing: o.ongoing }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** How many interruptions and how many seconds of not answering, per check, since a moment. */
export function sumInterruptions(list: Interruption[], sinceMs: number): Record<string, { count: number; seconds: number }> {
  const out: Record<string, { count: number; seconds: number }> = {}
  for (const i of list) {
    if (new Date(i.startedAt).getTime() < sinceMs) continue
    const o = (out[i.checkKey] ??= { count: 0, seconds: 0 })
    o.count++; o.seconds += i.seconds
  }
  return out
}

/** "18 s", "2 min 5 s", "1 h 3 min" for a number of seconds. */
export function humanSeconds(s: number): string {
  const n = Math.max(0, Math.round(s))
  if (n < 60) return `${n} s`
  if (n < 3600) { const m = Math.floor(n / 60); const r = n % 60; return r ? `${m} min ${r} s` : `${m} min` }
  const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}
