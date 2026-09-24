'use client'

import type { RequesterServiceShortcut } from '@/lib/queries/requests'

/** Right panel of the Create Request workspace — the signed-in requester's
 *  own most-frequently-used sub-categories for this service, most-used
 *  first. Personal + service-scoped, same as ServiceContextPanel's Recently
 *  Used — see getRequesterServiceShortcuts() for the scoping. */
export function RequestShortcutPanel({
  frequent,
  onShortcutClick,
}: {
  frequent: RequesterServiceShortcut[]
  onShortcutClick: (item: RequesterServiceShortcut) => void
}) {
  if (frequent.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-2">
      <h3 className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Your Frequent Issues</h3>
      <div className="divide-y divide-border/60">
        {frequent.map((item) => (
          <button
            key={item.subCategoryId}
            type="button"
            onClick={() => onShortcutClick(item)}
            className="group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="truncate">{item.subCategoryName}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">{item.count}</span>
              <span className="opacity-40 transition-opacity group-hover:opacity-100">&rsaquo;</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
