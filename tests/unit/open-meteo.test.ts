// The weather helpers: state codes of the Store Master, choosing the right city, reading the service's answer. No network: the fetcher is replaced.
import { describe, it, expect } from 'vitest'
import { fetchArchive, fetchRecent, fixSpelling, geocodeCity, nameParts, parseDaily, pickGeocode, stateName, type FetchLike, type GeoResult } from '@/lib/weather/open-meteo'

const geo = (o: Partial<GeoResult>): GeoResult => ({ name: 'Pakur', latitude: 24.6, longitude: 87.8, admin1: 'Jharkhand', country_code: 'IN', population: 1000, ...o })

describe('choosing the city', () => {
  it('turns the Store Master state codes into names', () => {
    expect(stateName('JAMMU & KASHMIR')).toBe('jammu and kashmir'); expect(pickGeocode([geo({ name: 'Delhi', admin1: 'National Capital Territory of Delhi', population: 5 }), geo({ name: 'Other', admin1: 'Punjab', population: 99 })], 'DL')?.name).toBe('Delhi')
    expect(stateName('JH')).toBe('jharkhand'); expect(stateName('dl')).toBe('delhi'); expect(stateName('West Bengal')).toBe('west bengal'); expect(stateName('WB')).toBe('west bengal')
  })
  it('takes the city in the right state, the biggest first; otherwise the biggest in India; never a city abroad', () => {
    const list = [geo({ name: 'A', admin1: 'Punjab', population: 9000 }), geo({ name: 'B', admin1: 'Jharkhand', population: 10 }), geo({ name: 'C', admin1: 'Jharkhand', population: 500 }), geo({ name: 'D', country_code: 'IR', admin1: 'Jharkhand', population: 99999 })]
    expect(pickGeocode(list, 'JH')?.name).toBe('C')
    expect(pickGeocode(list, 'KL')?.name).toBe('A')
    expect(pickGeocode([geo({ country_code: 'IR' })], 'JH')).toBeNull()
    expect(pickGeocode(undefined, 'JH')).toBeNull()
    expect(pickGeocode([geo({ admin1: 'Delhi', name: 'Delhi' })], 'Delhi')?.name).toBe('Delhi')
  })
})

describe('a locality instead of a city', () => {
  it('splits the name into its parts, last part first', () => {
    expect(nameParts('Panchranga Mor-Cooch Behar')).toEqual(['Cooch Behar', 'Panchranga Mor', 'Cooch', 'Panchranga'])
    expect(nameParts('Pakur')).toEqual([])
    expect(nameParts('Salt Lake, Kolkata')).toEqual(['Kolkata', 'Salt Lake', 'Salt'])
    expect(nameParts('ALLAHABAD CIVIL LINES')).toEqual(['ALLAHABAD CIVIL', 'ALLAHABAD'])
    expect(nameParts('AZAMGARGH-1')).toEqual(['AZAMGARGH'])
  })
  it('tries the parts when the whole name is unknown, but only accepts a place in the same state', async () => {
    const asked: string[] = []
    const f: FetchLike = async (u) => {
      const name = decodeURIComponent(/name=([^&]+)/.exec(u)![1]); asked.push(name)
      if (name === 'Cooch Behar') return { ok: true, json: async () => ({ results: [geo({ name: 'Cooch Behar', admin1: 'West Bengal' })] }) }
      if (name === 'Panchranga Mor') return { ok: true, json: async () => ({ results: [geo({ name: 'Wrong', admin1: 'Punjab' })] }) }
      return { ok: true, json: async () => ({}) }
    }
    expect((await geocodeCity(f, 'Panchranga Mor-Cooch Behar', 'WB'))?.name).toBe('Cooch Behar')
    expect(asked).toEqual(['Panchranga Mor-Cooch Behar', 'Cooch Behar'])
    const wrongOnly: FetchLike = async (u) => (decodeURIComponent(u).includes('name=Mor') ? { ok: true, json: async () => ({ results: [geo({ admin1: 'Punjab' })] }) } : { ok: true, json: async () => ({}) })
    expect(await geocodeCity(wrongOnly, 'Xx-Mor', 'WB')).toBeNull()
  })
})

describe('reading the answer', () => {
  it('reads the daily highest and lowest, rounded to one decimal, skipping days without a value', () => {
    const json = { daily: { time: ['2026-10-20', '2026-10-21', 'bad', '2026-10-22'], temperature_2m_max: [32.14, 30.96, 1, null], temperature_2m_min: [23, 20.8, 1, null] } }
    expect(parseDaily(json)).toEqual([{ day: '2026-10-20', tmax: 32.1, tmin: 23 }, { day: '2026-10-21', tmax: 31, tmin: 20.8 }])
    expect(parseDaily(null)).toEqual([]); expect(parseDaily({ daily: {} })).toEqual([])
  })
  it('a service that fails or answers badly gives null / nothing, never an error', async () => {
    const down: FetchLike = async () => { throw new Error('offline') }
    const bad: FetchLike = async () => ({ ok: false, json: async () => ({}) })
    expect(await fetchRecent(down, 1, 1, 7)).toBeNull(); expect(await fetchArchive(bad, 1, 1, '2026-01-01', '2026-01-02')).toBeNull(); expect(await geocodeCity(down, 'Pakur', 'JH')).toBeNull()
  })
  it('asks with the city name only', async () => {
    const urls: string[] = []
    const ok: FetchLike = async (u) => { urls.push(u); return { ok: true, json: async () => ({ results: [geo({})] }) } }
    expect((await geocodeCity(ok, 'Pakur', 'JH'))?.latitude).toBe(24.6)
    expect(urls[0]).toContain('name=Pakur'); expect(urls[0]).toContain('countryCode=IN'); expect(urls[0]).not.toMatch(/ticket|@/i)
  })
})

describe('spellings seen in the Store Master', () => {
  it('corrects known wrong spellings word by word and leaves right names alone', () => {
    expect(fixSpelling('GWAHATI')).toBe('Guwahati'); expect(fixSpelling('LUCKHNOW MUNSIPULIA')).toBe('Lucknow MUNSIPULIA'); expect(fixSpelling('Pakur')).toBeNull()
  })
  it('a corrected spelling is found in the same state; the same name in another state is not taken', async () => {
    const f: FetchLike = async (u) => {
      const name = decodeURIComponent(/name=([^&]+)/.exec(u)![1])
      return { ok: true, json: async () => ({ results: name === 'Guwahati' ? [geo({ name: 'Guwahati', admin1: 'Assam' }), geo({ name: 'Guwahati', admin1: 'Punjab', population: 99999 })] : [] }) }
    }
    expect((await geocodeCity(f, 'GWAHATI', 'ASSAM'))?.admin1).toBe('Assam')
    expect(await geocodeCity(f, 'GWAHATI', 'KERALA')).toBeNull()
  })
})
