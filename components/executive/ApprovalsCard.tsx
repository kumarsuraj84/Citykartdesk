'use client'

import { useMemo } from 'react'
import {
  APPROVAL_MEASURES, APPROVAL_ORDER, approvalMeasure, approvalRows, approvalSeries, compareApproval, formatApproval,
  type ApprovalMeasure, type ApprovalRow, type Filters, type Win,
} from '@/lib/reporting/executive/engine'
import { BarList, Card, DeltaBadge, Spark, type BarItem } from './ui'

/** Approvals waiting and decided, following every dashboard filter that describes the ticket. */
export function ApprovalsCard({ approvals, filters, now, W, P, compareOn, selectedGroups, onOpen, onPickGroup }: {
  approvals: ApprovalRow[]
  filters: Filters
  now: number
  W: Win
  P: Win
  compareOn: boolean
  selectedGroups: string[]
  onOpen: (m: ApprovalMeasure, path?: { dim: 'group'; value: string }[]) => void
  onPickGroup: (group: string) => void
}) {
  const rows = useMemo(() => approvalRows(approvals, filters, now), [approvals, filters, now])
  // the group bars show every group, whatever group is picked, so one click can switch between them
  const forGroups = useMemo(() => approvalRows(approvals, filters, now, ['group']), [approvals, filters, now])
  const byGroup: BarItem[] = useMemo(() => {
    const g = new Map<string, ApprovalRow[]>()
    for (const a of forGroups) { const x = g.get(a.t.group); if (x) x.push(a); else g.set(a.t.group, [a]) }
    return [...g]
      .map(([key, as]) => ({ key, value: approvalMeasure(as, W, 'pending') ?? 0, text: String(approvalMeasure(as, W, 'pending') ?? 0) }))
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [forGroups, W])

  return (
    <Card title="Approvals" caption="Requests that needed a manager's approval. Click a number for the list behind it; click a group to filter the page.">
      {approvals.length === 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">No approvals in your view for this period.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            {APPROVAL_ORDER.map((m) => {
              const cur = approvalMeasure(rows, W, m)
              return (
                <button key={m} type="button" onClick={() => onOpen(m)} className="rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary">
                  <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{APPROVAL_MEASURES[m].label}</span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="text-2xl font-extrabold">{formatApproval(m, cur)}</span>
                    <Spark values={approvalSeries(rows, W, m)} />
                  </span>
                  <span className="block min-h-[16px]">{compareOn && <DeltaBadge d={compareApproval(m, cur, approvalMeasure(rows, P, m))} />}</span>
                </button>
              )
            })}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Waiting for a decision, by group</p>
            <BarList items={byGroup} selected={selectedGroups} onPick={onPickGroup} onDrill={(g) => onOpen('pending', [{ dim: 'group', value: g }])} emptyText="Nothing is waiting for a decision." />
          </div>
        </div>
      )}
    </Card>
  )
}
