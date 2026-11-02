// Which store details are still blank on an ACTIVE store card, for the "missing details" list in Admin > Org Structure > Stores. Pure, so every rule is easy to test.
// The details checked are the ones every store has (the AC-only details are not asked of a store that has no ACs). The AC Google sheet fills most of them by itself;
// a store that is not in that sheet keeps its blanks until someone fills them (by hand or with "Upload Store Master").

export type MissingField = 'address' | 'pincode' | 'city' | 'state' | 'region' | 'cluster' | 'priority_list' | 'festival' | 'open_date'

/** In the order they are shown. */
export const MISSING_FIELDS: { key: MissingField; label: string }[] = [
  { key: 'address', label: 'Address' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'region', label: 'Region' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'priority_list', label: 'Priority list' },
  { key: 'festival', label: 'Festival' },
  { key: 'open_date', label: 'Open date' },
]

type StoreLike = { is_active: boolean } & Partial<Record<MissingField, string | null>>

const isBlank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ''

/** The labels of the blank details of a store; an inactive store is never reported (nobody raises tickets for it). */
export function missingDetails(s: StoreLike): MissingField[] {
  if (!s.is_active) return []
  return MISSING_FIELDS.filter((f) => isBlank(s[f.key])).map((f) => f.key)
}

export const missingLabel = (key: MissingField) => MISSING_FIELDS.find((f) => f.key === key)?.label ?? key

/** How many active stores miss each detail, and how many stores miss at least one. */
export function missingSummary(stores: StoreLike[]): { stores: number; perField: { key: MissingField; label: string; count: number }[] } {
  const perField = MISSING_FIELDS.map((f) => ({ key: f.key, label: f.label, count: 0 }))
  let withGaps = 0
  for (const s of stores) {
    const miss = missingDetails(s)
    if (miss.length === 0) continue
    withGaps++
    for (const k of miss) perField.find((p) => p.key === k)!.count++
  }
  return { stores: withGaps, perField: perField.filter((p) => p.count > 0) }
}
