// Small helpers for the ticket list's bulk actions (kept free of React so they can be tested on their own).

/**
 * Keep only the ticked rows that are still on the screen. If every ticked row is still there the very same Set comes back
 * (so React does nothing). A new page, filter or search leaves none of them, so the selection ends up empty,
 * but a background refresh that only changes a row's wording keeps what the person ticked.
 */
export function pruneSelection(selected: Set<string>, visibleIds: string[]): Set<string> {
  if (selected.size === 0) return selected
  const visible = new Set(visibleIds)
  let removed = false
  const next = new Set<string>()
  for (const id of selected) {
    if (visible.has(id)) next.add(id)
    else removed = true
  }
  return removed ? next : selected
}

/** Run `task` for every item, at most `limit` at a time. A task that throws is turned into a failed result instead of stopping the rest. */
export async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; message: string }>> {
  const out: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; message: string }> = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const at = next++
      const item = items[at]
      try {
        out[at] = { item, ok: true, value: await task(item) }
      } catch {
        out[at] = { item, ok: false, message: 'Could not reach the server.' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}
