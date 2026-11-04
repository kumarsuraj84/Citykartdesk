import { describe, it, expect } from 'vitest'
import { canonicalState, STATE_POINTS, STATE_ROW } from '@/lib/weather/states'
import { INDIA_STATES } from '@/lib/weather/open-meteo'
import { refreshWeather, stateList, weatherFor } from '@/lib/weather/refresh'

// The AC Calendar's temperature is by STATE: one fixed point per state, nothing looked up. In-memory stand-in for the tables.

describe('which state a value means', () => {
  it('knows every 2-letter code the Store Master uses, and the spellings seen', () => {
    for (const code of Object.keys(INDIA_STATES)) expect(canonicalState(code), code).not.toBeNull()
    expect(canonicalState('JH')?.name).toBe('Jharkhand')
    expect(canonicalState('jharkhand')?.name).toBe('Jharkhand')
    expect(canonicalState('JAMMU & KASHMIR')?.name).toBe('Jammu & Kashmir')
    expect(canonicalState('Orissa')?.name).toBe('Odisha')
    expect(canonicalState('OD')?.name).toBe('Odisha')
    expect(canonicalState('New Delhi')?.name).toBe('Delhi')
    expect(canonicalState('UT')?.name).toBe('Uttarakhand')
  })
  it('says nothing for a blank or an unknown value', () => {
    expect(canonicalState('')).toBeNull(); expect(canonicalState(null)).toBeNull(); expect(canonicalState('ALL')).toBeNull(); expect(canonicalState('GWAHATI UP')).toBeNull()
  })
  it('every point is inside India', () => {
    for (const p of Object.values(STATE_POINTS)) { expect(p.lat).toBeGreaterThan(6); expect(p.lat).toBeLessThan(37); expect(p.lon).toBeGreaterThan(68); expect(p.lon).toBeLessThan(98) }
  })
})

type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>) {
  const saved: Row[] = []
  const from = (t: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let head = false
    let upsertRows: Row[] | null = null
    let range: [number, number] | null = null
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b },
      lte: (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return b },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
      order: () => b,
      range: (a: number, z: number) => { range = [a, z]; return b },
      upsert: (rows: Row[]) => { upsertRows = rows; return b },
      then: (resolve: (v: unknown) => unknown) => {
        if (upsertRows) { if (t === 'weather_city_daily') { saved.push(...upsertRows); tables[t] = [...(tables[t] ?? []), ...upsertRows] } return resolve({ data: null, error: null }) }
        const hit = (tables[t] ?? []).filter((r) => filters.every((f) => f(r)))
        if (head) return resolve({ count: hit.length, data: null, error: null })
        return resolve({ data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null })
      },
    }
    return b
  }
  return { db: { from } as never, saved }
}

const forecast = (hi: number, lo: number) => async (url: string) => {
  const days = url.includes('archive-api') ? ['2026-10-01', '2026-10-02'] : ['2026-11-03', '2026-11-04']
  return { ok: true, json: async () => ({ daily: { time: days, temperature_2m_max: days.map(() => hi), temperature_2m_min: days.map(() => lo) } }) }
}

describe('the list of states', () => {
  // the Store Master is the one source; the AC sheet's own State column (which said "ALL" and sometimes a different state) is not read at all
  const tables = () => ({
    master_ac_units: [{ state: 'XX-SHEET-ONLY', is_active: true, removed_at: null, org_id: 'o' }],
    stores: [{ state: 'DL', org_id: 'o', code: 'S1' }, { state: '', org_id: 'o', code: 'S2' }, { state: 'JH', org_id: 'o', code: 'S3' }, { state: 'Jharkhand', org_id: 'o', code: 'S4' }, { state: 'ALL', org_id: 'o', code: 'S5' }],
  })
  it('lists each state once (from the Store Master only), leaves out blanks and unknown values', async () => {
    const { db } = fakeDb(tables())
    const list = await stateList(db, 'o')
    expect(list.map((x) => x.city).sort()).toEqual(['Delhi', 'Jharkhand'])
    expect(list.every((x) => x.state === STATE_ROW)).toBe(true)
  })
  it('the daily job also asks for the unknown values, so they can be listed', async () => {
    const { db } = fakeDb(tables())
    expect((await stateList(db, 'o', null, { includeUnknown: true })).map((x) => x.city).sort()).toEqual(['ALL', 'Delhi', 'Jharkhand'])
  })
  it('for one store: only that store\'s state', async () => {
    const { db } = fakeDb(tables())
    expect(await stateList(db, 'o', { kind: 'store', key: 's3' })).toEqual([{ city: 'Jharkhand', state: STATE_ROW }])
  })
})

