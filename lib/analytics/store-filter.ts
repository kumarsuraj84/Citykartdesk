// The Store Master filters of the Analytics dashboard (region, state, cluster, store type, store priority list, AC health).
// Pure code, shared by the server (which filters the numbers) and the filter pop-up (which recomputes its lists live from what is ticked).
// The choice lives in the page address (?st_region=North|West&st_ac=Red flag), the same way the technician-group choice lives in ?groups=.

import { NOT_SET, NO_AC_DATA, RED_FLAG, WITHIN_LIMIT } from '@/lib/reporting/executive/engine'

export const STORE_FILTER_KEYS = ['region', 'state', 'cluster', 'stype', 'plist', 'ac'] as const
export type StoreKey = (typeof STORE_FILTER_KEYS)[number]

export const STORE_KEY_LABEL: Record<StoreKey, string> = {
  region: 'Region',
  state: 'State',
  cluster: 'Cluster',
  stype: 'Store type (NSO = new store)',
  plist: 'Store priority list as per Ops',
  ac: 'AC health (red flag = AC Not Working % above 30%)',
}

/** What a store is, as far as these filters are concerned. */
export interface StoreDims extends Record<StoreKey, string> {
  code: string
  name: string
  acOpen: number
  acTotal: number | null
  acPct: number | null
}

export type StoreFilter = Record<StoreKey, string[]>

/** One distinct combination of store details with how many tickets it has: all the pop-up needs to work out its lists. */
export type StoreCombo = Record<StoreKey, string> & { count: number }

export interface StoreOption { value: string; count: number }
export type StoreOptions = Record<StoreKey, StoreOption[]>

const AC_ORDER = [RED_FLAG, WITHIN_LIMIT, NO_AC_DATA]

export const emptyStoreFilter = (): StoreFilter => ({ region: [], state: [], cluster: [], stype: [], plist: [], ac: [] })

export const storeFilterCount = (f: StoreFilter): number => STORE_FILTER_KEYS.reduce((n, k) => n + f[k].length, 0)

const param = (k: StoreKey) => `st_${k}`

/** `?st_region=North|West` → the choices (de-duplicated, sane length). */
export function parseStoreFilter(sp: Record<string, string | undefined>): StoreFilter {
  const f = emptyStoreFilter()
  for (const k of STORE_FILTER_KEYS) {
    const raw = sp[param(k)]
    if (!raw) continue
    f[k] = [...new Set(raw.split('|').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 120))].slice(0, 200)
  }
  return f
}

/** The `&st_…=` part of a link that keeps these choices (empty when there are none). */
export function storeFilterQS(f: StoreFilter): string {
  return STORE_FILTER_KEYS.filter((k) => f[k].length > 0).map((k) => `&${param(k)}=${encodeURIComponent(f[k].join('|'))}`).join('')
}

/** Writes the choices into URL parameters (clearing the ones that are empty). */
export function applyStoreFilterToParams(params: URLSearchParams, f: StoreFilter): void {
  for (const k of STORE_FILTER_KEYS) {
    if (f[k].length > 0) params.set(param(k), f[k].join('|'))
    else params.delete(param(k))
  }
}

/** Does a store pass the choices? `skip` leaves one filter out (its own list is worked out without it). A requester with no store passes only when nothing is chosen. */
export function matchesStoreFilter(d: Pick<StoreDims, StoreKey> | null, f: StoreFilter, skip?: StoreKey): boolean {
  for (const k of STORE_FILTER_KEYS) {
    if (k === skip || f[k].length === 0) continue
    if (!d || !f[k].includes(d[k])) return false
  }
  return true
}

/**
 * The values each filter offers. Every list follows ALL THE OTHER choices (and, through the combinations given, the technician groups and the dates
 * the page is showing) but never its own, so more values can be added. Values that are ticked stay in their list with a count of 0 so they can be
 * un-ticked. "Not set" is offered as a choice too, so stores missing a cluster or region can be found.
 */
export function buildStoreOptions(combos: StoreCombo[], f: StoreFilter): StoreOptions {
  const out = {} as StoreOptions
  for (const key of STORE_FILTER_KEYS) {
    const counts = new Map<string, number>()
    for (const c of combos) if (matchesStoreFilter(c, f, key)) counts.set(c[key], (counts.get(c[key]) ?? 0) + c.count)
    for (const v of f[key]) if (!counts.has(v)) counts.set(v, 0)
    out[key] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => {
      if (key === 'ac') return AC_ORDER.indexOf(a.value) - AC_ORDER.indexOf(b.value)
      if (a.value === NOT_SET) return 1
      if (b.value === NOT_SET) return -1
      return b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true })
    })
  }
  return out
}

/** Folds a list of stores (one entry per ticket) into combinations with counts. */
export function toCombos(list: Pick<StoreDims, StoreKey>[]): StoreCombo[] {
  const m = new Map<string, StoreCombo>()
  for (const d of list) {
    const id = STORE_FILTER_KEYS.map((k) => d[k]).join('\u0001')
    const c = m.get(id)
    if (c) c.count += 1
    else m.set(id, { region: d.region, state: d.state, cluster: d.cluster, stype: d.stype, plist: d.plist, ac: d.ac, count: 1 })
  }
  return [...m.values()]
}
