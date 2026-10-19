import type { AcRow, GensetRow, StoredUnit } from './types'

// Pure: decides which row of a sheet is which unit CK Desk already knows, so history follows the unit when the team edits, deletes or renumbers rows.

export type MatchResult = {
  /** rows[rowIndex] is the same unit as the stored unit `unitId` (the stored unit is updated; a removed unit is revived). */
  matches: { rowIndex: number; unitId: string }[]
  /** rows[i] is a unit CK Desk has not seen: it is inserted. */
  inserts: number[]
  /** Stored, not-yet-removed units no row matches: they have left the sheet. */
  unmatched: string[]
}

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Prefer a unit that is still current over one that was removed earlier. */
function firstFree(cands: StoredUnit[], claimed: Set<string>, ok: (u: StoredUnit) => boolean = () => true): StoredUnit | undefined {
  const free = cands.filter((u) => !claimed.has(u.id) && ok(u))
  return free.find((u) => !u.removedAt) ?? free[0]
}

function byStore<T extends { storeCode: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) m.set(it.storeCode, [...(m.get(it.storeCode) ?? []), it])
  return m
}

/**
 * AC units. A unit is recognised, in this order, by
 *   1. the same store and the same actual serial (the machine itself, whatever number the team gave it);
 *   2. the same store and the same CKDESK number (an AC without a serial, or one whose serial was corrected). A unit that was removed earlier is only revived by
 *      its number when one of the two serials is empty, so a number reused for a different machine starts a new unit.
 */
export function matchAcUnits(rows: AcRow[], stored: (StoredUnit & { ckdeskNo: string })[]): MatchResult {
  const claimedUnit = new Set<string>()
  const claimedRow = new Set<number>()
  const matches: MatchResult['matches'] = []
  const storedByStore = byStore(stored)

  rows.forEach((r, i) => {
    if (!r.serial) return
    const u = firstFree((storedByStore.get(r.storeCode) ?? []).filter((s) => key(s.serial) === key(r.serial)), claimedUnit)
    if (u) { claimedUnit.add(u.id); claimedRow.add(i); matches.push({ rowIndex: i, unitId: u.id }) }
  })
  rows.forEach((r, i) => {
    if (claimedRow.has(i)) return
    const cands = (storedByStore.get(r.storeCode) ?? []).filter((s) => key(s.ckdeskNo) === key(r.ckdeskNo))
    const u = firstFree(cands, claimedUnit, (s) => !s.removedAt || !r.serial || !s.serial || key(s.serial) === key(r.serial))
    if (u) { claimedUnit.add(u.id); claimedRow.add(i); matches.push({ rowIndex: i, unitId: u.id }) }
  })
  return {
    matches,
    inserts: rows.map((_, i) => i).filter((i) => !claimedRow.has(i)),
    unmatched: stored.filter((s) => !s.removedAt && !claimedUnit.has(s.id)).map((s) => s.id),
  }
}

/**
 * Genset units. Recognised by the same store and serial. A store that had exactly one genset and now has exactly one row with a different serial
 * is the same genset with a corrected serial. Rows without a serial are matched in sheet order.
 */
export function matchGensets(rows: GensetRow[], stored: StoredUnit[]): MatchResult {
  const claimedUnit = new Set<string>()
  const claimedRow = new Set<number>()
  const matches: MatchResult['matches'] = []
  const storedByStore = byStore(stored)
  const claim = (i: number, u: StoredUnit) => { claimedUnit.add(u.id); claimedRow.add(i); matches.push({ rowIndex: i, unitId: u.id }) }

  rows.forEach((r, i) => {
    if (!r.serial) return
    const u = firstFree((storedByStore.get(r.storeCode) ?? []).filter((s) => key(s.serial) === key(r.serial)), claimedUnit)
    if (u) claim(i, u)
  })
  // a corrected serial in a store that has one genset
  const rowsByStore = new Map<string, number[]>()
  rows.forEach((r, i) => { if (!claimedRow.has(i)) rowsByStore.set(r.storeCode, [...(rowsByStore.get(r.storeCode) ?? []), i]) })
  for (const [store, idx] of rowsByStore) {
    const free = (storedByStore.get(store) ?? []).filter((s) => !claimedUnit.has(s.id) && !s.removedAt)
    const allRowsOfStore = rows.filter((r) => r.storeCode === store).length
    const allStoredOfStore = (storedByStore.get(store) ?? []).filter((s) => !s.removedAt).length
    if (idx.length === 1 && free.length === 1 && allRowsOfStore === 1 && allStoredOfStore === 1) claim(idx[0], free[0])
  }
  // rows without a serial, in sheet order
  for (const [store, idx] of rowsByStore) {
    const blank = idx.filter((i) => !claimedRow.has(i) && !rows[i].serial)
    const free = (storedByStore.get(store) ?? []).filter((s) => !claimedUnit.has(s.id) && !s.removedAt && !s.serial)
    blank.forEach((i, n) => { if (free[n]) claim(i, free[n]) })
  }
  return {
    matches,
    inserts: rows.map((_, i) => i).filter((i) => !claimedRow.has(i)),
    unmatched: stored.filter((s) => !s.removedAt && !claimedUnit.has(s.id)).map((s) => s.id),
  }
}

export const REMOVAL_WAIT_MINUTES = 30
export const BIG_CHANGE_ROWS = 20
export const BIG_CHANGE_SHARE = 0.15

/**
 * Units that have left the sheet. A few at a time are removed straight away. A big disappearance (more than 20 units, or more than 15% of the current ones)
 * looks like a mistake (rows deleted by accident, a sheet emptied), so those units are only removed once they have been missing for 30 minutes; if the rows
 * come back before that, nothing happens.
 */
export function planRemovals(p: {
  missing: { id: string; missingSince: string | null }[]
  currentTotal: number
  now: Date
}): { removeNow: string[]; markMissing: string[]; bigChange: boolean } {
  const n = p.missing.length
  const bigChange = n > BIG_CHANGE_ROWS || (n >= 5 && p.currentTotal > 0 && n / p.currentTotal > BIG_CHANGE_SHARE)
  const removeNow: string[] = []
  const markMissing: string[] = []
  for (const m of p.missing) {
    if (!bigChange) { removeNow.push(m.id); continue }
    const since = m.missingSince ? new Date(m.missingSince).getTime() : null
    if (since !== null && p.now.getTime() - since >= REMOVAL_WAIT_MINUTES * 60_000) removeNow.push(m.id)
    else markMissing.push(m.id)
  }
  return { removeNow, markMissing, bigChange }
}