describe('the daily job', () => {
  it('saves one set of temperatures per state, never looks a place up, lists what it does not know, and the calendar reads them back by state', async () => {
    const t = { stores: [{ state: 'JH' }, { state: 'ALL' }, { state: 'DL' }], weather_city_daily: [] as Row[] }
    const { db, saved } = fakeDb(t)
    const urls: string[] = []
    const f = forecast(33.4, 22.1)
    const r = await refreshWeather(db, async (u) => { urls.push(u); return f(u) }, { now: Date.parse('2026-11-04T08:00:00+05:30') })
    expect(r.cities).toBe(3)                       // Jharkhand, Delhi, and the 'ALL' value
    expect(r.refreshed).toBe(2)
    expect(r.notFound).toEqual(['ALL'])
    expect(urls.some((u) => u.includes('geocoding-api'))).toBe(false)
    expect(urls.some((u) => u.includes('latitude=23.34') && u.includes('longitude=85.31'))).toBe(true)   // Ranchi, Jharkhand's point
    expect(saved.every((x) => x.state === STATE_ROW)).toBe(true)
    const w = await weatherFor(db, [{ city: 'Jharkhand', state: STATE_ROW }], '2026-11-03', '2026-11-04')
    expect(w.days['2026-11-04']).toMatchObject({ tmax: 33.4, tmin: 22.1, cities: 1 })
    expect(w.cities).toEqual(['Jharkhand']); expect(w.missing).toBe(0)
  })
  it('a state that has history is not backfilled again, and a failing forecast for one state does not stop the others', async () => {
    const old = { city: 'Jharkhand', state: STATE_ROW, day: '2026-09-01', tmax: 30, tmin: 20 }
    const t = { stores: [{ state: 'JH' }, { state: 'DL' }], weather_city_daily: [old] as Row[] }
    const { db } = fakeDb(t)
    const urls: string[] = []
    const r = await refreshWeather(db, async (u) => {
      urls.push(u)
      if (u.includes('latitude=28.61')) return { ok: false, json: async () => ({}) }   // Delhi's forecast is down
      return forecast(31, 21)(u)
    }, { now: Date.parse('2026-11-04T08:00:00+05:30') })
    expect(r.refreshed).toBe(1); expect(r.failed).toBe(1); expect(r.failedCities).toEqual(['Delhi'])
    expect(urls.some((u) => u.includes('archive-api') && u.includes('latitude=23.34'))).toBe(false)
  })
})

describe('several states in view', () => {
  const rows = [
    { city: 'Delhi', state: STATE_ROW, day: '2026-11-04', tmax: 38, tmin: 24 },
    { city: 'Kerala', state: STATE_ROW, day: '2026-11-04', tmax: 30, tmin: 22 },
    { city: 'Goa', state: STATE_ROW, day: '2026-11-04', tmax: 33, tmin: null },
    { city: 'Delhi', state: STATE_ROW, day: '2026-11-03', tmax: 36, tmin: 23 },
  ]
  const want = ['Delhi', 'Kerala', 'Goa', 'Bihar'].map((city) => ({ city, state: STATE_ROW }))
  it('shows a range (highest high, lowest low) and each state\'s own values, never an average', async () => {
    const { db } = fakeDb({ weather_city_daily: rows.map((r) => ({ ...r })) })
    const w = await weatherFor(db, want, '2026-11-01', '2026-11-30')
    expect(w.days['2026-11-04']).toMatchObject({ tmax: 38, tmin: 22, cities: 3 })
    expect(w.days['2026-11-04'].parts).toEqual([
      { name: 'Delhi', tmax: 38, tmin: 24 }, { name: 'Goa', tmax: 33, tmin: null }, { name: 'Kerala', tmax: 30, tmin: 22 },
    ])
    expect(w.days['2026-11-03']).toMatchObject({ tmax: 36, tmin: 23, cities: 1 })    // one state: its own values
    expect(w.missing).toBe(1)                                                         // Bihar has nothing saved yet
  })
})

describe('the coming days', () => {
  it('the daily job asks for the last 7 days, today and the next 7 days in one request per state', async () => {
    const t = { stores: [{ state: 'JH' }], weather_city_daily: [] as Row[] }
    const { db, saved } = fakeDb(t)
    const urls: string[] = []
    const f = async (u: string) => {
      urls.push(u)
      const days = u.includes('archive-api') ? ['2026-10-01'] : ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-11']
      return { ok: true, json: async () => ({ daily: { time: days, temperature_2m_max: days.map(() => 34), temperature_2m_min: days.map(() => 20) } }) }
    }
    await refreshWeather(db, f, { now: Date.parse('2026-11-04T08:00:00+05:30') })
    const recent = urls.filter((u) => u.includes('api.open-meteo.com/v1/forecast'))
    expect(recent).toHaveLength(1)
    expect(recent[0]).toContain('past_days=7'); expect(recent[0]).toContain('forecast_days=8')
    expect(saved.some((r) => r.day === '2026-11-11')).toBe(true)      // a coming day is kept
  })
})
