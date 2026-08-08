'use client'

import { useTransition } from 'react'
import { updateTaskStatus, updateTaskField } from '@/lib/actions/tasks'
import type { TaskWithDetails } from '@/types'
import type { TaskStatus } from '@/types'
import { formatRelativeTime } from '@/lib/utils'

interface TaskDetailSidebarProps {
  task: TaskWithDetails
  profiles: { id: string; full_name: string }[]
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function TaskDetailSidebar({ task, profiles }: TaskDetailSidebarProps) {
  const [isPending, startTransition] = useTransition()

  function updateStatus(value: string) {
    startTransition(async () => {
      await updateTaskStatus(task.id, value as TaskStatus)
    })
  }

  function updateField(field: 'priority' | 'assignee_id' | 'due_date', value: string) {
    startTransition(async () => {
      await updateTaskField(task.id, field, value || null)
    })
  }

  const opacity = isPending ? 'opacity-60 pointer-events-none' : ''

  return (
    <aside className={`rounded-xl border border-border bg-card p-5 space-y-0 ${opacity} transition-opacity`}>
      <SidebarRow label="Status">
        <select
          defaultValue={task.status}
          onChange={(e) => updateStatus(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </SidebarRow>

      <SidebarRow label="Priority">
        <select
          defaultValue={task.priority}
          onChange={(e) => updateField('priority', e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </SidebarRow>

      <SidebarRow label="Assignee">
        <select
          defaultValue={task.assignee_id ?? ''}
          onChange={(e) => updateField('assignee_id', e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-w-[160px]"
        >
          <option value="">Unassigned</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </select>
      </SidebarRow>

      <SidebarRow label="Due Date">
        <input
          type="date"
          defaultValue={task.due_date ? task.due_date.slice(0, 10) : ''}
          onBlur={(e) => updateField('due_date', e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </SidebarRow>

      <SidebarRow label="Created by">
        <span className="text-xs font-medium text-foreground">{task.creator.full_name}</span>
      </SidebarRow>

      <SidebarRow label="Created">
        <span className="text-xs text-muted-foreground">{formatRelativeTime(task.created_at)}</span>
      </SidebarRow>
    </aside>
  )
}
