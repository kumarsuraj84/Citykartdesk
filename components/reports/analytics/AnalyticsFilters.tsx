'use client'

import { useState } from 'react'
import { RANGE_PRESETS, type RangePreset } from '@/lib/reporting/analytics/date-ranges'
import { ALL_REPORT_STATUSES } from '@/lib/reporting/analytics/catalog'
import { STATUS_LABELS } from '@/lib/constants/requests'
import type { RequestStatus } from '@/types'

// The only things a viewer can change on a predefined report: which technician group, which dates (by
// when the ticket was created) and which statuses to include. A plain GET form, so the chosen filters
// live in the URL.
export function AnalyticsFilters({ groups, groupId, services, selectedServiceIds, preset, from, to, statuses, resetHref, detail }: {
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
  /** Ticket detail report only: narrow the lines to one technician and/or one age bucket. */
  detail?: { technicians: string[]; buckets: string[]; technician: string; bucket: string }
}) {
  const [range, setRange] = useState<RangePreset>(preset)
  const input = 'rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <form method="get" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        {groups.length > 1 ? (
          <label className="text-xs font-medium text-muted-foreground">
            Technician group
            <select
              name="group"
              defaultValue={groupId}
              // each group has its own services, so changing the group reloads the report straight away
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className={`mt-1 block min-w-[14rem] ${input}`}
            >
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

        {detail && (
          <>
            <label className="text-xs font-medium text-muted-foreground">
              Responsible
              <select name="technician" defaultValue={detail.technician} className={`mt-1 block min-w-[11rem] ${input}`}>
                <option value="">All</option>
                {detail.technicians.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Age bucket
              <select name="bucket" defaultValue={detail.bucket} className={`mt-1 block min-w-[9rem] ${input}`}>
                <option value="">All</option>
                {detail.buckets.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </>
        )}

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

        <div className="ml-auto flex items-center gap-2">
          <a href={resetHref} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Reset</a>
          <button type="submit" className="btn-gradient px-4 py-1.5 text-xs">Apply</button>
        </div>
      </div>

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
