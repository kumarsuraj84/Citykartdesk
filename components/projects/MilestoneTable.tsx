'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { updateMilestone, deleteMilestone } from '@/lib/actions/projects'
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from './ProjectStatusBadge'
import { PROJECT_PRIORITY_STYLES } from './ProjectPriorityBadge'
import type { MilestoneWithDetails, ProjectProgress, ProjectStatus, ProjectPriority } from '@/types'

const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']
const PRIORITY_ORDER: ProjectPriority[] = ['P1', 'P2', 'P3']

function ProgressCell({ milestoneId, value, onSaving }: { milestoneId: string; value: number; onSaving: (v: boolean) => void }) {
  const router = useRouter()
  const [local, setLocal] = useState(value)
  const [, startTransition] = useTransition()

  function commit(next: number) {
    const clamped = Math.max(0, Math.min(100, next))
    setLocal(clamped)
    if (clamped === value) return
    onSaving(true)
    startTransition(async () => {
      await updateMilestone(milestoneId, { percentComplete: clamped })
      router.refresh()
      onSaving(false)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${local}%` }} />
      </div>
      <input
        type="number"
        min={0}
        max={100}
        value={local}
        onChange={(e) => setLocal(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
        onBlur={(e) => commit(parseInt(e.target.value, 10) || 0)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        className="w-11 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-xs font-mono text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  )
}

export function MilestoneTable({
  milestones,
  progressByMilestone,
  projectId,
  profiles,
}: {
  milestones: MilestoneWithDetails[]
  progressByMilestone: Record<string, ProjectProgress>
  projectId: string
  profiles: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [savingId, setSavingId] = useState<string | null>(null)

  if (milestones.length === 0) return null

  function patch(id: string, data: Parameters<typeof updateMilestone>[1]) {
    setSavingId(id)
    startTransition(async () => {
      await updateMilestone(id, data)
      router.refresh()
      setSavingId((cur) => (cur === id ? null : cur))
    })
  }

  function handleDelete(m: MilestoneWithDetails) {
    if (!confirm(`Delete enhancement "${m.name}"? Linked tasks keep their status but lose this link.`)) return
    startTransition(async () => {
      await deleteMilestone(m.id)
      router.refresh()
    })
  }

  const selectCls = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'
  const dateCls = 'w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring'
  const TH = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/85 border-r border-white/15 last:border-r-0'
  const TD = 'border-r border-border/60 last:border-r-0'

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-left">
            <th className={TH}>Enhancement</th>
            <th className={TH}>Status</th>
            <th className={`${TH} w-28`}>Priority</th>
            <th className={TH}>Tech Owner</th>
            <th className={TH}>Functional Owner</th>
            <th className={TH}>Start</th>
            <th className={TH}>Target</th>
            <th className={TH}>Progress</th>
            <th className="w-16 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {milestones.map((m, i) => {
            const progress = progressByMilestone[m.id] ?? { not_started: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0, total: 0 }
            const isSaving = savingId === m.id
            return (
              <tr
                key={m.id}
                className={`border-t border-border align-middle transition-colors hover:bg-primary/10 ${i % 2 === 1 ? 'bg-slate-100 dark:bg-white/5' : 'bg-card'} ${isSaving ? 'opacity-60' : ''}`}
              >
                <td className={`${TD} px-3 py-1.5 font-medium text-foreground max-w-[220px] truncate`} title={m.name}>{m.name}</td>

                <td className={`${TD} px-1 py-1.5`}>
                  <select
                    value={m.status}
                    onChange={(e) => patch(m.id, { status: e.target.value as ProjectStatus })}
                    className={`${selectCls} ${PROJECT_STATUS_STYLES[m.status]}`}
                  >
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
                  </select>
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <select
                    value={m.priority}
                    onChange={(e) => patch(m.id, { priority: e.target.value as ProjectPriority })}
                    className={`${selectCls} ${PROJECT_PRIORITY_STYLES[m.priority]}`}
                  >
                    {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <select
                    value={m.owner?.id ?? ''}
                    onChange={(e) => patch(m.id, { ownerId: e.target.value || null })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <select
                    value={m.functional_owner?.id ?? ''}
                    onChange={(e) => patch(m.id, { functionalOwnerId: e.target.value || null })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <input
                    type="date"
                    value={m.start_date ?? ''}
                    onChange={(e) => patch(m.id, { startDate: e.target.value || null })}
                    className={dateCls}
                  />
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <input
                    type="date"
                    value={m.end_date ?? ''}
                    onChange={(e) => patch(m.id, { endDate: e.target.value || null })}
                    className={dateCls}
                  />
                </td>

                <td className={`${TD} px-1 py-1.5`}>
                  <ProgressCell milestoneId={m.id} value={m.percent_complete} onSaving={(v) => setSavingId(v ? m.id : null)} />
                </td>

                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <NewTaskPanel profiles={profiles} defaultProjectId={projectId} defaultMilestoneId={m.id} compact />
                    <button
                      onClick={() => handleDelete(m)}
                      title="Delete enhancement"
                      className="rounded-lg p-1 text-muted-foreground/60 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {progress.total > 0 && (
                    <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{progress.done}/{progress.total} tasks</p>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
