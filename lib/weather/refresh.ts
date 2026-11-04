import { dayKey } from '@/lib/reporting/executive/ac-calendar'
import { fetchArchive, fetchRecent, type FetchLike } from './open-meteo'
import { canonicalState, STATE_ROW } from './states'
import { fetchAllPages } from '@/lib/queries/paging'

// The daily weather job (scheduled task, every day at 08:00 India time). It is the ONLY thing that talks to the weather service: opening the AC Calendar never does.
// BY STATE (decided 2026-11-04): for every state that has an AC (or a store) it saves the day's highest and lowest outside temperature at the state's fixed point (lib/weather/states.ts);
// the calendar reads what is saved. No city is looked up any more.
//  - every run re-reads the last 7 days (so yesterday's forecast is replaced by what really happened) plus today's forecast and the forecast of the next 7 days;
//  - a state seen for the first time also gets the last BACKFILL_DAYS days of history, once;
//  - a state value that is not a state we know ('ALL', a typo) is skipped and listed; a failed state never stops the others.
// A state's rows sit in weather_city_daily as city = the state's name, state = 'STATE' (old city rows stay in the table, unused).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export const BACKFILL_DAYS = 120
const ARCHIVE_LAG_DAYS = 8
const RECENT_DAYS = 7
/** the next days' forecast kept as well (the calendar shows it on the coming days; each morning's run replaces it with the newer forecast) */
export const FORECAST_DAYS = 7
const CONCURRENCY = 5

export interface WeatherRefreshResult {
  cities: number; refreshed: number; backfilled: number; geocodeFailed: number; failed: number; rows: number
  /** the state values we do not know, and the states whose temperatures could not be read today (at most 60 of each are listed). (geocodeFailed counts the unknown values.) */
  notFound: string[]
  failedCities: string[]
}

const norm = (s: string | null | undefined) => (s ?? '').trim()
const addDays = (key: string, n: number) => dayKey(Date.parse(`${key}T00:00:00+05:30`) + n * 86_400_000)

function must<T>(res: { data?: T; error?: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}

/** A place whose weather is kept: for a state, city = the state's name and state = STATE_ROW. (The name CityRef is kept from when this was by city.) */
export type CityRef = { city: string; state: string }

/**
 * The place filter. The Store Master (the stores table, filled from the Store Details tab) is the ONE source of where a store is: the AC sheet's own State column is not used
 * (it said "ALL" on 811 ACs and a different state from the Store Master on 265 more), the same as the tickets, the AC list of the calendar and the rules.
 */
const STORE_COLUMN = { store: 'code', cluster: 'cluster', region: 'region', state: 'state' } as const
export type CityPlace = { kind: keyof typeof STORE_COLUMN; key: string }

async function distinctStates(db: Db, orgId: string | undefined, place: CityPlace | null, into: Map<string, CityRef>, includeUnknown: boolean) {
  for (let from = 0; ; from += 1000) {
    let q = db.from('stores').select('state')
    if (orgId) q = q.eq('org_id', orgId)
    if (place) q = q.eq(STORE_COLUMN[place.kind], place.kind === 'store' ? place.key.toUpperCase() : place.key)
    const rows = must<{ state: string | null }[]>(await q.order('id', { ascending: true }).range(from, from + 999), 'read states') ?? []
    for (const r of rows) {
      const raw = norm(r.state)
      if (!raw) continue
      const known = canonicalState(raw)
      if (known) { if (!into.has(known.name)) into.set(known.name, { city: known.name, state: STATE_ROW }) }
      else if (includeUnknown) { const k = `?${raw.toLowerCase()}`; if (!into.has(k)) into.set(k, { city: raw, state: '?' }) }
    }
    if (rows.length < 1000) break
  }
}

/** The distinct states of a place (or of everything), from the Store Master. Values that are not a state we know are left out (the daily job asks for them with includeUnknown, to list them). */
export async function stateList(db: Db, orgId?: string, place: CityPlace | null = null, opts: { includeUnknown?: boolean } = {}): Promise<CityRef[]> {
  const seen = new Map<string, CityRef>()
  await distinctStates(db, orgId, place, seen, !!opts.includeUnknown)
  return [...seen.values()]
}

async function runLimited<T>(items: T[], fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) { const x = items[i++]; await fn(x) }
  }))
}

