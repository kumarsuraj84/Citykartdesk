// The AC Calendar on the isolated stack: the daily weather job (with a pretend weather service: nothing leaves this PC), what happens when a city cannot be found or the
// service is down, that a page view never calls the service, the server-only fences on the new tables, and that the calendar's rows follow the viewer's access.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { refreshWeather, weatherFor, cityList } from '@/lib/weather/refresh'
import { loadAcCalendarData } from '@/lib/queries/ac-calendar'
import type { FetchLike } from '@/lib/weather/open-meteo'

vi.setConfig({ testTimeout: 120_000 })
const db = () => getAdmin() as any // eslint-disable-line @typescript-eslint/no-explicit-any
const tag = `t38${String(Date.now()).slice(-6)}`
let fx: D03Fixtures
const CITY_OK = `${tag}Pakur`, CITY_NONE = `${tag}Nowhere`, CITY_DOWN = `${tag}Downtown`
const STORE_A = `${tag}A`.toUpperCase(), STORE_B = `${tag}B`.toUpperCase()
const made: string[] = []
const cats: string[] = []

const today = (ms = Date.now()) => new Date(ms + 19_800_000).toISOString().slice(0, 10)
const addDays = (key: string, n: number) => today(Date.parse(`${key}T00:00:00+05:30`) + n * 86_400_000)

/** A pretend service: knows two of the three cities; the third answers geocoding but then fails on the forecast. */
function pretend(calls: string[]): FetchLike {
  return async (url) => {
    calls.push(url)
    if (url.includes('geocoding-api')) {
      const name = decodeURIComponent(/name=([^&]+)/.exec(url)![1])
      if (name === CITY_NONE) return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ results: [{ name, latitude: name === CITY_DOWN ? 10 : 24.6, longitude: 87.8, admin1: 'Jharkhand', country_code: 'IN', population: 1 }] }) }
    }
    const lat = Number(/latitude=([\d.]+)/.exec(url)![1])
    if (lat === 10) throw new Error('service down')
    const t0 = today()
    const from = url.includes('archive') ? /start_date=([\d-]+)/.exec(url)![1] : addDays(t0, -7)
    const to = url.includes('archive') ? /end_date=([\d-]+)/.exec(url)![1] : t0
    const time: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) time.push(d)
    return { ok: true, json: async () => ({ daily: { time, temperature_2m_max: time.map(() => 33.4), temperature_2m_min: time.map(() => 22.1) } }) }
  }
}

beforeAll(async () => {
  fx = await setupD03Fixtures()
  const a = db()
  const unit = (store: string, no: string, city: string) => ({ org_id: fx.orgId, store_code: store, ckdesk_no: no, serial: `${store}-${no}`, brand: 'VOLTAS', tonnage: '1.5', region: `${tag}R`, cluster: `${tag}C`, state: 'JH', city, emails: [], sheet_row: 99000 + Number(no) })
  await a.from('master_ac_units').insert([unit(STORE_A, '1', CITY_OK), unit(STORE_A, '2', CITY_OK), unit(STORE_B, '1', CITY_NONE), unit(STORE_B, '2', CITY_DOWN)])
}, 300_000)

afterAll(async () => {
  const a = db()
  await a.from('master_ac_units').delete().like('store_code', `${tag.toUpperCase()}%`)
  await a.from('weather_city_daily').delete().like('city', `${tag}%`)
  await a.from('weather_city_geo').delete().like('city', `${tag}%`)
  if (made.length) { await a.from('request_master_snapshots').delete().in('request_id', made); await a.from('request_activity').delete().in('request_id', made); await a.from('requests').delete().in('id', made) }
  if (cats.length) await a.from('service_categories').delete().in('id', cats)
  await fx?.cleanup()
}, 180_000)

