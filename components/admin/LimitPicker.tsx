'use client'

import { useMemo, useState } from 'react'
import { groupItems, setMany, tickedNames, visibleItems, type PickItem } from '@/lib/forms/limit-picker'

const CHIPS_SHOWN = 12

/**
 * A long tick list with a search box: type part of a name (or of a category's name, for sub-categories) to find it, tick it, and see what is ticked as chips above the list.
 * "Ticked only" shows just what is ticked; "Tick all shown" ticks everything the search found (only offered while a search is typed, so a whole list is never ticked by accident).
 */
export function LimitPicker({ items, ticked, onChange, placeholder, noun }: {
  items: PickItem[]
  ticked: string[]
  onChange: (next: string[]) => void
  placeholder: string
  /** "category" / "sub-category", for the words on the screen */
  noun: string
}) {
  const [query, setQuery] = useState('')
  const [onlyTicked, setOnlyTicked] = useState(false)
  const tickedSet = useMemo(() => new Set(ticked), [ticked])
  const shown = useMemo(() => visibleItems(items, query, onlyTicked, tickedSet), [items, query, onlyTicked, tickedSet])
  const groups = useMemo(() => groupItems(shown), [shown])
  const chips = useMemo(() => tickedNames(items, ticked), [items, ticked])
  const searching = query.trim().length > 0
  const shownUnticked = shown.filter((i) => !tickedSet.has(i.id))

  return (
    <div className="mt-2 space-y-2">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={`Search ${noun}`}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{ticked.length} ticked</span>
        <label className="flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={onlyTicked} onChange={(e) => setOnlyTicked(e.target.checked)} /> Ticked only
        </label>
        {searching && shownUnticked.length > 0 && (
          <button type="button" className="text-primary hover:underline" onClick={() => onChange(setMany(ticked, shownUnticked.map((i) => i.id), true))}>
            Tick all {shownUnticked.length} shown
          </button>
        )}
        {searching && shown.some((i) => tickedSet.has(i.id)) && (
          <button type="button" className="text-primary hover:underline" onClick={() => onChange(setMany(ticked, shown.map((i) => i.id), false))}>
            Untick shown
          </button>
        )}
        {ticked.length > 0 && (
          <button type="button" className="text-red-600 hover:underline dark:text-red-400" onClick={() => onChange([])}>
            Clear all ticks
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`Ticked ${noun} list`}>
          {chips.slice(0, CHIPS_SHOWN).map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-foreground" title={c.group ? `${c.group} › ${c.name}` : c.name}>
              <span className="max-w-[11rem] truncate">{c.name}</span>
              <button type="button" aria-label={`Untick ${c.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(setMany(ticked, [c.id], false))}>×</button>
            </li>
          ))}
          {chips.length > CHIPS_SHOWN && <li className="px-1 py-0.5 text-[11px] text-muted-foreground">+{chips.length - CHIPS_SHOWN} more (tick &quot;Ticked only&quot; to see all)</li>}
        </ul>
      )}

      <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/60 bg-background/50 p-2">
        {groups.length === 0 && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">{onlyTicked && !searching ? `Nothing is ticked yet.` : `No ${noun} matches “${query.trim()}”.`}</p>
        )}
        {groups.map((g) => (
          <div key={g.group || '_'}>
            {g.group && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>}
            <div className="mt-1 grid grid-cols-1 gap-1">
              {g.items.map((i) => (
                <label key={i.id} className={`flex cursor-pointer items-center gap-2 text-xs text-foreground ${g.group ? 'pl-1' : ''}`}>
                  <input type="checkbox" checked={tickedSet.has(i.id)} onChange={() => onChange(setMany(ticked, [i.id], !tickedSet.has(i.id)))} />
                  {i.name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
