import type { MatchResult } from '@/lib/masters/diff'
import type { ParsedProgramRow, ProgramRowType, StoredProgramRow } from './types'

// Pure: decides which row of a program's sheet is which stored row, so the history follows a row when the team edits, deletes or renumbers rows.
//  - machine program: the same store and machine number; a row whose machine number changed is still the same machine when the store and the serial are the same;
//  - store program: the same store and vendor (a store with several rows of the same vendor: matched in sheet order).
// A removed row is revived when it comes back; a row that is still current is preferred over one that was removed earlier.

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function matchProgramRows(rows: ParsedProgramRow[], stored: StoredProgramRow[], rowType: ProgramRowType): MatchResult {
  const claimedStored = new Set<string>()
  const claimedRow = new Set<number>()
  const matches: MatchResult['matches'] = []
  const claim = (i: number, s: StoredProgramRow) => { claimedStored.add(s.id); claimedRow.add(i); matches.push({ rowIndex: i, unitId: s.id }) }
  const pick = (cands: StoredProgramRow[]) => { const free = cands.filter((s) => !claimedStored.has(s.id)); return free.find((s) => !s.removedAt) ?? free[0] }

  const byStore = new Map<string, StoredProgramRow[]>()
  for (const s of stored) byStore.set(s.storeCode, [...(byStore.get(s.storeCode) ?? []), s])
  const of = (store: string) => byStore.get(store) ?? []

  if (rowType === 'machine') {
    rows.forEach((r, i) => { const s = pick(of(r.storeCode).filter((x) => low(x.machineNo) === low(r.machineNo))); if (s) claim(i, s) })
    rows.forEach((r, i) => {
      if (claimedRow.has(i) || !r.serial) return
      const s = pick(of(r.storeCode).filter((x) => low(x.serial) === low(r.serial)))
      if (s) claim(i, s)
    })
  } else {
    rows.forEach((r, i) => { const s = pick(of(r.storeCode).filter((x) => low(x.vendor) === low(r.vendor))); if (s) claim(i, s) })
    // a store that had one row and still has one row, but the vendor name was corrected: the same row
    const rowsByStore = new Map<string, number[]>()
    rows.forEach((r, i) => { if (!claimedRow.has(i)) rowsByStore.set(r.storeCode, [...(rowsByStore.get(r.storeCode) ?? []), i]) })
    for (const [store, idx] of rowsByStore) {
      const free = of(store).filter((x) => !claimedStored.has(x.id) && !x.removedAt)
      const sheetRows = rows.filter((r) => r.storeCode === store).length
      const current = of(store).filter((x) => !x.removedAt).length
      if (idx.length === 1 && free.length === 1 && sheetRows === 1 && current === 1) claim(idx[0], free[0])
    }
  }
  return {
    matches,
    inserts: rows.map((_, i) => i).filter((i) => !claimedRow.has(i)),
    unmatched: stored.filter((s) => !s.removedAt && !claimedStored.has(s.id)).map((s) => s.id),
  }
}
