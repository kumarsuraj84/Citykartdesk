// The filters of the fixed reports (Responsible, store type, cluster, region, store, age bucket, red flag ...) and how they
// depend on each other. Every dropdown lists only the values that exist among the tickets that match ALL THE OTHER filters
// (with how many tickets each has), so a choice can never give an empty report because of another choice. A selection that
// stops fitting after another one changes is dropped. Pure functions: the screen, the Excel export and the tests use the same.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import { monthSortKey, UNASSIGNED, type TicketFact } from './facts'

export type FacetKey =
  | 'technician' | 'storeType' | 'region' | 'cluster' | 'store' | 'city' | 'priorityList'
  | 'oem' | 'acBrand' | 'acAmcBrand' | 'acAmcVendor' | 'zenatix' | 'redFlag'
  | 'category' | 'subCategory' | 'ageBucket' | 'oemBucket'
  | 'openMonth' | 'openWeek' | 'closeMonth' | 'closeWeek'

type Order = 'text' | 'month' | 'age' | 'week'

export interface FacetDef {
  key: FacetKey
  /** the heading used in the filter bar and the Excel file */
  label: string
  get: (t: TicketFact) => string
  order: Order
}

export const FACETS: FacetDef[] = [
  { key: 'technician', label: 'Responsible', get: (t) => t.technician, order: 'text' },
  { key: 'storeType', label: 'Store type', get: (t) => t.storeType, order: 'text' },
  { key: 'region', label: 'Region', get: (t) => t.region, order: 'text' },
  { key: 'cluster', label: 'Cluster', get: (t) => t.cluster, order: 'text' },
  { key: 'store', label: 'Store', get: (t) => t.store, order: 'text' },
  { key: 'city', label: 'City', get: (t) => t.city, order: 'text' },
  { key: 'priorityList', label: 'Store priority list as per Ops', get: (t) => t.priorityList, order: 'text' },
  { key: 'oem', label: 'OEM', get: (t) => t.oem, order: 'text' },
  { key: 'acBrand', label: 'AC brand', get: (t) => t.acBrand, order: 'text' },
  { key: 'acAmcBrand', label: 'AC-AMC brand', get: (t) => t.acAmcBrand, order: 'text' },
  { key: 'acAmcVendor', label: 'AC-AMC vendor', get: (t) => t.acAmcVendor, order: 'text' },
  { key: 'zenatix', label: 'Zenatix', get: (t) => t.zenatix, order: 'text' },
  { key: 'redFlag', label: 'Red flag', get: (t) => t.redFlag, order: 'text' },
  { key: 'category', label: 'Category', get: (t) => t.category, order: 'text' },
  { key: 'subCategory', label: 'Sub category', get: (t) => t.subCategory, order: 'text' },
  { key: 'ageBucket', label: 'Age bucket', get: (t) => t.ageBucket, order: 'age' },
  { key: 'oemBucket', label: 'OEM ticket age', get: (t) => t.oemBucket, order: 'age' },
  { key: 'openMonth', label: 'Open month', get: (t) => t.openMonth, order: 'month' },
  { key: 'openWeek', label: 'Open week', get: (t) => t.openWeek, order: 'week' },
  { key: 'closeMonth', label: 'Close month', get: (t) => t.closeMonth, order: 'month' },
  { key: 'closeWeek', label: 'Close week', get: (t) => t.closeWeek, order: 'week' },
]

const BY_KEY = new Map(FACETS.map((f) => [f.key, f]))
export const facetDef = (k: FacetKey) => BY_KEY.get(k)!
export const isFacetKey = (k: string): k is FacetKey => BY_KEY.has(k as FacetKey)

/** One chosen value per filter; a filter that is not in here is "All". */
export type FacetSelection = Partial<Record<FacetKey, string>>

export interface FacetOption { value: string; count: number }

const byText = (a: string, b: string, last?: string) =>
  a === last ? 1 : b === last ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

function sortOptions(def: FacetDef, opts: FacetOption[]): FacetOption[] {
  const ageIndex = (v: string) => AGE_BUCKETS.findIndex((b) => b.label === v)
  const weekNo = (v: string) => Number(/(\d+)/.exec(v)?.[1] ?? 0)
  return opts.sort((x, y) => {
    switch (def.order) {
      case 'age': return ageIndex(x.value) - ageIndex(y.value)
      case 'month': return monthSortKey(x.value) - monthSortKey(y.value)
      case 'week': return weekNo(x.value) - weekNo(y.value)
      default: return byText(x.value, y.value, def.key === 'technician' ? UNASSIGNED : undefined)
    }
  })
}

/** The tickets that match every chosen filter, except the one named in `skip` (used to work out that filter's own choices). */
export function applyFacets<T extends TicketFact>(rows: T[], sel: FacetSelection, skip?: FacetKey): T[] {
  const active = (Object.entries(sel) as [FacetKey, string][]).filter(([k, v]) => v !== '' && v != null && k !== skip && BY_KEY.has(k))
  if (active.length === 0) return rows
  return rows.filter((t) => active.every(([k, v]) => BY_KEY.get(k)!.get(t) === v))
}

/** For each of the given filters, the values (and ticket counts) that exist given all the OTHER chosen filters. */
export function facetOptions(rows: TicketFact[], sel: FacetSelection, keys: FacetKey[] = FACETS.map((f) => f.key)): Record<FacetKey, FacetOption[]> {
  const out = {} as Record<FacetKey, FacetOption[]>
  for (const key of keys) {
    const def = BY_KEY.get(key)!
    const counts = new Map<string, number>()
    for (const t of applyFacets(rows, sel, key)) {
      const v = def.get(t)
      if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    out[key] = sortOptions(def, [...counts.entries()].map(([value, count]) => ({ value, count })))
  }
  return out
}

/**
 * Drops a chosen value that no longer fits the other choices (a value left over from another group, status or filter). The choices are
 * taken one by one in the order of the filter bar: each one is kept when some ticket still matches it together with the choices kept
 * before it, so choices that agree stay and only the one that conflicts goes.
 */
export function reconcileSelection(rows: TicketFact[], sel: FacetSelection, keys: FacetKey[] = FACETS.map((f) => f.key)): FacetSelection {
  const kept: FacetSelection = {}
  for (const key of keys) {
    const value = sel[key]
    if (!value) continue
    if (applyFacets(rows, { ...kept, [key]: value }).length > 0) kept[key] = value
  }
  return kept
}

/** Reads the filters from a page address: f_cluster=UP2 -> { cluster: 'UP2' }. */
export function parseFacetSelection(params: Record<string, string | string[] | undefined>, keys: FacetKey[]): FacetSelection {
  const out: FacetSelection = {}
  for (const key of keys) {
    const raw = params[`f_${key}`]
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (v) out[key] = v
  }
  return out
}

/** The choices as address parameters (for links and the Excel export). */
export function selectionParams(sel: FacetSelection): Record<string, string> {
  return Object.fromEntries(Object.entries(sel).filter(([, v]) => v).map(([k, v]) => [`f_${k}`, v as string]))
}
