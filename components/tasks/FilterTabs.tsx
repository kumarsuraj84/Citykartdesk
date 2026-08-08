'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'

const FILTERS = [
  { value: 'my_tasks',      label: 'My Tasks',           group: 'Me' },
  { value: 'assigned_me',   label: 'Assigned to Me',     group: 'Me' },
  { value: 'created_by_me', label: 'Created by Me',      group: 'Me' },
  { value: 'due_today',     label: 'Due Today',          group: 'Me' },
  { value: 'overdue',       label: 'Overdue',            group: 'Me' },
  { value: 'team',          label: 'Team Tasks',         group: 'Team' },
  { value: 'team_overdue',  label: 'Team Overdue',       group: 'Team' },
  { value: 'done_week',     label: 'Completed This Week',group: 'Team' },
  { value: 'all',           label: 'All Tasks',          group: 'Team' },
]

export function FilterDropdown({ basePath = '/tasks' }: { basePath?: string } = {}) {
  const sp = useSearchParams()
  const router = useRouter()
  const active = sp.get('filter') ?? 'my_tasks'
  const activeLabel = FILTERS.find(f => f.value === active)?.label ?? 'My Tasks'

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function pick(value: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('filter', value)
    params.delete('page')
    router.push(`${basePath}?${params.toString()}`)
    setOpen(false)
  }

  const groups = ['Me', 'Team']

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/60 transition-colors"
      >
        {activeLabel}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-border bg-card shadow-xl py-1.5">
          {groups.map(group => (
            <div key={group}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {group}
              </p>
              {FILTERS.filter(f => f.group === group).map(f => (
                <button
                  key={f.value}
                  onClick={() => pick(f.value)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                >
                  <span className="flex-1 font-medium">{f.label}</span>
                  {f.value === active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Keep old export for any other imports
export function FilterTabs() {
  return <FilterDropdown />
}
