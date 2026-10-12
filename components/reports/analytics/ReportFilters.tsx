'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { applyReportFilterToParams, linkedOptions, type FilterCombo, type ReportFilter } from '@/lib/reporting/analytics/report-filter'
import { STATUS_LABELS } from '@/lib/constants/requests'

type Which = 'status' | 'tech' | null

/**
 * The filters on a fixed report: ticket status and technician. Each list follows the other choice and is worked out from what is ticked so far, before
 * Apply: tick a technician and every status shows that technician's tickets; tick statuses and the technicians offered are the ones who have tickets in them.
 * The choice lives in the page address (?status=...&tech=...), so the Excel export and a refresh keep it.
 */
export function ReportFilters({ combos, defaultStatuses, selected }: { combos: FilterCombo[]; defaultStatuses: string[]; selected: ReportFilter }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState<Which>(null)
  const [draft, setDraft] = useState<ReportFilter>(selected)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const options = useMemo(() => linkedOptions(combos, draft.statuses, draft.techs), [combos, draft])
  const statusCount = selected.statuses.length
  const customStatus = !(statusCount === defaultStatuses.length && selected.statuses.every((s) => defaultStatuses.includes(s)))
  const changed = customStatus || selected.techs.length > 0

  const toggle = (key: 'statuses' | 'techs', v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }))
  const go = (f: ReportFilter) => {
    const params = new URLSearchParams()
    applyReportFilterToParams(params, f, defaultStatuses)
    const qs = params.toString()
    setOpen(null)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }
  const button = (which: Exclude<Which, null>, label: string, active: boolean) => (
    <button
      type="button"
      aria-haspopup="listbox" aria-expanded={open === which}
      onClick={() => { if (open === null) setDraft(selected); setOpen(open === which ? null : which) }}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${active ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}
    >
      {label}
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open === which ? 'rotate-180' : ''}`} />
    </button>
  )
  const panel = 'absolute left-0 z-30 mt-1.5 w-64 rounded-xl border border-border bg-card p-2 shadow-lg'

  return (
    <div ref={boxRef} className="flex flex-wrap items-center gap-2">
      <div className="relative">
        {button('status', customStatus ? `Status (${statusCount})` : 'Status', customStatus)}
        {open === 'status' && (
          <div className={panel} role="listbox" aria-label="Status choices">
            <ul className="max-h-72 overflow-auto">
              {options.statuses.map((o) => (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" checked={draft.statuses.includes(o.value)} onChange={() => toggle('statuses', o.value)} className="rounded" />
                    <span className="min-w-0 flex-1 truncate">{(STATUS_LABELS as Record<string, string>)[o.value] ?? o.value}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex justify-between border-t border-border px-2 pt-2">
              <button type="button" onClick={() => setDraft((d) => ({ ...d, statuses: defaultStatuses }))} className="text-[11px] font-medium text-primary hover:underline">Report’s own</button>
              <button type="button" onClick={() => go(draft)} className="btn-gradient px-3 py-1 text-xs">Apply</button>
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        {button('tech', selected.techs.length > 0 ? `Technician (${selected.techs.length})` : 'Technician', selected.techs.length > 0)}
        {open === 'tech' && (
          <div className={panel} role="listbox" aria-label="Technician choices">
            <ul className="max-h-72 overflow-auto">
              {options.techs.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No technicians in these statuses.</li>}
              {options.techs.map((o) => (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" checked={draft.techs.includes(o.value)} onChange={() => toggle('techs', o.value)} className="rounded" />
                    <span className="min-w-0 flex-1 truncate">{o.value}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex justify-between border-t border-border px-2 pt-2">
              <button type="button" onClick={() => setDraft((d) => ({ ...d, techs: [] }))} className="text-[11px] font-medium text-primary hover:underline">Everybody</button>
              <button type="button" onClick={() => go(draft)} className="btn-gradient px-3 py-1 text-xs">Apply</button>
            </div>
          </div>
        )}
      </div>

      {changed && <button type="button" onClick={() => go({ statuses: [], techs: [] })} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
    </div>
  )
}
