'use client'

import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'

export interface SortOption { value: string; label: string }

interface SortSelectProps {
  /** the column the list is sorted by now */
  value: string
  dir: 'asc' | 'desc'
  options: SortOption[]
  pathname: string
  /** Current URL's query string (no leading '?'), so the filters, the search and the tab are kept when the sort changes. */
  currentSearch: string
}

/** "Sort by" next to the filters: pick the column, and flip newest-first / oldest-first with the arrow. The column headers of the table sort too. */
export function SortSelect({ value, dir, options, pathname, currentSearch }: SortSelectProps) {
  const router = useRouter()

  function go(nextSort: string, nextDir: 'asc' | 'desc') {
    const params = new URLSearchParams(currentSearch)
    params.set('sort', nextSort)
    params.set('dir', nextDir)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="sort-by">Sort by</label>
      <select
        id="sort-by"
        value={value}
        onChange={(e) => go(e.target.value, dir)}
        className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
      </select>
      <button
        type="button"
        onClick={() => go(value, dir === 'desc' ? 'asc' : 'desc')}
        aria-label={dir === 'desc' ? 'Sorted from the highest or newest. Press to reverse.' : 'Sorted from the lowest or oldest. Press to reverse.'}
        title={dir === 'desc' ? 'Newest / highest first. Press to reverse.' : 'Oldest / lowest first. Press to reverse.'}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
      </button>
    </div>
  )
}