describe('the daily weather job', () => {
  it('saves the highest and lowest temperature of every city that has an AC; a city that is not found or a service that is down does not stop the others', async () => {
    const calls: string[] = []
    const r = await refreshWeather(db(), pretend(calls), { orgId: fx.orgId })
    // (the organisation's real store cities are in the list too, so only our three are checked)
    expect(r.notFound.some((c) => c.startsWith(CITY_NONE))).toBe(true)        // the city the service does not know
    expect(r.failedCities.some((c) => c.startsWith(CITY_DOWN))).toBe(true)    // the city whose forecast failed
    expect(r.notFound.some((c) => c.startsWith(CITY_OK)) || r.failedCities.some((c) => c.startsWith(CITY_OK))).toBe(false)
    expect(r.refreshed).toBeGreaterThanOrEqual(1)
    const w = await weatherFor(db(), [{ city: CITY_OK, state: 'JH' }], addDays(today(), -3), today())
    expect(w.days[today()]).toMatchObject({ tmax: 33.4, tmin: 22.1, cities: 1 })
    expect(w.missing).toBe(0)
    // only city names went out
    expect(calls.every((u) => u.startsWith('https://') && !/@|ticket|CKSD/i.test(u))).toBe(true)
    expect(calls.some((u) => u.includes('archive-api'))).toBe(true)   // a new city gets its history once
  })

  it('a city with no saved temperature shows as missing; the average of a place uses the cities that have one', async () => {
    const w = await weatherFor(db(), [{ city: CITY_OK, state: 'JH' }, { city: CITY_NONE, state: 'JH' }, { city: CITY_DOWN, state: 'JH' }], today(), today())
    expect(w.cities).toEqual([CITY_OK]); expect(w.missing).toBe(2); expect(w.days[today()].tmax).toBe(33.4)
  })

  it('the next run only re-reads the last days (no history again), does not ask again for a place it already knows, and retries a city the service did not find only after a week', async () => {
    const calls: string[] = []
    await refreshWeather(db(), pretend(calls), { orgId: fx.orgId })
    expect(calls.some((u) => u.includes('archive-api') && u.includes('latitude=24.6'))).toBe(false)   // a city that already has history is not backfilled again
    expect(calls.filter((u) => u.includes('geocoding-api') && u.includes(CITY_OK))).toHaveLength(0)
    expect(calls.filter((u) => u.includes('geocoding-api') && u.includes(CITY_NONE))).toHaveLength(0)
    const later: string[] = []
    await refreshWeather(db(), pretend(later), { orgId: fx.orgId, now: Date.now() + 8 * 86_400_000 })
    expect(later.filter((u) => u.includes('geocoding-api') && u.includes(CITY_NONE))).toHaveLength(1)
  })

  it('lists each city once, and (for now) also the cities of the Store Master, so a store the AC sheet does not have yet still gets its temperature', async () => {
    const a = db()
    const store = (await a.from('stores').insert({ org_id: fx.orgId, code: `${tag}ST`.toUpperCase(), name: 'x', city: `${tag}Storetown`, state: 'JH' }).select('id').single()).data.id as string
    const list = (await cityList(db(), fx.orgId)).filter((c) => c.city.startsWith(tag))
    expect(list.map((c) => c.city).sort()).toEqual([CITY_DOWN, CITY_NONE, CITY_OK, `${tag}Storetown`].sort())
    const one = await cityList(db(), fx.orgId, { kind: 'store', key: `${tag}ST` })
    expect(one).toEqual([{ city: `${tag}Storetown`, state: 'JH' }])
    await a.from('stores').delete().eq('id', store)
  })
})

describe('the server-only tables', () => {
  it('a signed-in user cannot read or write the saved temperatures through the data API', async () => {
    const user = clientForToken(fx.requesterA.accessToken) as never as { from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ error: unknown }> }; insert: (r: unknown) => Promise<{ error: unknown }> } }
    for (const t of ['weather_city_geo', 'weather_city_daily']) {
      expect((await user.from(t).select('*').limit(1)).error, t).not.toBeNull()
      expect((await user.from(t).insert({ city: 'x', state: 'y', day: '2026-01-01' })).error, t).not.toBeNull()
    }
  })
})

