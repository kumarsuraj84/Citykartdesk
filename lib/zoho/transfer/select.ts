// The rules behind the "Move Zoho tickets" table: which rows are shown for a view, and how "select all that can be moved" and a shift-click range choose tickets.
// Pure functions (no screen, no database), so every rule has a test. Only a ticket that is READY can ever be selected, and never more than one batch (the limit) at a time.

export type PickRow = { zohoNo: number; ready: boolean; /** the codes of the problems that stop it moving (empty when ready) */ codes: string[] }
export type View = 'all' | 'ready' | 'blocked'

/** The rows to show: all of them, only the ones that can be moved, or only the ones that cannot (optionally only those blocked for one reason). */
export function filterRows<T extends PickRow>(rows: T[], view: View, reason: string | null): T[] {
  return rows.filter((r) => {
    if (view === 'ready') return r.ready
    if (view === 'blocked') return !r.ready && (!reason || r.codes.includes(reason))
    return !reason || r.codes.includes(reason)
  })
}

/** How many rows each view holds (for the numbers on the buttons). */
export function viewCounts(rows: PickRow[]): { all: number; ready: number; blocked: number } {
  const ready = rows.filter((r) => r.ready).length
  return { all: rows.length, ready, blocked: rows.length - ready }
}

/**
 * "Select all that can be moved": the ready rows of the current view, in the order shown, up to `limit` (one batch). `capped` tells the screen that more were ready than fit.
 * Tickets already selected stay selected and count towards the limit.
 */
export function selectReady(visible: PickRow[], limit: number, already: number[] = []): { selected: number[]; readyCount: number; capped: boolean } {
  const ready = visible.filter((r) => r.ready).map((r) => r.zohoNo)
  const keep = already.filter((n) => visible.some((r) => r.zohoNo === n && r.ready))
  const merged = [...keep]
  for (const n of ready) { if (merged.length >= limit) break; if (!merged.includes(n)) merged.push(n) }
  return { selected: merged, readyCount: ready.length, capped: ready.length > merged.length }
}

/** Ticks or unticks one ticket. A ticket that cannot be moved is never selected, and the selection never grows past the limit (the second value says it was refused for that). */
export function toggleOne(selected: number[], row: PickRow, limit: number): { selected: number[]; refusedForLimit: boolean } {
  if (selected.includes(row.zohoNo)) return { selected: selected.filter((n) => n !== row.zohoNo), refusedForLimit: false }
  if (!row.ready) return { selected, refusedForLimit: false }
  if (selected.length >= limit) return { selected, refusedForLimit: true }
  return { selected: [...selected, row.zohoNo], refusedForLimit: false }
}

/** Shift-click: every ready row between two clicked rows (inclusive), in the order shown, added to the selection up to the limit. */
export function selectRange(visible: PickRow[], fromNo: number, toNo: number, selected: number[], limit: number): { selected: number[]; capped: boolean } {
  const a = visible.findIndex((r) => r.zohoNo === fromNo)
  const b = visible.findIndex((r) => r.zohoNo === toNo)
  if (a < 0 || b < 0) return { selected, capped: false }
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const merged = [...selected]
  let capped = false
  for (const r of visible.slice(lo, hi + 1)) {
    if (!r.ready || merged.includes(r.zohoNo)) continue
    if (merged.length >= limit) { capped = true; break }
    merged.push(r.zohoNo)
  }
  return { selected: merged, capped }
}

/** Drops from the selection every ticket that is no longer ready or no longer in the list (after the list was refreshed). */
export function pruneSelection(selected: number[], rows: PickRow[]): number[] {
  const ok = new Set(rows.filter((r) => r.ready).map((r) => r.zohoNo))
  return selected.filter((n) => ok.has(n))
}
