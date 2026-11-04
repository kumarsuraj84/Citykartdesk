'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadAcCalendarData, type AcCalendarData } from '@/lib/queries/ac-calendar'
import { levelFor } from '@/lib/reporting/executive/levels'
import { PLACE_KINDS, type PlaceKind } from '@/lib/reporting/executive/ac-calendar'
import { stateList, weatherFor, type DayWeather, type CityRef } from '@/lib/weather/refresh'
import { canonicalState, STATE_ROW } from '@/lib/weather/states'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** The AC Calendar's rows for the signed-in viewer (the same people who can open the Smart Dashboard). */
export async function loadAcCalendar(): Promise<AcCalendarData | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!profile.org_id || !levelFor(profile.role)) return { error: "You don't have access to this dashboard." }
  return loadAcCalendarData(profile)
}

export interface AcWeather {
  days: Record<string, DayWeather>
  /** the states the temperatures are taken from */
  cities: string[]
  /** states of the place that have no saved temperature yet */
  missing: number
}

/** The saved highest / lowest temperature per day for a place (by state; the average when the place covers several states). Reads only what the daily 08:00 job saved: it never calls the weather service. */
export async function getAcWeather(input: { kind: PlaceKind; key: string; from: string; to: string; states?: string[] }): Promise<AcWeather | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !levelFor(profile.role)) return { error: 'Not authenticated.' }
  const kind = input.kind
  if (!PLACE_KINDS.includes(kind)) return { error: 'Unknown place.' }
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (!date.test(input.from) || !date.test(input.to) || input.from > input.to || Date.parse(input.to) - Date.parse(input.from) > 62 * 86_400_000) return { error: 'Unknown dates.' }
  // With nothing picked ("all"), the screen names the states of the machines the viewer can see; each is checked against the known states, so only real states are read.
  if (kind === 'all') {
    const seen = new Map<string, CityRef>()
    for (const s of Array.isArray(input.states) ? input.states.slice(0, 80) : []) { const p = typeof s === 'string' ? canonicalState(s.slice(0, 60)) : null; if (p) seen.set(p.name, { city: p.name, state: STATE_ROW }) }
    if (seen.size === 0) return { days: {}, cities: [], missing: 0 }
    try {
      return await weatherFor(createAdminClient() as unknown as AnyClient, [...seen.values()], input.from, input.to)
    } catch {
      return { error: 'Could not read the temperatures.' }
    }
  }
  const key = String(input.key ?? '').slice(0, 120)
  if (!key) return { days: {}, cities: [], missing: 0 }

  const db = createAdminClient() as unknown as AnyClient
  let cities
  try {
    cities = await stateList(db, profile.org_id, { kind, key })
  } catch {
    return { error: 'Could not read the states.' }
  }
  try {
    return await weatherFor(db, cities, input.from, input.to)
  } catch {
    return { error: 'Could not read the temperatures.' }
  }
}
