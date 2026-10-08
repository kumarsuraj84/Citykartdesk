// The "Ticket Detail Report Age bucket wise": one line per ticket (ticket number, subject, requester, …)
// under the same group / service / date / status filters as the summary, with the age and age bucket of
// each ticket. Pure helpers: sorting, the two extra filters (technician, age bucket) and their options.

import { AGE_BUCKETS } from '@/lib/reporting/aging'
import { UNASSIGNED, NO_CATEGORY, NO_SUB_CATEGORY } from './age-summary'

export interface DetailRow {
  id: string
  ticketNo: string
  subject: string
  requester: string
  technician: string
  category: string
  subCategory: string
  service: string
  status: string
  priority: string
  /** ISO timestamp */
  createdAt: string
  ageDays: number
  ageBucket: string
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
/** Sorts names A→Z, with a placeholder such as "Unassigned" always last. */
const nameOrder = (a: string, b: string, last: string) => (a === last ? (b === last ? 0 : 1) : b === last ? -1 : byName(a, b))

/** Technician, then category, then sub category — the same order as the summary — and within them the oldest ticket first. */
export function sortDetailRows(rows: DetailRow[]): DetailRow[] {
  return [...rows].sort((x, y) =>
    nameOrder(x.technician, y.technician, UNASSIGNED)
    || nameOrder(x.category, y.category, NO_CATEGORY)
    || nameOrder(x.subCategory, y.subCategory, NO_SUB_CATEGORY)
    || y.ageDays - x.ageDays
    || byName(x.ticketNo, y.ticketNo))
}

/** The technician and age-bucket filters ('' means all). */
export function filterDetailRows(rows: DetailRow[], f: { technician?: string; bucket?: string }): DetailRow[] {
  return rows.filter((r) => (!f.technician || r.technician === f.technician) && (!f.bucket || r.ageBucket === f.bucket))
}

/** Technicians that have tickets in the result (A→Z, Unassigned last) — the choices for the technician filter. */
export function technicianOptions(rows: DetailRow[]): string[] {
  return [...new Set(rows.map((r) => r.technician))].sort((a, b) => nameOrder(a, b, UNASSIGNED))
}

/** Age buckets that have tickets in the result, in age order — the choices for the age-bucket filter. */
export function bucketOptions(rows: DetailRow[]): string[] {
  const used = new Set(rows.map((r) => r.ageBucket))
  return AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l))
}
