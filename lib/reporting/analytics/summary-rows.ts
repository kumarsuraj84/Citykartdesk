// Turns the age-bucket summary into the list of rows to show, honouring which technicians and categories
// the viewer has collapsed — the same behaviour as the +/- buttons of an Excel pivot table. Used by both
// the on-screen table and the Excel export, so what is exported is exactly what is on screen.

import type { AgeSummary, DayCounts } from './age-summary'

export interface Collapsed {
  /** Technician names whose categories are hidden. */
  tech: ReadonlySet<string>
  /** Categories (key = techKey(tech, category)) whose sub categories are hidden. */
  cat: ReadonlySet<string>
}

export const NOTHING_COLLAPSED: Collapsed = { tech: new Set(), cat: new Set() }

export const catKey = (tech: string, category: string) => `${tech}\u0001${category}`

export type ToggleTarget = { type: 'tech'; key: string; expanded: boolean } | { type: 'cat'; key: string; expanded: boolean }

export interface DisplayRow {
  kind: 'tech' | 'cat' | 'sub' | 'techTotal'
  key: string
  techLabel: string
  catLabel: string
  subLabel: string
  /** Expand/collapse arrow shown in the technician or category cell of this row. */
  techToggle?: ToggleTarget
  catToggle?: ToggleTarget
  counts: Record<string, number>
  total: number
  day: DayCounts
}

export function flattenSummary(summary: AgeSummary, collapsed: Collapsed = NOTHING_COLLAPSED): DisplayRow[] {
  const rows: DisplayRow[] = []
  for (const t of summary.technicians) {
    if (collapsed.tech.has(t.name)) {
      rows.push({
        kind: 'tech', key: `t|${t.name}`, techLabel: t.name, catLabel: '', subLabel: '',
        techToggle: { type: 'tech', key: t.name, expanded: false },
        counts: t.counts, total: t.total, day: t.day,
      })
      continue
    }
    let first = true
    for (const c of t.categories) {
      const ck = catKey(t.name, c.name)
      if (collapsed.cat.has(ck)) {
        rows.push({
          kind: 'cat', key: `c|${ck}`, techLabel: first ? t.name : '', catLabel: c.name, subLabel: '',
          techToggle: first ? { type: 'tech', key: t.name, expanded: true } : undefined,
          catToggle: { type: 'cat', key: ck, expanded: false },
          counts: c.counts, total: c.total, day: c.day,
        })
        first = false
        continue
      }
      c.subCategories.forEach((s, si) => {
        rows.push({
          kind: 'sub', key: `s|${ck}|${s.name}`, techLabel: first ? t.name : '', catLabel: si === 0 ? c.name : '', subLabel: s.name,
          techToggle: first ? { type: 'tech', key: t.name, expanded: true } : undefined,
          catToggle: si === 0 ? { type: 'cat', key: ck, expanded: true } : undefined,
          counts: s.counts, total: s.total, day: s.day,
        })
        first = false
      })
    }
    rows.push({
      kind: 'techTotal', key: `tt|${t.name}`, techLabel: `${t.name} Total`, catLabel: '', subLabel: '',
      counts: t.counts, total: t.total, day: t.day,
    })
  }
  return rows
}

export type DetailLevel = 'technicians' | 'categories' | 'subcategories'

/** The Excel-style 1 / 2 / 3 level buttons: how much detail to show everywhere. */
export function collapsedForLevel(summary: AgeSummary, level: DetailLevel): Collapsed {
  if (level === 'technicians') return { tech: new Set(summary.technicians.map((t) => t.name)), cat: new Set() }
  if (level === 'categories') {
    return { tech: new Set(), cat: new Set(summary.technicians.flatMap((t) => t.categories.map((c) => catKey(t.name, c.name)))) }
  }
  return NOTHING_COLLAPSED
}

/** Which level button matches the current state, or null when the viewer has mixed it by hand. */
export function levelOf(summary: AgeSummary, collapsed: Collapsed): DetailLevel | null {
  for (const level of ['subcategories', 'categories', 'technicians'] as DetailLevel[]) {
    const want = collapsedForLevel(summary, level)
    const sameTech = want.tech.size === collapsed.tech.size && [...want.tech].every((k) => collapsed.tech.has(k))
    const sameCat = level === 'technicians' ? true : want.cat.size === collapsed.cat.size && [...want.cat].every((k) => collapsed.cat.has(k))
    if (sameTech && sameCat) return level
  }
  return null
}
