import { dayKey } from '@/lib/reporting/executive/ac-calendar'
import { fetchArchive, fetchRecent, geocodeCity, type FetchLike } from './open-meteo'

// The daily weather job (scheduled task, every day at 08:00 India time). It is the ONLY thing that talks to the weather service: opening the AC Calendar never does.
// For every city that has an AC in the AC sheet it saves the day's highest and lowest outside temperature; the calendar reads what is saved.
//  - every run re-reads the last 7 days (so yesterday's forecast is replaced by what really happened) plus today's forecast;
//  - a city seen for the first time also gets the last BACKFILL_DAYS days of history, once;
//  - a city the service cannot find is skipped (and tried again after RETRY_GEO_DAYS days); a failed city never stops the others.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export const BACKFILL_DAYS = 120
const ARCHIVE_LAG_DAYS = 8
const RECENT_DAYS = 7
const RETRY_GEO_DAYS = 7
const CONCURRENCY = 5

export interface WeatherRefreshResult {
  cities: number; refreshed: number; backfilled: number; geocodeFailed: number; failed: number; rows: number
  /** the cities the service does not know, and the ones whose temperatures could not be read today (at most 60 of each are listed) */
  notFound: string[]
  failedCities: string[]
}

const norm = (s: string | null | undefined) => (s ?? '').trim()
const addDays = (key: string, n: number) => dayKey(Date.parse(`${key}T00:00:00+05:30`) + n * 86_400_000)

function must<T>(res: { data?: T; error?: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}

/**
 * TEMPORARY: while the AC Google Sheet is incomplete, the city and state of every store in the Store Master count as well as the sheet's own. When the sheet is complete,
 * set this to false and only the AC sheet's cities are used (one line; nothing else changes).
 */
export const ALSO_USE_STORE_MASTER_CITIES = true

export type CityRef = { city: string; state: string }

/** The place filter on the two tables: the AC sheet's own columns, and the Store Master's. */
const UNIT_COLUMN = { store: 'store_code', cluster: 'cluster', region: 'region', state: 'state' } as const
const STORE_COLUMN = { store: 'code', cluster: 'cluster', region: 'region', state: 'state' } as const
export type CityPlace = { kind: keyof typeof UNIT_COLUMN; key: string }

async function distinctCities(db: Db, table: 'master_ac_units' | 'stores', orgId: string | undefined, place: CityPlace | null, into: Map<string, CityRef>) {
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select('city, state')
    if (table === 'master_ac_units') q = q.eq('is_active', true).is('removed_at', null)
    if (orgId) q = q.eq('org_id', orgId)
    if (place) q = q.eq((table === 'stores' ? STORE_COLUMN : UNIT_COLUMN)[place.kind], place.kind === 'store' ? place.key.toUpperCase() : place.key)
    const rows = must<{ city: string | null; state: string | null }[]>(await q.order('id', { ascending: true }).range(from, from + 999), 'read cities') ?? []
    for (const r of rows) {
      const city = norm(r.city)
      if (!city) continue
      const state = norm(r.state)
      const k = `${city.toLowerCase()}|${state.toLowerCase()}`
      if (!into.has(k)) into.set(k, { city, state })
    }
    if (rows.length < 1000) break
  }
}

