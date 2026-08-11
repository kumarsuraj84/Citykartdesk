'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, X } from 'lucide-react'

interface ColumnFilterSelectProps {
  paramName: string
  value: string
  options: { value: string; label: string }[]
  placeholder: string
  pathname: string
  /** Current URL's query string (searchParams.toString(), no leading '?') — a Server
   *  Component can't pass a closure to a Client Component, so this builds hrefs by
   *  adding/removing exactly this one param, locally, from a plain string. */
  currentSearch: string
  className?: string
}

/** Generic "column filter" combobox for the requests table — one instance per
 *  filterable column (Priority, Service, Assignee, …). A search box narrows the
 *  option list client-side (several of these, like Requester, run to 40+ names —
 *  a plain <select> makes those unusable), and picking an option navigates via a
 *  URL param, keeping every filter shareable/bookmarkable. */
export function ColumnFilterSelect({ paramName, value, options, placeholder, pathname, currentSearch, className }: ColumnFilterSelectProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  function handleChange(next: string) {
    const params = new URLSearchParams(currentSearch)
    if (next) params.set(paramName, next)
    else params.delete(paramName)
    params.delete('page')
    setOpen(false); setQuery('')
    router.push(`${pathname}?${params.toString()}`)
  }

  const selected = options.find((o) => o.value === value) ?? null
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={className ?? 'flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring'}
      >
        <span className={selected ? 'text-foreground' : ''}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {value && (
              <button
                type="button"
                onClick={() => handleChange('')}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3 w-3" />{placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
            ) : (
              filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => handleChange(o.value)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors ${o.value === value ? 'bg-muted/60 font-medium text-foreground' : 'text-foreground'}`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
