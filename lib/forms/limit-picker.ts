// The tick lists in the form builder ("Show only for these categories / sub-categories"): the rules for searching and ticking, as pure functions so they are tested.
// A list can hold hundreds of entries (over 600 sub-categories), so it has a search box, a "ticked only" view and a row of chips for what is ticked.

export type PickItem = { id: string; name: string; /** the group it sits in (a sub-category's category); shown as a heading and searchable too */ group?: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Every word typed must appear somewhere in the item's name or group name (any order, any case): "gen backup" finds "GENISYS BACKUP ISSUE". */
export function matchesSearch(item: PickItem, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const hay = norm(`${item.group ?? ''} ${item.name}`)
  return words.every((w) => hay.includes(w))
}

/** The entries to show: the ones that match the search, and (when asked) only the ticked ones. */
export function visibleItems(items: PickItem[], query: string, tickedOnly: boolean, ticked: ReadonlySet<string>): PickItem[] {
  return items.filter((i) => (!tickedOnly || ticked.has(i.id)) && matchesSearch(i, query))
}

/** Items in groups, in the order they first appear. Items without a group go in one unnamed group. */
export function groupItems(items: PickItem[]): { group: string; items: PickItem[] }[] {
  const out: { group: string; items: PickItem[] }[] = []
  const at = new Map<string, number>()
  for (const i of items) {
    const g = i.group ?? ''
    if (!at.has(g)) { at.set(g, out.length); out.push({ group: g, items: [] }) }
    out[at.get(g)!].items.push(i)
  }
  return out
}

/** Ticks (or unticks) several entries at once, keeping what was ticked before and in the same order, never twice. */
export function setMany(current: string[], ids: string[], on: boolean): string[] {
  if (on) {
    const have = new Set(current)
    return [...current, ...ids.filter((id) => !have.has(id))]
  }
  const drop = new Set(ids)
  return current.filter((id) => !drop.has(id))
}

/** Names of the ticked entries, in ticked order, for the chips; an id that no longer exists (a retired category) is simply left out. */
export function tickedNames(items: PickItem[], ticked: string[]): { id: string; name: string; group?: string }[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return ticked.map((id) => byId.get(id)).filter((i): i is PickItem => !!i)
}