/** The distinct cities of a place (or of everything): the AC sheet's, plus, for now, the Store Master's. A city is identified by its name and state. */
export async function cityList(db: Db, orgId?: string, place: CityPlace | null = null): Promise<CityRef[]> {
  const seen = new Map<string, CityRef>()
  await distinctCities(db, 'master_ac_units', orgId, place, seen)
  if (ALSO_USE_STORE_MASTER_CITIES) await distinctCities(db, 'stores', orgId, place, seen)
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
  const cities = await cityList(db, opts.orgId)
  const result: WeatherRefreshResult = { cities: cities.length, refreshed: 0, backfilled: 0, geocodeFailed: 0, failed: 0, rows: 0, notFound: [], failedCities: [] }

  await runLimited(cities, async ({ city, state }) => {
    try {
      // where the city is (asked once and kept)
      let geo = (await db.from('weather_city_geo').select('lat, lon, geocoded_at').eq('city', city).eq('state', state).maybeSingle()).data as { lat: number | null; lon: number | null; geocoded_at: string } | null
      const stale = geo && geo.lat === null && now - new Date(geo.geocoded_at).getTime() > RETRY_GEO_DAYS * 86_400_000
      if (!geo || stale) {
        const hit = await geocodeCity(f, city, state)
        geo = { lat: hit?.latitude ?? null, lon: hit?.longitude ?? null, geocoded_at: new Date(now).toISOString() }
        must(await db.from('weather_city_geo').upsert({ city, state, lat: geo.lat, lon: geo.lon, place_name: hit ? `${hit.name}${hit.admin1 ? `, ${hit.admin1}` : ''}` : null, geocoded_at: geo.geocoded_at }, { onConflict: 'city,state' }), 'save place')
      }
      if (geo.lat === null || geo.lon === null) { result.geocodeFailed++; if (result.notFound.length < 60) result.notFound.push(state ? `${city} (${state})` : city); return }

      const rows: { city: string; state: string; day: string; tmax: number | null; tmin: number | null; fetched_at: string }[] = []
      const stamp = new Date(now).toISOString()
      const keep = (list: { day: string; tmax: number | null; tmin: number | null }[] | null) => { for (const d of list ?? []) rows.push({ city, state, day: d.day, tmax: d.tmax, tmin: d.tmin, fetched_at: stamp }) }

      // a city with no history yet gets it once
      const old = await db.from('weather_city_daily').select('day', { count: 'exact', head: true }).eq('city', city).eq('state', state).lte('day', addDays(today, -30))
      if ((old.count ?? 0) === 0) {
        keep(await fetchArchive(f, geo.lat, geo.lon, addDays(today, -BACKFILL_DAYS), addDays(today, -ARCHIVE_LAG_DAYS)))
        result.backfilled++
      }
      const recent = await fetchRecent(f, geo.lat, geo.lon, RECENT_DAYS)
      if (recent === null && rows.length === 0) { result.failed++; if (result.failedCities.length < 60) result.failedCities.push(state ? `${city} (${state})` : city); return }
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

export interface DayWeather { tmax: number | null; tmin: number | null; cities: number }

/** For a set of cities: the highest and lowest temperature per day, averaged over the cities that have a saved value (one city = its own values). Reads only what is saved. */
export async function weatherFor(db: Db, cities: { city: string; state: string }[], from: string, to: string): Promise<{ days: Record<string, DayWeather>; cities: string[]; missing: number }> {
  const wanted = new Map(cities.map((c) => [`${c.city}|${c.state}`, c]))
  const names = [...new Set(cities.map((c) => c.city))]
  const days: Record<string, { max: number[]; min: number[] }> = {}
  const have = new Set<string>()
  for (let i = 0; i < names.length; i += 100) {
    const rows = must<{ city: string; state: string; day: string; tmax: number | null; tmin: number | null }[]>(
      await db.from('weather_city_daily').select('city, state, day, tmax, tmin').in('city', names.slice(i, i + 100)).gte('day', from).lte('day', to), 'read temperatures') ?? []
    for (const r of rows) {
      if (!wanted.has(`${r.city}|${r.state}`)) continue
      have.add(`${r.city}|${r.state}`)
      const d = (days[r.day] ??= { max: [], min: [] })
      if (r.tmax !== null) d.max.push(Number(r.tmax))
      if (r.tmin !== null) d.min.push(Number(r.tmin))
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null)
  const out: Record<string, DayWeather> = {}
  for (const [day, d] of Object.entries(days)) out[day] = { tmax: avg(d.max), tmin: avg(d.min), cities: Math.max(d.max.length, d.min.length) }
  return { days: out, cities: [...have].map((k) => wanted.get(k)!.city), missing: wanted.size - have.size }
}
