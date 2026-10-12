'use client'

import { useState, type ReactNode } from 'react'
import { RANGE_PRESETS, type RangePreset } from '@/lib/reporting/analytics/date-ranges'
import { ALL_REPORT_STATUSES } from '@/lib/reporting/analytics/catalog'
import { STATUS_LABELS } from '@/lib/constants/requests'
import type { RequestStatus } from '@/types'

export interface FacetSelectProps {
  key: string
  label: string
  value: string
  /** the values that exist given the other filters, with how many tickets each has */
  options: { value: string; count: number }[]
}

/** How many filters sit in the main row; the rest are under "More filters". */
const MAIN_FILTERS = 6

// What a viewer can change on a predefined report: the technician group, the dates (by when the ticket was created), the
// services and statuses, and the report's own filters. A plain GET form, so the chosen filters live in the page address.
// Every filter lists only values that fit the other filters. The ones whose choices depend on the rest (the report's own
// filters, the group) apply as soon as they change; the dates, services and statuses apply with the Apply button.
export function AnalyticsFilters({ groups, groupId, services, selectedServiceIds, preset, from, to, statuses, resetHref, facets, extras }: {
  groups: { id: string; name: string }[]
  groupId: string
  /** The chosen group's services (a group can run several) and which of them are included. */
  services: { id: string; name: string }[]
  selectedServiceIds: string[]
  preset: RangePreset
  from: string
  to: string
  statuses: RequestStatus[]
  resetHref: string
  facets: FacetSelectProps[]
  /** the report's own controls (layout, grouping, limits); mark one that should apply at once with data-auto */
  extras?: ReactNode
}) {
  const [range, setRange] = useState<RangePreset>(preset)
  const input = 'rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const main = facets.slice(0, MAIN_FILTERS)
  const more = facets.slice(MAIN_FILTERS)
  const moreActive = more.filter((f) => f.value).length

  const facetSelect = (f: FacetSelectProps) => (
    <label key={f.key} className="text-xs font-medium text-muted-foreground">
      {f.label}
      <select name={`f_${f.key}`} defaultValue={f.value} data-auto className={`mt-1 block min-w-[9rem] max-w-[16rem] ${input}`}>
        <option value="">All</option>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
      </select>
    </label>
  )

  return (
    <form
      method="get"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      // a filter marked data-auto applies the moment it changes
      onChange={(e) => { if ((e.target as HTMLElement).hasAttribute('data-auto')) e.currentTarget.requestSubmit() }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {groups.length > 1 ? (
          <label className="text-xs font-medium text-muted-foreground">
            Technician group
            <select name="group" defaultValue={groupId} data-auto className={`mt-1 block min-w-[14rem] ${input}`}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="text-xs font-medium text-muted-foreground">
            Technician group
            <p className="mt-1 py-1.5 text-sm font-semibold text-foreground">{groups[0]?.name}</p>
            <input type="hidden" name="group" value={groupId} />
          </div>
        )}

        <label className="text-xs font-medium text-muted-foreground">
          Created
          <select name="range" value={range} onChange={(e) => setRange(e.target.value as RangePreset)} className={`mt-1 block min-w-[15rem] ${input}`}>
            {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {range === 'custom' && (
          <>
            <label className="text-xs font-medium text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={from} className={`mt-1 block ${input}`} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={to} className={`mt-1 block ${input}`} />
            </label>
          </>
        )}

        {extras}

        <div className="ml-auto flex items-center gap-2">
          <a href={resetHref} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Reset</a>
          <button type="submit" className="btn-gradient px-4 py-1.5 text-xs">Apply</button>
        </div>
      </div>

      {main.length > 0 && <div className="flex flex-wrap items-end gap-3">{main.map(facetSelect)}</div>}

      {more.length > 0 && (
        <details className="group" open={moreActive > 0}>
          <summary className="cursor-pointer text-xs font-semibold text-primary">
            More filters{moreActive > 0 ? ` (${moreActive} chosen)` : ''}
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">{more.map(facetSelect)}</div>
        </details>
      )}

      {services.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Service{services.length > 1 ? 's' : ''} in this group</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-foreground">
                <input type="checkbox" name="service" value={s.id} defaultChecked={selectedServiceIds.includes(s.id)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Ticket status</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALL_REPORT_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" name="status" value={s} defaultChecked={statuses.includes(s)} className="h-3.5 w-3.5 rounded border-border accent-primary" />
              {STATUS_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  )
}
