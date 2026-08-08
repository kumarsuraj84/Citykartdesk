'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { computeAiRatios, buildPersonProjectRows, formatMinutes, type AppLogRow, type MemberProjectLog, type PersonRow } from '@/lib/desktime/aggregate'
import { DateRangeControl, type DateRange } from './DateRangeControl'

function PersonRowView({ row, open, onToggle, showAiSplit }: {
  row: PersonRow; open: boolean; onToggle: () => void; showAiSplit: boolean
}) {
  const topProject = row.projects[0]
  return (
    <>
      <tr className="border-t border-border cursor-pointer hover:bg-muted/30 transition-colors" onClick={onToggle}>
        <td className="px-3 py-2 w-6">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
        <td className="px-3 py-2 font-medium text-foreground">{row.member}</td>
        <td className="px-3 py-2 font-mono">{row.projects.length}</td>
        <td className="px-3 py-2 font-mono">{formatMinutes(row.totalMinutes)}</td>
        {showAiSplit && <td className="px-3 py-2 font-mono text-primary">{formatMinutes(row.aiMinutes)}</td>}
        {showAiSplit && <td className="px-3 py-2 font-mono">{formatMinutes(row.otherMinutes)}</td>}
        <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]">{topProject?.project ?? '—'}</td>
      </tr>
      {open && row.projects.map((p) => (
        <tr key={p.project} className="border-t border-border/60 bg-muted/20">
          <td />
          <td className="px-3 py-1.5 pl-6 text-xs text-muted-foreground">{p.project}</td>
          <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{p.days}d</td>
          <td className="px-3 py-1.5 font-mono text-xs">{formatMinutes(p.minutes)}</td>
          {showAiSplit && <td className="px-3 py-1.5 font-mono text-xs text-primary">{formatMinutes(p.aiMinutes)}</td>}
          {showAiSplit && <td className="px-3 py-1.5 font-mono text-xs">{formatMinutes(p.otherMinutes)}</td>}
          <td />
        </tr>
      ))}
    </>
  )
}

export function ProjectHoursTab({ memberProjectLogs, appLogs, aiPatterns, range, onRangeChange }: {
  memberProjectLogs: MemberProjectLog[]; appLogs: AppLogRow[]; aiPatterns: string[]; range: DateRange; onRangeChange: (r: DateRange) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const scopedLogs = useMemo(
    () => memberProjectLogs.filter((l) => l.work_date >= range.from && l.work_date <= range.to),
    [memberProjectLogs, range]
  )
  const scopedAppLogs = useMemo(
    () => appLogs.filter((l) => l.work_date >= range.from && l.work_date <= range.to),
    [appLogs, range]
  )
  const aiRatios = useMemo(() => computeAiRatios(scopedAppLogs, aiPatterns), [scopedAppLogs, aiPatterns])
  const showAiSplit = scopedAppLogs.length > 0

  const allRows = useMemo(() => buildPersonProjectRows(scopedLogs, aiRatios), [scopedLogs, aiRatios])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => r.member.toLowerCase().includes(q) || r.projects.some((p) => p.project.toLowerCase().includes(q)))
  }, [allRows, search])

  const total = rows.reduce((s, r) => s + r.totalMinutes, 0)
  const totalAi = rows.reduce((s, r) => s + r.aiMinutes, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member or project…"
          className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeControl range={range} onChange={onRangeChange} />
          <span className="text-xs text-muted-foreground">
            {formatMinutes(total)}{showAiSplit ? ` · ${formatMinutes(totalAi)} AI` : ''}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No DeskTime project time in this range. Run a sync or widen the dates.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="px-3 py-2 w-6" />
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Team member</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Projects</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
                {showAiSplit && <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI</th>}
                {showAiSplit && <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Other</th>}
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Top project</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PersonRowView
                  key={r.member}
                  row={r}
                  open={!!open[r.member]}
                  onToggle={() => setOpen((prev) => ({ ...prev, [r.member]: !prev[r.member] }))}
                  showAiSplit={showAiSplit}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
