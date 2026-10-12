'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  applyReportFilterToParams, choiceFromEffective, linkedOptions, type EffectiveFilter, type FilterCombo, type FilterDefaults,
} from '@/lib/reporting/analytics/report-filter'
import { STATUS_LABELS } from '@/lib/constants/requests'

type Which = 'group' | 'service' | 'tech' | 'status'

export interface ReportFiltersProps {
  combos: FilterCombo[]
  groups: { id: string; name: string }[]
  services: { id: string; name: string; groupId: string }[]
  defaults: FilterDefaults
  /** what is in force now (a report's starting point where nothing is chosen); an empty list means everything */
  effective: EffectiveFilter
}

/**
 * The filters on a fixed report, in this order: technician group, then service, technician and ticket status. Every list follows the other three and is
 * worked out from what is ticked so far, before Apply. Choosing a group selects all of its services (pick some to narrow); an empty choice means everything.
 * The choice lives in the page address, so the Excel export and a refresh keep it.
 */
export function ReportFilters({ combos, groups, services, defaults, effective }: ReportFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState<Which | null>(null)
  const [draft, setDraft] = useState<EffectiveFilter>(effective)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const options = useMemo(() => linkedOptions(combos, draft), [combos, draft])
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])
  const svc = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const manyGroups = new Set(services.map((s) => s.groupId)).size > 1
  const changed = useMemo(() => {
    const c = choiceFromEffective(effective, defaults)
    return c.statuses.length > 0 || c.techs.length > 0 || c.groups.length > 0 || c.services.length > 0 || c.allGroups || c.allServices
  }, [effective, defaults])

  const statusCustom = !(effective.statuses.length === defaults.statuses.length && effective.statuses.every((s) => defaults.statuses.includes(s)))

  const toggle = (key: keyof EffectiveFilter, v: string) =>
    setDraft((d) => {
      const next = d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v]
      // choosing another group selects all of its services again
      return key === 'groups' ? { ...d, groups: next, services: [] } : { ...d, [key]: next }
    })
  const go = (e: EffectiveFilter) => {
    const params = new URLSearchParams()
    applyReportFilterToParams(params, choiceFromEffective(e, defaults))
    const qs = params.toString()
    setOpen(null)
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const button = (which: Which, label: string, n: number) => (
    <button
      type="button" aria-haspopup="listbox" aria-expanded={open === which}
      onClick={() => { if (open === null) setDraft(effective); setOpen(open === which ? null : which) }}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${n > 0 ? 'border-primary/40 bg-primary/5 text-foreground' : 'border-border bg-card text-foreground hover:bg-muted'}`}
    >
      {n > 0 ? `${label} (${n})` : label}
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open === which ? 'rotate-180' : ''}`} />
    </button>
  )
  const panel = (which: Which, title: string, key: keyof EffectiveFilter, list: { value: string; count: number }[], label: (v: string) => string, clear: { text: string; apply: () => void }) => open === which && (
    <div className="absolute left-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-card p-2 shadow-lg" role="listbox" aria-label={`${title} choices`}>
      <ul className="max-h-72 overflow-auto">
        {list.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Nothing for these choices.</li>}
        {list.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={draft[key].includes(o.value)} onChange={() => toggle(key, o.value)} className="rounded" />
              <span className="min-w-0 flex-1 truncate">{label(o.value)}</span>
              <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex justify-between border-t border-border px-2 pt-2">
        <button type="button" onClick={clear.apply} className="text-[11px] font-medium text-primary hover:underline">{clear.text}</button>
        <button type="button" onClick={() => go(draft)} className="btn-gradient px-3 py-1 text-xs">Apply</button>
      </div>
    </div>
  )

  return (
    <div ref={boxRef} className="flex flex-wrap items-center gap-2">
      <div className="relative">
        {button('group', 'Group', effective.groups.length)}
        {panel('group', 'Group', 'groups', options.groups, (v) => groupName.get(v) ?? v, { text: 'All groups', apply: () => setDraft((d) => ({ ...d, groups: [], services: [] })) })}
      </div>
      <div className="relative">
        {button('service', 'Service', effective.services.length)}
        {panel('service', 'Service', 'services', options.services, (v) => {
          const s = svc.get(v)
          return s ? (manyGroups ? `${s.name} · ${groupName.get(s.groupId) ?? ''}` : s.name) : v
        }, { text: 'All services', apply: () => setDraft((d) => ({ ...d, services: [] })) })}
      </div>
      <div className="relative">
        {button('tech', 'Technician', effective.techs.length)}
        {panel('tech', 'Technician', 'techs', options.techs, (v) => v, { text: 'Everybody', apply: () => setDraft((d) => ({ ...d, techs: [] })) })}
      </div>
      <div className="relative">
        {button('status', 'Status', statusCustom ? effective.statuses.length : 0)}
        {panel('status', 'Status', 'statuses', options.statuses, (v) => (STATUS_LABELS as Record<string, string>)[v] ?? v, { text: 'Report’s own', apply: () => setDraft((d) => ({ ...d, statuses: defaults.statuses })) })}
      </div>
      {changed && <button type="button" onClick={() => go({ statuses: defaults.statuses, techs: [], groups: defaults.groups, services: defaults.services })} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
    </div>
  )
}
