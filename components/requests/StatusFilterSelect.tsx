'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

interface StatusFilterSelectProps {
  value: string
  options: { value: string; label: string }[]
  pathname: string
  /** Current URL's query string (searchParams.toString(), no leading '?') — mirrors
   *  ColumnFilterSelect's approach so a Server Component can pass a plain string
   *  instead of a closure across the client boundary. */
  currentSearch: string
}

/** Status filter as a compact searchable combobox instead of a row of pill
 *  buttons — every state (including "Active" and "All") is always written to
 *  the URL explicitly, so there's no ambiguous "absent param" state to fall
 *  back on incorrectly. */
export function StatusFilterSelect({ value, options, pathname, currentSearch }: StatusFilterSelectProps) {
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
    params.set('status', next)
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
        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {selected?.label ?? 'Status'}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-card shadow-xl">
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
