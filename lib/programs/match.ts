import type { MatchResult } from '@/lib/masters/diff'
import type { ParsedProgramRow, ProgramRowType, StoredProgramRow } from './types'

// Pure: decides which row of a program's sheet is which stored row, so the history follows a row when the team edits, deletes or renumbers rows.
//  - machine program: the same store and machine number; a row whose machine number changed is still the same machine when the store and the serial are the same;
//  - store program: the same store and vendor (a store with several rows of the same vendor: matched by the row each had LAST time, then in sheet order, so rows that swap places keep their own history).
// A removed row is revived when it comes back; a row that is still current is preferred over one that was removed earlier.

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function matchProgramRows(rows: ParsedProgramRow[], stored: StoredProgramRow[], rowType: ProgramRowType): MatchResult {
  const claimedStored = new Set<string>()
  const claimedRow = new Set<number>()
  const matches: MatchResult['matches'] = []
  const claim = (i: number, s: StoredProgramRow) => { claimedStored.add(s.id); claimedRow.add(i); matches.push({ rowIndex: i, unitId: s.id }) }
  // among the free candidates the one that was on the SAME sheet row last time wins; otherwise the lowest row (a stable order). Without this, rows of the same store and vendor swapped
  // each other's ids whenever they were re-ordered, and the history (mails, tickets) followed the wrong row.
  // `exactOnly`: only a stored row that was on THIS sheet row counts. Each kind of match is tried first like that for every row, then for the leftovers, so a row never takes the
  // stored row that another row of the sheet is still sitting on.
  const pick = (cands: StoredProgramRow[], sheetRow: number | undefined, exactOnly: boolean) => {
    const free = cands.filter((s) => !claimedStored.has(s.id)).sort((a, b) => (a.sheetRow ?? Number.MAX_SAFE_INTEGER) - (b.sheetRow ?? Number.MAX_SAFE_INTEGER))
    const current = free.filter((s) => !s.removedAt)
    const same = (list: StoredProgramRow[]) => (sheetRow !== undefined ? list.find((s) => s.sheetRow === sheetRow) : undefined)
    if (exactOnly) return same(current) ?? same(free)
    return current[0] ?? free[0]
  }
  const matchEach = (candidates: (r: ParsedProgramRow) => StoredProgramRow[]) => {
    for (const exactOnly of [true, false]) {
      rows.forEach((r, i) => {
        if (claimedRow.has(i)) return
        const s = pick(candidates(r), r.sheetRow, exactOnly)
        if (s) claim(i, s)
      })
    }
  }

  const byStore = new Map<string, StoredProgramRow[]>()
  for (const s of stored) byStore.set(s.storeCode, [...(byStore.get(s.storeCode) ?? []), s])
  const of = (store: string) => byStore.get(store) ?? []

  if (rowType === 'machine') {
    matchEach((r) => of(r.storeCode).filter((x) => low(x.machineNo) === low(r.machineNo)))
    matchEach((r) => (r.serial ? of(r.storeCode).filter((x) => low(x.serial) === low(r.serial)) : []))
  } else {
    matchEach((r) => of(r.storeCode).filter((x) => low(x.vendor) === low(r.vendor)))
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