describe('the calendar rows follow the viewer', () => {
  it('lists the machines of the AC and Genset sheets and the viewer\'s AC / genset tickets (which machine, raised, fixed); cancelled tickets and tickets of other categories are left out; an administrator sees every machine, others only their stores', async () => {
    const a = db()
    const store = (await a.from('stores').insert({ org_id: fx.orgId, code: STORE_A, name: `${tag} store A`, region: 'R9', cluster: 'C9', state: 'JH', city: CITY_OK }).select('id').single()).data.id as string
    await a.from('profiles').update({ store_id: store }).eq('id', fx.requesterA.id)
    const catAc = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} ac`, slug: `${tag}-ac`, auto_oem_kind: 'ac' }).select('id').single()).data.id as string
    const catGen = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} gen`, slug: `${tag}-gen`, auto_oem_kind: 'genset' }).select('id').single()).data.id as string
    const catOther = (await a.from('service_categories').insert({ org_id: fx.orgId, name: `${tag} other`, slug: `${tag}-other` }).select('id').single()).data.id as string
    cats.push(catAc, catGen, catOther)
    await a.from('master_gensets').insert({ org_id: fx.orgId, store_code: STORE_A, brand: 'CUMMINS', kva: '125', serial: `G-${tag}`, emails: [], sheet_row: 98001 })
    const unit = { id: '00000000-0000-0000-0000-0000000000cc', store_code: STORE_A, ckdesk_no: '1', serial: `${STORE_A}-1`, brand: 'VOLTAS', tonnage: '1.5' }
    const mk = async (cat: string, kind: 'ac' | 'genset' | null, status: string, createdAgo: number, resolvedAgo: number | null, teamId = fx.teamA.id, requester = fx.requesterA.id) => {
      const r = (await a.from('requests').insert({
        request_no: '', title: `${tag} ticket`, requester_id: requester, service_id: fx.teamA.serviceId, team_id: teamId, category_id: cat, status,
        created_at: new Date(Date.now() - createdAgo * 86_400_000).toISOString(), resolved_at: resolvedAgo === null ? null : new Date(Date.now() - resolvedAgo * 86_400_000).toISOString(),
      }).select('id').single()).data.id as string
      made.push(r)
      if (kind) await a.from('request_master_snapshots').insert({ request_id: r, kind, unit_ids: [unit.id], snapshot: [unit] })
      return r
    }
    const open = await mk(catAc, 'ac', 'in_progress', 2, null)
    const done = await mk(catAc, 'ac', 'resolved', 10, 8)
    const gen = await mk(catGen, 'genset', 'in_progress', 3, null)
    const cancelled = await mk(catAc, 'ac', 'cancelled', 5, null)
    const other = await mk(catOther, null, 'in_progress', 1, null)   // same service, but not machine work
    // another group's AC ticket: the technician of team A must never see it
    const teamBTicket = await mk(catAc, 'ac', 'in_progress', 4, null, fx.teamB.id, fx.requesterB.id)

    const profileOf = async (id: string) => {
      const p = (await a.from('profiles').select('*').eq('id', id).single()).data
      const tm = (await a.from('team_members').select('team_id, user_id, org_id').eq('user_id', id)).data ?? []
      return { ...p, team_members: tm } as never
    }
    const data = await loadAcCalendarData(await profileOf(fx.admin.id), { fresh: true })
    if ('error' in data) throw new Error(data.error)
    const mine = data.tickets.filter((t) => made.includes(t.id))
    expect(mine.map((t) => t.id).sort()).toEqual([open, done, gen, teamBTicket].sort())   // not the cancelled one, not the other category
    expect(mine.map((t) => t.id)).not.toContain(cancelled); expect(mine.map((t) => t.id)).not.toContain(other)
    expect(mine.find((t) => t.id === open)).toMatchObject({ kind: 'ac', ac: `${STORE_A}|1`, resolved: null, store: STORE_A })
    expect(mine.find((t) => t.id === done)?.resolved).not.toBeNull()
    expect(mine.find((t) => t.id === gen)).toMatchObject({ kind: 'genset', ac: `${STORE_A}|genset` })
    expect(data.fleet.filter((x) => x.store === STORE_A && x.kind === 'ac')).toHaveLength(2)   // the two AC rows made in beforeAll
    expect(data.fleet.filter((x) => x.store === STORE_A && x.kind === 'genset')).toHaveLength(1)
    expect(data.fleet.find((x) => x.kind === 'genset' && x.store === STORE_A)).toMatchObject({ region: 'R9', cluster: 'C9', state: 'JH', city: CITY_OK })
    expect(data.fleet.filter((x) => x.store === STORE_B)).toHaveLength(2)   // the administrator sees every store's machines

    // a technician of team A: only team A's tickets, never team B's
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.agentA.accessToken) as never)
    const tech = await loadAcCalendarData(await profileOf(fx.agentA.id), { fresh: true })
    if ('error' in tech) throw new Error(tech.error)
    const seen = tech.tickets.filter((t) => made.includes(t.id)).map((t) => t.id)
    expect(seen.sort()).toEqual([open, done, gen].sort())
    expect(seen).not.toContain(teamBTicket)

    // a store login: only its own tickets and its own store's machines
    vi.mocked(createClient).mockResolvedValue(clientForToken(fx.requesterA.accessToken) as never)
    const own = await loadAcCalendarData(await profileOf(fx.requesterA.id), { fresh: true })
    if ('error' in own) throw new Error(own.error)
    expect(own.myStore).toBe(STORE_A)
    expect(own.fleet.every((x) => x.store === STORE_A)).toBe(true)
    expect(own.tickets.filter((t) => made.includes(t.id)).map((t) => t.id)).not.toContain(teamBTicket)

    await a.from('master_gensets').delete().eq('store_code', STORE_A)
    await a.from('profiles').update({ store_id: null }).eq('id', fx.requesterA.id)
    await a.from('stores').delete().eq('id', store)
  })
})
