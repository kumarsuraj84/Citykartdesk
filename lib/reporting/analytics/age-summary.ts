// Builds the "Tickets Summary — age bucket wise" table: for each technician → category → sub category,
// how many tickets fall in each age bucket (the same buckets the dashboard and Report Builder use),
// plus two "that day" counts: tickets created and resolved on the reference day (the end of
// the chosen date range — normally today).
// Same shape as the Excel pivot it replaces, with a "<Technician> Total" row after each technician and a
// Grand Total row at the end.

import { AGE_BUCKETS, ageBucketLabel } from '@/lib/reporting/aging'

export interface SummaryInputRow {
  technician: string | null
  category: string | null
  subCategory?: string | null
  ageDays: number
}

/** A ticket that had activity on the reference day (created and/or resolved that day). */
export interface DayInputRow {
  technician: string | null
  category: string | null
  subCategory?: string | null
  created: boolean
  resolved: boolean
}

export interface DayCounts { created: number; resolved: number }
export interface SummarySubCategory { name: string; counts: Record<string, number>; total: number; day: DayCounts }
export interface SummaryCategory { name: string; subCategories: SummarySubCategory[]; counts: Record<string, number>; total: number; day: DayCounts }
export interface SummaryTechnician { name: string; categories: SummaryCategory[]; counts: Record<string, number>; total: number; day: DayCounts }
export interface AgeSummary {
  /** Bucket labels in age order — only the ones that have at least one ticket (like the Excel pivot). */
  buckets: string[]
  technicians: SummaryTechnician[]
  grand: { counts: Record<string, number>; total: number; day: DayCounts }
}

export const UNASSIGNED = 'Unassigned'
export const NO_CATEGORY = '(No category)'
export const NO_SUB_CATEGORY = '(No sub category)'

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
const newDay = (): DayCounts => ({ created: 0, resolved: 0 })
const addCounts = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v }
const addDay = (into: DayCounts, from: DayCounts) => { into.created += from.created; into.resolved += from.resolved }
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0)

interface Cell { counts: Record<string, number>; day: DayCounts }

export function buildAgeSummary(rows: SummaryInputRow[], dayRows: DayInputRow[] = []): AgeSummary {
  const techs = new Map<string, Map<string, Map<string, Cell>>>()
  const used = new Set<string>()

  const cellFor = (technician: string | null, category: string | null, sub: string | null | undefined): Cell => {
    const t = (technician ?? '').trim() || UNASSIGNED
    const c = (category ?? '').trim() || NO_CATEGORY
    const s = (sub ?? '').trim() || NO_SUB_CATEGORY
    const cats = techs.get(t) ?? new Map<string, Map<string, Cell>>()
    const subs = cats.get(c) ?? new Map<string, Cell>()
    const cell = subs.get(s) ?? { counts: {}, day: newDay() }
    subs.set(s, cell); cats.set(c, subs); techs.set(t, cats)
    return cell
  }

  for (const r of rows) {
    const bucket = ageBucketLabel(r.ageDays)
    used.add(bucket)
    const cell = cellFor(r.technician, r.category, r.subCategory)
    cell.counts[bucket] = (cell.counts[bucket] ?? 0) + 1
  }
  for (const d of dayRows) {
    const cell = cellFor(d.technician, d.category, d.subCategory)
    if (d.created) cell.day.created++
    if (d.resolved) cell.day.resolved++
  }

  const grandCounts: Record<string, number> = {}
  const grandDay = newDay()
  const technicians: SummaryTechnician[] = [...techs.entries()]
    // "Unassigned" always last, everyone else A→Z
    .sort(([a], [b]) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : byName(a, b)))
    .map(([name, cats]) => {
      const techCounts: Record<string, number> = {}
      const techDay = newDay()
      const categories: SummaryCategory[] = [...cats.entries()]
        .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : byName(a, b)))
        .map(([cname, subs]) => {
          const catCounts: Record<string, number> = {}
          const catDay = newDay()
          const subCategories: SummarySubCategory[] = [...subs.entries()]
            .sort(([a], [b]) => (a === NO_SUB_CATEGORY ? 1 : b === NO_SUB_CATEGORY ? -1 : byName(a, b)))
            .map(([sname, cell]) => {
              addCounts(catCounts, cell.counts); addDay(catDay, cell.day)
              return { name: sname, counts: cell.counts, total: sum(cell.counts), day: cell.day }
            })
          addCounts(techCounts, catCounts); addDay(techDay, catDay)
          return { name: cname, subCategories, counts: catCounts, total: sum(catCounts), day: catDay }
        })
      addCounts(grandCounts, techCounts); addDay(grandDay, techDay)
      return { name, categories, counts: techCounts, total: sum(techCounts), day: techDay }
    })

  return {
    buckets: AGE_BUCKETS.map((b) => b.label).filter((l) => used.has(l)),
    technicians,
    grand: { counts: grandCounts, total: sum(grandCounts), day: grandDay },
  }
}