export async function refreshWeather(db: Db, f: FetchLike, opts: { now?: number; orgId?: string } = {}): Promise<WeatherRefreshResult> {
  const now = opts.now ?? Date.now()
  const today = dayKey(now)
  const cities = await stateList(db, opts.orgId, null, { includeUnknown: true })
  const result: WeatherRefreshResult = { cities: cities.length, refreshed: 0, backfilled: 0, geocodeFailed: 0, failed: 0, rows: 0, notFound: [], failedCities: [] }

  await runLimited(cities, async ({ city, state }) => {
    try {
      // the state's fixed point (nothing is looked up); a value that is not a state we know is only listed
      const point = state === STATE_ROW ? canonicalState(city) : null
      if (!point) { result.geocodeFailed++; if (result.notFound.length < 60) result.notFound.push(city); return }
      const geo = { lat: point.lat, lon: point.lon }

      const rows: { city: string; state: string; day: string; tmax: number | null; tmin: number | null; fetched_at: string }[] = []
      const stamp = new Date(now).toISOString()
      const keep = (list: { day: string; tmax: number | null; tmin: number | null }[] | null) => { for (const d of list ?? []) rows.push({ city, state, day: d.day, tmax: d.tmax, tmin: d.tmin, fetched_at: stamp }) }

      // a city with no history yet gets it once
      const old = await db.from('weather_city_daily').select('day', { count: 'exact', head: true }).eq('city', city).eq('state', state).lte('day', addDays(today, -30))
      if ((old.count ?? 0) === 0) {
        keep(await fetchArchive(f, geo.lat, geo.lon, addDays(today, -BACKFILL_DAYS), addDays(today, -ARCHIVE_LAG_DAYS)))
        result.backfilled++
      }
      const recent = await fetchRecent(f, geo.lat, geo.lon, RECENT_DAYS, FORECAST_DAYS)
      if (recent === null && rows.length === 0) { result.failed++; if (result.failedCities.length < 60) result.failedCities.push(city); return }
      keep(recent)

      for (let i = 0; i < rows.length; i += 200) must(await db.from('weather_city_daily').upsert(rows.slice(i, i + 200), { onConflict: 'city,state,day' }), 'save temperatures')
      result.refreshed++
      result.rows += rows.length
    } catch (e) {
      console.error('[weather] city failed', city, e instanceof Error ? e.message : e)
      result.failed++
    }
  })
  return result
}

/** One day. tmax / tmin: the highest high and the lowest low of the states that have a value (one state = its own values; several states are NOT averaged: that is a range). `parts` lists each state's own values. */
export interface DayWeather { tmax: number | null; tmin: number | null; cities: number; parts: { name: string; tmax: number | null; tmin: number | null }[] }

/** For a set of places (states): per day the highest high and lowest low over the ones that have a saved value (one state = its own values; never an average), plus each state's own values. Reads only what is saved. */
export async function weatherFor(db: Db, cities: { city: string; state: string }[], from: string, to: string): Promise<{ days: Record<string, DayWeather>; cities: string[]; missing: number }> {
  const wanted = new Map(cities.map((c) => [`${c.city}|${c.state}`, c]))
  const names = [...new Set(cities.map((c) => c.city))]
  const days: Record<string, { parts: Map<string, { name: string; tmax: number | null; tmin: number | null }> }> = {}
  const have = new Set<string>()
  for (let i = 0; i < names.length; i += 100) {
    // 100 cities over up to 62 days is up to 6,200 rows, and the database answers at most 1000 rows per request: an unpaged read averaged an arbitrary part of them (audit F-08).
    // Read every page in a stable order (city, state, day is the table's key); an error on any page throws.
    const { rows } = await fetchAllPages<{ city: string; state: string; day: string; tmax: number | null; tmin: number | null }>((a, b) =>
      db.from('weather_city_daily').select('city, state, day, tmax, tmin').in('city', names.slice(i, i + 100)).gte('day', from).lte('day', to)
        .order('city', { ascending: true }).order('state', { ascending: true }).order('day', { ascending: true }).range(a, b))
    for (const r of rows) {
      if (!wanted.has(`${r.city}|${r.state}`)) continue
      have.add(`${r.city}|${r.state}`)
      const d = (days[r.day] ??= { parts: new Map() })
      d.parts.set(r.city, { name: r.city, tmax: r.tmax === null ? null : Number(r.tmax), tmin: r.tmin === null ? null : Number(r.tmin) })
    }
  }
  const out: Record<string, DayWeather> = {}
  for (const [day, d] of Object.entries(days)) {
    const parts = [...d.parts.values()].sort((a, b) => a.name.localeCompare(b.name))
    const highs = parts.map((p) => p.tmax).filter((v): v is number => v !== null)
    const lows = parts.map((p) => p.tmin).filter((v): v is number => v !== null)
    out[day] = { tmax: highs.length ? Math.max(...highs) : null, tmin: lows.length ? Math.min(...lows) : null, cities: parts.length, parts }
  }
  return { days: out, cities: [...have].map((k) => wanted.get(k)!.city), missing: wanted.size - have.size }
}
