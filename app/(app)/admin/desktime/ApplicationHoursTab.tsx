'use client'

import { useMemo, useState } from 'react'
import { HorizBar, LineAreaChart } from '@/components/analytics/Charts'
import { summariseAppHours, summariseByApp, summariseByDay, formatMinutes, type AppLogRow } from '@/lib/desktime/aggregate'
import { DateRangeControl, type DateRange } from './DateRangeControl'

function AppChips({ items, tone }: { items: { name: string; minutes: number }[]; tone: string }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span key={i.name} className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>
          {i.name} · {formatMinutes(i.minutes)}
        </span>
      ))}
    </div>
  )
}

// Charts.tsx has no stacked-bar variant — a small local two-segment bar
// mirrors HorizBar's visual language (rounded-full track, same sizing).
function StackedHorizBar({ data }: { data: { label: string; ai: number; other: number }[] }) {
  const max = Math.max(...data.map((d) => d.ai + d.other), 1)
  if (data.length === 0) return <div className="py-4 text-xs text-muted-foreground text-center">No data</div>
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-muted-foreground truncate text-right">{d.label}</span>
          <div className="flex-1 rounded-full bg-muted h-2.5 overflow-hidden flex">
            <div className="h-full" style={{ width: `${(d.ai / max) * 100}%`, background: 'var(--primary)' }} />
            <div className="h-full" style={{ width: `${(d.other / max) * 100}%`, background: 'var(--muted-foreground)' }} />
          </div>
          <span className="w-16 shrink-0 text-xs font-semibold text-foreground tabular-nums text-right">
            {formatMinutes(d.ai + d.other)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ApplicationHoursTab({ appLogs, aiPatterns, range, onRangeChange }: {
  appLogs: AppLogRow[]; aiPatterns: string[]; range: DateRange; onRangeChange: (r: DateRange) => void
}) {
  const [member, setMember] = useState('__all__')

  const scoped = useMemo(
    () => appLogs.filter((l) => l.work_date >= range.from && l.work_date <= range.to),
    [appLogs, range]
  )

  const rows = useMemo(() => summariseAppHours(scoped, aiPatterns), [scoped, aiPatterns])

  const drill = useMemo(() => {
    const filtered = member === '__all__' ? scoped : scoped.filter((l) => l.member_name === member)
    return {
      byApp: summariseByApp(filtered, aiPatterns).slice(0, 12),
      byDay: summariseByDay(filtered, aiPatterns),
    }
  }, [scoped, aiPatterns, member])

  const totals = rows.reduce((acc, r) => ({ ai: acc.ai + r.aiMinutes, other: acc.other + r.otherMinutes }), { ai: 0, other: 0 })
  const grand = totals.ai + totals.other

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Application hours by person</h2>
          <p className="text-xs text-muted-foreground">AI hours are time in any application matching the AI application list.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeControl range={range} onChange={onRangeChange} />
          <span className="text-xs text-muted-foreground">
            AI {formatMinutes(totals.ai)} · Other {formatMinutes(totals.other)}
            {grand > 0 ? ` · ${Math.round((totals.ai / grand) * 100)}% AI` : ''}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No application time synced yet for this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Team member</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI hours</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Other hours</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top AI apps</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top other apps</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.member} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{r.member}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-primary">{formatMinutes(r.aiMinutes)}</td>
                  <td className="px-3 py-2 font-mono">{formatMinutes(r.otherMinutes)}</td>
                  <td className="px-3 py-2 font-mono">{formatMinutes(r.totalMinutes)}</td>
                  <td className="px-3 py-2"><AppChips items={r.topAi} tone="bg-primary/10 text-primary" /></td>
                  <td className="px-3 py-2"><AppChips items={r.topOther} tone="bg-muted text-muted-foreground" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">AI vs other hours by person</h3>
            <select
              value={member}
              onChange={(e) => setMember(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="__all__">Everyone</option>
              {rows.map((r) => <option key={r.member} value={r.member}>{r.member}</option>)}
            </select>
          </div>
          <div className="mt-3">
            <StackedHorizBar
              data={(member === '__all__' ? rows : rows.filter((r) => r.member === member)).map((r) => ({
                label: r.member, ai: r.aiMinutes, other: r.otherMinutes,
              }))}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Top applications{member === '__all__' ? '' : ` — ${member}`}</h3>
          <p className="text-xs text-muted-foreground">AI applications highlighted.</p>
          <div className="mt-3">
            <HorizBar
              data={drill.byApp.map((a) => ({
                label: a.name,
                value: Math.round(a.minutes / 6) / 10,
                color: a.isAi ? 'var(--primary)' : 'var(--muted-foreground)',
              }))}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground">Daily trend{member === '__all__' ? '' : ` — ${member}`}</h3>
          {drill.byDay.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No data for this range.</p>
          ) : (
            <div className="mt-3">
              <LineAreaChart
                data={drill.byDay.map((d) => ({ date: d.date.slice(5), ai: Math.round(d.ai / 6) / 10, other: Math.round(d.other / 6) / 10 }))}
                series={[
                  { key: 'ai',    label: 'AI',    color: 'var(--primary)' },
                  { key: 'other', label: 'Other', color: 'var(--muted-foreground)' },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
