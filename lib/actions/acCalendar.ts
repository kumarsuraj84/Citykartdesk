'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadAcCalendarData, type AcCalendarData } from '@/lib/queries/ac-calendar'
import { levelFor } from '@/lib/reporting/executive/levels'
import { PLACE_KINDS, type PlaceKind } from '@/lib/reporting/executive/ac-calendar'
import { cityList, weatherFor, type DayWeather } from '@/lib/weather/refresh'

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
  /** the cities the temperatures are taken from */
  cities: string[]
  /** cities of the place that have no saved temperature yet */
  missing: number
}

/** The saved highest / lowest temperature per day for a place (the average of its cities). Reads only what the daily 08:00 job saved: it never calls the weather service. */
export async function getAcWeather(input: { kind: PlaceKind; key: string; from: string; to: string }): Promise<AcWeather | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !levelFor(profile.role)) return { error: 'Not authenticated.' }
  const kind = input.kind
  if (!PLACE_KINDS.includes(kind)) return { error: 'Unknown place.' }
  const date = /^\d{4}-\d{2}-\d{2}$/
  if (!date.test(input.from) || !date.test(input.to) || input.from > input.to || Date.parse(input.to) - Date.parse(input.from) > 62 * 86_400_000) return { error: 'Unknown dates.' }
  if (kind === 'all') return { days: {}, cities: [], missing: 0 }
  const key = String(input.key ?? '').slice(0, 120)
  if (!key) return { days: {}, cities: [], missing: 0 }

  const db = createAdminClient() as unknown as AnyClient
  let cities
  try {
    cities = await cityList(db, profile.org_id, { kind, key })
  } catch {
    return { error: 'Could not read the cities.' }
  }
  try {
    return await weatherFor(db, cities, input.from, input.to)
  } catch {
    return { error: 'Could not read the temperatures.' }
  }
}
