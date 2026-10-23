// The free public Open-Meteo service (no key). Pure helpers and two small fetchers; the fetch function is passed in so tests never touch the network.
// Only a city name and state are ever sent. Used by the daily 08:00 job (lib/weather/refresh.ts), never by a page view.

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/** The Store Master writes the state as a 2-letter code (JH, DL ...). Open-Meteo names the state in full. */
export const INDIA_STATES: Record<string, string> = {
  AN: 'andaman and nicobar islands', AP: 'andhra pradesh', AR: 'arunachal pradesh', AS: 'assam', BR: 'bihar', CH: 'chandigarh', CG: 'chhattisgarh', CT: 'chhattisgarh',
  DD: 'dadra and nagar haveli and daman and diu', DN: 'dadra and nagar haveli and daman and diu', DL: 'delhi', GA: 'goa', GJ: 'gujarat', HR: 'haryana',
  HP: 'himachal pradesh', JK: 'jammu and kashmir', JH: 'jharkhand', KA: 'karnataka', KL: 'kerala', LA: 'ladakh', LD: 'lakshadweep', MP: 'madhya pradesh',
  MH: 'maharashtra', MN: 'manipur', ML: 'meghalaya', MZ: 'mizoram', NL: 'nagaland', OD: 'odisha', OR: 'odisha', PY: 'puducherry', PB: 'punjab', RJ: 'rajasthan',
  SK: 'sikkim', TN: 'tamil nadu', TG: 'telangana', TS: 'telangana', TR: 'tripura', UP: 'uttar pradesh', UK: 'uttarakhand', UT: 'uttarakhand', WB: 'west bengal',
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
/** The state as a plain lower-case name ('JH' -> 'jharkhand', 'Delhi' -> 'delhi'). */
export const stateName = (state: string) => INDIA_STATES[state.trim().toUpperCase()] ?? fold(state)

export interface GeoResult { name: string; latitude: number; longitude: number; admin1?: string; country_code?: string; population?: number }

/** The best match for a city in a state: the one in the right state (largest first), else the largest city of that name in India; null when nothing fits. */
export function pickGeocode(results: GeoResult[] | undefined, state: string, opts: { sameStateOnly?: boolean } = {}): GeoResult | null {
  const india = (results ?? []).filter((r) => (r.country_code ?? 'IN') === 'IN' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
  if (india.length === 0) return null
  const want = stateName(state)
  const big = (a: GeoResult, b: GeoResult) => (b.population ?? 0) - (a.population ?? 0)
  // (the service writes 'National Capital Territory of Delhi' for 'Delhi', and the Store Master writes 'JAMMU & KASHMIR')
  const sameState = (admin1: string) => { const a = fold(admin1); return a === want || a.includes(want) || want.includes(a) }
  const inState = want ? india.filter((r) => r.admin1 && sameState(r.admin1)).sort(big) : []
  return inState[0] ?? (opts.sameStateOnly ? null : [...india].sort(big)[0] ?? null)
}

/** "Panchranga Mor-Cooch Behar" is a locality, not a city: the parts of such a name ("Cooch Behar", "Panchranga Mor"), last part first. */
export function nameParts(city: string): string[] {
  const parts = city.split(/\s*[-,/(|]\s*|\s+(?:near|nr)\s+/i).map((p) => p.replace(/[)]/g, '').trim()).filter((p) => p.length >= 3 && p.toLowerCase() !== city.trim().toLowerCase())
  // 'ALLAHABAD CIVIL LINES' -> 'ALLAHABAD CIVIL' -> 'ALLAHABAD': the front of a long name is usually the town
  const fronts: string[] = []
  for (const p of [...parts].reverse().concat(parts.length === 0 ? [city.trim()] : [])) {
    const words = p.split(/\s+/)
    for (let n = words.length - 1; n >= 1; n--) { const w = words.slice(0, n).join(' '); if (w.length >= 4) fronts.push(w) }
  }
  return [...new Set([...parts.reverse(), ...fronts])].filter((p) => p.toLowerCase() !== city.trim().toLowerCase())
}

export const geocodeUrl = (city: string) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&countryCode=IN&language=en&format=json`
const DAILY = 'daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FKolkata'
/** The last `pastDays` days and today (the day's forecast). */
export const recentUrl = (lat: number, lon: number, pastDays: number) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&${DAILY}&past_days=${pastDays}&forecast_days=1`
/** Confirmed history (it lags a few days behind). */
export const archiveUrl = (lat: number, lon: number, from: string, to: string) => `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}&${DAILY}`

export interface DayTemp { day: string; tmax: number | null; tmin: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

export function parseDaily(json: unknown): DayTemp[] {
  const d = (json as { daily?: { time?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown } } | null)?.daily
  if (!d || !Array.isArray(d.time)) return []
  const max = Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max : []
  const min = Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min : []
  const out: DayTemp[] = []
  d.time.forEach((t, i) => {
    if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return
    const row = { day: t, tmax: num(max[i]), tmin: num(min[i]) }
    if (row.tmax !== null || row.tmin !== null) out.push(row)
  })
  return out
}

async function getJson(f: FetchLike, url: string): Promise<unknown | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(15_000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Spellings seen in the Store Master that the weather service does not know, and what they should be (lower case). */
export const SPELLING_FIXES: Record<string, string> = {
  buxer: 'Buxar', raibareli: 'Rae Bareli', gwahati: 'Guwahati', gaziabad: 'Ghaziabad', luckhnow: 'Lucknow', azamgargh: 'Azamgarh', alahabad: 'Prayagraj', allahabad: 'Prayagraj',
  aarah: 'Arrah', giridhi: 'Giridih', muzzafarpur: 'Muzaffarpur', khagadia: 'Khagaria', phoolbani: 'Phulbani', lakimpur: 'Lakhimpur', mughalsarai: 'Mughal Sarai',
  aara: 'Arrah',
}
/** The same name with the known wrong spellings corrected word by word; null when nothing changed. */
export function fixSpelling(name: string): string | null {
  const out = name.replace(/[A-Za-z]+/g, (w) => SPELLING_FIXES[w.toLowerCase()] ?? w)
  return out === name ? null : out
}

/**
 * The name as written first (any Indian match, the right state preferred). If the service does not know it: the corrected spelling, then each part of the name and the front
 * words of a long name, each also corrected - but then only a place in the SAME state is accepted, so a wrong town is never taken.
 */
export async function geocodeCity(f: FetchLike, city: string, state: string): Promise<GeoResult | null> {
  const ask = async (name: string, sameStateOnly: boolean) => {
    const json = (await getJson(f, geocodeUrl(name))) as { results?: GeoResult[] } | null
    return pickGeocode(json?.results, state, { sameStateOnly })
  }
  const first = await ask(city, false)
  if (first) return first
  const tried = new Set([city.toLowerCase()])
  for (const base of [city, ...nameParts(city)]) {
    for (const name of [base, fixSpelling(base)]) {
      if (!name || tried.has(name.toLowerCase())) continue
      tried.add(name.toLowerCase())
      const found = await ask(name, true)
      if (found) return found
    }
  }
  return null
}
export async function fetchRecent(f: FetchLike, lat: number, lon: number, pastDays: number): Promise<DayTemp[] | null> {
  const json = await getJson(f, recentUrl(lat, lon, pastDays))
  return json ? parseDaily(json) : null
}
export async function fetchArchive(f: FetchLike, lat: number, lon: number, from: string, to: string): Promise<DayTemp[] | null> {
  const json = await getJson(f, archiveUrl(lat, lon, from, to))
  return json ? parseDaily(json) : null
}
