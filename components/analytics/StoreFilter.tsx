'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Store } from 'lucide-react'
import {
  STORE_FILTER_KEYS, STORE_KEY_LABEL, applyStoreFilterToParams, buildStoreOptions, emptyStoreFilter, storeFilterCount,
  type StoreCombo, type StoreFilter, type StoreKey,
} from '@/lib/analytics/store-filter'

/**
 * Store Master choices for the Analytics dashboard: region, state, cluster, store type, store priority list and AC health.
 * Every list follows the other choices, and the lists shown here are worked out from what is ticked in the pop-up so far (before Apply), so
 * ticking a region shrinks the cluster, state and priority-list lists straight away. The numbers of the technician groups and the dates the page
 * is showing are already in the counts. The choice lives in the page address (?st_region=...), so it survives a refresh and the period / tab links keep it.
 */
export function StoreFilter({ combos, selected }: { combos: StoreCombo[]; selected: StoreFilter }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<StoreFilter>(selected)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const options = useMemo(() => buildStoreOptions(combos, draft), [combos, draft])
  const count = storeFilterCount(selected)
  if (combos.length === 0 && count === 0) return null

  function toggle(key: StoreKey, value: string) {
    setDraft((d) => ({ ...d, [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value] }))
  }
  function apply() {
    const params = new URLSearchParams(searchParams.toString())
    applyStoreFilterToParams(params, draft)
    const qs = params.toString()
    setOpen(false)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => { setDraft(selected); setOpen((v) => !v) }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
          count ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-muted/40 text-foreground hover:bg-muted'
        }`}
      >
        <Store className="h-3.5 w-3.5 text-muted-foreground" />
        {count ? `Store filters (${count})` : 'Store filters'}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="dialog" aria-label="Store filters" className="fixed inset-x-3 top-28 z-30 rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1.5 sm:w-[44rem] border border-border bg-card p-3 shadow-lg">
          <p className="px-1 pb-2 text-[11px] text-muted-foreground">
            From the Store Master. Every list follows the other choices, the technician groups and the dates, with the tickets each value has.
          </p>
          <div className="grid max-h-[24rem] gap-4 overflow-auto px-1 sm:grid-cols-2">
            {STORE_FILTER_KEYS.map((key) => {
              const list = options[key]
              if (list.length === 0) return null
              return (
                <fieldset key={key} className="min-w-0">
                  <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{STORE_KEY_LABEL[key]}</legend>
                  <ul className="max-h-40 overflow-auto rounded-lg border border-border/60 p-1">
                    {list.map((o) => (
                      <li key={o.value}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted">
                          <input type="checkbox" checked={draft[key].includes(o.value)} onChange={() => toggle(key, o.value)} className="rounded" />
                          <span className="min-w-0 flex-1 truncate">{o.value}</span>
                          <span className="tabular-nums text-muted-foreground">{o.count}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border px-1 pt-2">
            <button type="button" onClick={() => setDraft(emptyStoreFilter())} className="text-[11px] font-medium text-primary hover:underline">
              Clear all
            </button>
            <button type="button" onClick={apply} className="btn-gradient px-3 py-1 text-xs">
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
