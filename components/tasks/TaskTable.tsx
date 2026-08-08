'use client'

import { useState, useTransition, useRef, useEffect, Fragment, useCallback, memo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Plus, Loader2, Link2, Settings2, Trash2, CheckSquare, Check, Calendar, X, UserRound, Flag } from 'lucide-react'
import { createTask, fetchSubtasks, deleteTask, updateTaskStatus, updateTaskField } from '@/lib/actions/tasks'
import { assignTaskMilestone } from '@/lib/actions/projects'
import { SourceCell } from '@/components/ui/SourceCell'
import { CustomFieldCell } from './CustomFieldCell'
import { CustomColumnManager, EditFieldModal } from './CustomColumnManager'
import type { TaskWithDetails, CustomField, CustomFieldValue } from '@/types'
import type { TaskStatus } from '@/types'

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'open', 'done', 'cancelled']

const STATUS_META: Record<TaskStatus, { label: string; bg: string; text: string; dot: string }> = {
  in_progress: { label: 'In Progress', bg: 'bg-blue-500',    text: 'text-white',     dot: 'bg-blue-500' },
  open:        { label: 'Open',        bg: 'bg-slate-200',   text: 'text-slate-700', dot: 'bg-slate-400' },
  done:        { label: 'Done',        bg: 'bg-emerald-500', text: 'text-white',     dot: 'bg-emerald-500' },
  cancelled:   { label: 'Cancelled',   bg: 'bg-slate-300',   text: 'text-slate-600', dot: 'bg-slate-400' },
}

const PRIORITY_META: Record<string, { label: string; color: string; dot: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-500',            dot: 'bg-red-500' },
  high:   { label: 'High',   color: 'text-orange-500',         dot: 'bg-orange-500' },
  medium: { label: 'Medium', color: 'text-yellow-500',         dot: 'bg-yellow-400' },
  low:    { label: 'Low',    color: 'text-blue-400',           dot: 'bg-blue-400' },
  none:   { label: 'None',   color: 'text-muted-foreground/50', dot: 'bg-muted-foreground/30' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function toInputDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-violet-100 text-violet-700','bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700']
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colors[name.charCodeAt(0) % colors.length]}`}>
      {initials}
    </span>
  )
}

const TD = 'px-3 py-[5px] text-sm border-r border-border/50 last:border-r-0'
const TH = 'px-3 py-[6px] text-[11px] font-medium text-primary-foreground/85 border-r border-white/15 last:border-r-0 whitespace-nowrap'

// ── Generic cell popover ──────────────────────────────────────────────────────

function CellPopover({ children, trigger, align = 'left' }: {
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  trigger: React.ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, openUp: false })
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const openUp = rect.bottom > window.innerHeight * 0.65
      setPos({
        top: openUp ? rect.top + window.scrollY : rect.bottom + window.scrollY,
        left: align === 'right' ? rect.right - 150 : rect.left,
        width: 150,
        openUp,
      })
    }
    setOpen(v => !v)
  }

  return (
    <>
      <div ref={triggerRef} onClick={handleOpen} className="cursor-pointer inline-block">
        {trigger}
      </div>
      {open && typeof document !== 'undefined' && (
        <div
          ref={dropdownRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top - window.scrollY,
            bottom: pos.openUp ? window.innerHeight - (pos.top - window.scrollY) : undefined,
            left: pos.left,
            zIndex: 9999,
          }}
          className="min-w-[160px] rounded-xl border border-border bg-card shadow-2xl"
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </>
  )
}

// ── Status cell ───────────────────────────────────────────────────────────────

function StatusCell({ taskId, status, onUpdate }: { taskId: string; status: TaskStatus; onUpdate: (s: TaskStatus) => void }) {
  const [isPending, startTransition] = useTransition()
  const m = STATUS_META[status]

  function pick(next: TaskStatus, close: () => void) {
    if (next === status) { close(); return }
    startTransition(async () => {
      const result = await updateTaskStatus(taskId, next)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(next)
      close()
    })
  }

  return (
    <CellPopover
      trigger={
        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap hover:opacity-80 transition-opacity ${m.bg} ${m.text}`}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : m.label}
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </span>
      }
    >
      {(close: () => void) => (
        <div className="p-1">
          {(Object.keys(STATUS_META) as TaskStatus[]).map(s => {
            const sm = STATUS_META[s]
            return (
              <button key={s} onClick={() => pick(s, close)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted transition-colors text-left">
                <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
                <span className="font-medium">{sm.label}</span>
                {s === status && <Check className="h-3 w-3 ml-auto text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </CellPopover>
  )
}

// ── Priority cell ─────────────────────────────────────────────────────────────

// tasks.priority is a NOT NULL DB column with no 'urgent' value (task_priority enum
// is low/medium/high only, default 'medium'). PRIORITY_META also lists 'urgent' and
// 'none' for display purposes, but neither is a legal value to persist — normalize
// both to the same default used on task creation before writing or updating state.
function normalizeTaskPriority(p: string): 'low' | 'medium' | 'high' {
  return p === 'low' || p === 'medium' || p === 'high' ? p : 'medium'
}

function PriorityCell({ taskId, priority, onUpdate }: { taskId: string; priority: string | null; onUpdate: (p: 'low' | 'medium' | 'high') => void }) {
  const [isPending, startTransition] = useTransition()
  const p = PRIORITY_META[priority ?? 'none'] ?? PRIORITY_META.none

  function pick(next: string, close: () => void) {
    const resolved = normalizeTaskPriority(next)
    startTransition(async () => {
      const result = await updateTaskField(taskId, 'priority', resolved)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(resolved)
      close()
    })
  }

  return (
    <CellPopover
      trigger={
        <span className={`chip-3d gap-1.5 text-[12px] font-medium ${p.color}`}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : (
            <><span className={`h-2 w-2 rounded-full ${p.dot}`} />{p.label}<ChevronDown className="h-2.5 w-2.5 opacity-60" /></>
          )}
        </span>
      }
    >
      {(close: () => void) => (
        <div className="p-1">
          {Object.entries(PRIORITY_META).map(([key, pm]) => (
            <button key={key} onClick={() => pick(key, close)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted transition-colors">
              <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
              <span className={`font-medium ${pm.color}`}>{pm.label}</span>
              {key === (priority ?? 'none') && <Check className="h-3 w-3 ml-auto text-primary" />}
            </button>
          ))}
        </div>
      )}
    </CellPopover>
  )
}

// ── Due date cell ─────────────────────────────────────────────────────────────

function DueDateCell({ taskId, dueDate, status, onUpdate }: {
  taskId: string; dueDate: string | null; status: TaskStatus; onUpdate: (d: string | null) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [now] = useState(() => Date.now())
  const overdue = dueDate && status !== 'done' && status !== 'cancelled' && new Date(dueDate).getTime() < now
  const dueSoon = !overdue && dueDate && status !== 'done' && status !== 'cancelled' && new Date(dueDate).getTime() < now + 86_400_000 * 2

  function save(val: string, close: () => void) {
    const iso = val ? new Date(val).toISOString() : null
    startTransition(async () => {
      const result = await updateTaskField(taskId, 'due_date', iso)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(iso)
      close()
    })
  }

  function clear(close: () => void) {
    startTransition(async () => {
      const result = await updateTaskField(taskId, 'due_date', null)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(null)
      close()
    })
  }

  return (
    <CellPopover
      trigger={
        <span className={`flex items-center gap-1 text-[12px] cursor-pointer hover:opacity-70 transition-opacity ${
          overdue ? 'text-red-500 font-medium' : dueSoon ? 'text-amber-500 font-medium' : dueDate ? 'text-foreground' : 'text-muted-foreground/40'
        }`}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : (
            <><Calendar className="h-3 w-3 opacity-60" />{formatDate(dueDate)}</>
          )}
        </span>
      }
    >
      {(close: () => void) => (
        <div className="p-3 space-y-2 w-52">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Due date</p>
          <input
            type="date"
            defaultValue={toInputDate(dueDate)}
            onChange={e => save(e.target.value, close)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {dueDate && (
            <button onClick={() => clear(close)}
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" />Clear date
            </button>
          )}
        </div>
      )}
    </CellPopover>
  )
}

// ── Assignee cell ─────────────────────────────────────────────────────────────

function AssigneeCell({ taskId, assignee, profiles, onUpdate }: {
  taskId: string
  assignee: { id: string; full_name: string } | null
  profiles: { id: string; full_name: string }[]
  onUpdate: (a: { id: string; full_name: string } | null) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [q, setQ] = useState('')
  const filtered = profiles.filter(p => p.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)

  function pick(p: { id: string; full_name: string } | null, close: () => void) {
    startTransition(async () => {
      const result = await updateTaskField(taskId, 'assignee_id', p?.id ?? null)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(p)
      close()
    })
  }

  return (
    <CellPopover
      trigger={
        assignee ? (
          <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-70 transition-opacity">
            <AvatarInitial name={assignee.full_name} />
            <span className="text-[12px] text-foreground truncate max-w-[90px]">{assignee.full_name}</span>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/40 cursor-pointer hover:text-muted-foreground transition-colors">Assign…</span>
        )
      }
    >
      {(close: () => void) => (
        <div className="w-52">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {assignee && (
              <button onClick={() => pick(null, close)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-3 w-3" />Unassign
              </button>
            )}
            {filtered.map(p => (
              <button key={p.id} onClick={() => pick(p, close)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted transition-colors">
                <AvatarInitial name={p.full_name} />
                <span className="truncate">{p.full_name}</span>
                {assignee?.id === p.id && <Check className="h-3 w-3 ml-auto text-primary shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">No match</p>}
          </div>
          {isPending && <div className="px-3 pb-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Saving…</div>}
        </div>
      )}
    </CellPopover>
  )
}

// ── Enhancement (milestone) cell ─────────────────────────────────────────────

function MilestoneCell({ taskId, milestoneId, milestones, onUpdate }: {
  taskId: string
  milestoneId: string | null
  milestones: { id: string; name: string }[]
  onUpdate: (id: string | null) => void
}) {
  const [isPending, startTransition] = useTransition()
  const current = milestones.find(m => m.id === milestoneId) ?? null

  function pick(id: string | null, close: () => void) {
    if (id === milestoneId) { close(); return }
    startTransition(async () => {
      const result = await assignTaskMilestone(taskId, id)
      if (result?.error) { toast.error(result.error); close(); return }
      onUpdate(id)
      close()
    })
  }

  return (
    <CellPopover
      trigger={
        current ? (
          <span className="text-[12px] text-foreground truncate max-w-[110px] inline-block hover:opacity-70 transition-opacity cursor-pointer">
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : current.name}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/40 cursor-pointer hover:text-muted-foreground transition-colors">
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set…'}
          </span>
        )
      }
    >
      {(close: () => void) => (
        <div className="max-h-56 w-56 overflow-y-auto p-1">
          {current && (
            <button onClick={() => pick(null, close)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors">
              <X className="h-3 w-3" />Remove
            </button>
          )}
          {milestones.map(m => (
            <button key={m.id} onClick={() => pick(m.id, close)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted transition-colors text-left">
              <span className="truncate">{m.name}</span>
              {milestoneId === m.id && <Check className="h-3 w-3 ml-auto text-primary shrink-0" />}
            </button>
          ))}
          {milestones.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">No enhancements yet</p>}
        </div>
      )}
    </CellPopover>
  )
}

// ── Inline title edit ─────────────────────────────────────────────────────────

function TitleCell({ taskId, title, status, subtaskCount, onUpdate, onExpand, isExpanded, loadingSubtasks, onOpen }: {
  taskId: string; title: string; status: TaskStatus; subtaskCount: number
  onUpdate: (t: string) => void; onExpand: () => void; isExpanded: boolean; loadingSubtasks: boolean
  onOpen: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(title)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const isDone = status === 'done' || status === 'cancelled'

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  function save() {
    if (!val.trim() || val === title) { setEditing(false); return }
    const trimmed = val.trim()
    startTransition(async () => {
      const result = await updateTaskField(taskId, 'title', trimmed)
      if (result?.error) { toast.error(result.error); setVal(title); setEditing(false); return }
      onUpdate(trimmed)
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={save}
          className="flex-1 rounded border border-primary/50 bg-background px-1.5 py-px text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0 group/title">
      {subtaskCount > 0 ? (
        loadingSubtasks
          ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
          : <button onClick={e => { e.stopPropagation(); onExpand() }} className="shrink-0 text-muted-foreground hover:text-foreground">
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
      ) : <span className="w-3 shrink-0" />}
      <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${STATUS_META[status].dot}`} />
      <span
        className={`truncate text-[13px] cursor-pointer ${isDone ? 'line-through text-muted-foreground' : 'text-foreground hover:text-primary'}`}
        onClick={e => { e.stopPropagation(); onOpen() }}
        onDoubleClick={e => { e.stopPropagation(); setVal(title); setEditing(true) }}
        title="Click to open · Double-click to edit"
      >
        {title}
      </span>
      {subtaskCount > 0 && (
        <span className="shrink-0 flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
          <Link2 className="h-2 w-2" />{subtaskCount}
        </span>
      )}
    </div>
  )
}

// ── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ status, count, sharePct, collapsed, onToggle, colSpan }: {
  status: TaskStatus; count: number; sharePct: number; collapsed: boolean; onToggle: () => void; colSpan: number
}) {
  const m = STATUS_META[status]
  return (
    <tr className="bg-muted/30 select-none">
      <td colSpan={colSpan} className="px-3 py-1.5 border-b border-border">
        <button onClick={onToggle} className="flex w-full items-center gap-2 hover:opacity-80 transition-opacity">
          {collapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          <span className={`inline-block h-2 w-2 rounded-full ${m.dot}`} />
          <span className="text-[11px] font-semibold text-foreground">{m.label}</span>
          <span className="text-[11px] text-muted-foreground">{count}</span>
          <span className="ml-2 h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
            <span className={`block h-full rounded-full ${m.dot}`} style={{ width: `${sharePct}%` }} />
          </span>
        </button>
      </td>
    </tr>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────

const TaskRow = memo(function TaskRow({
  task, rowNum, onTaskClick, customFields, customValues, onCustomValueChange,
  selected, onSelectToggle, profiles, milestones,
  onFieldUpdate,
}: {
  task: TaskWithDetails
  rowNum: number
  onTaskClick: (id: string) => void
  customFields: CustomField[]
  customValues: Record<string, CustomFieldValue['value']>
  onCustomValueChange: (taskId: string, fieldId: string, value: CustomFieldValue['value']) => void
  selected: boolean
  onSelectToggle: (id: string) => void
  profiles: { id: string; full_name: string }[]
  milestones: { id: string; name: string }[]
  onFieldUpdate: (taskId: string, patch: Partial<TaskWithDetails>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [subtasks, setSubtasks] = useState<TaskWithDetails[] | null>(null)
  const [loadingSubtasks, setLoadingSubtasks] = useState(false)
  const subtaskCount = task.subtask_count ?? 0

  async function toggleExpand() {
    if (!subtaskCount) return
    if (!expanded && subtasks === null) {
      setLoadingSubtasks(true)
      const data = await fetchSubtasks(task.id)
      setSubtasks(data as TaskWithDetails[])
      setLoadingSubtasks(false)
    }
    setExpanded(!expanded)
  }

  return (
    <>
      <tr
        className={`group border-b border-border/50 transition-colors ${selected ? 'bg-primary/5' : `hover:bg-primary/10 ${rowNum % 2 === 0 ? 'bg-slate-100 dark:bg-white/5' : 'bg-card'}`}`}
        onClick={() => onTaskClick(task.id)}
      >
        {/* Row num / checkbox */}
        <td className="w-10 px-2 py-[5px] border-r border-border/50 text-center" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground/40 group-hover:hidden w-5 text-right select-none">{rowNum}</span>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelectToggle(task.id)}
              onClick={e => e.stopPropagation()}
              className="hidden group-hover:block h-3 w-3 cursor-pointer rounded-sm border border-border accent-primary"
            />
          </div>
        </td>

        {/* Title — click to open panel, double-click to edit inline */}
        <td className={`${TD} max-w-[280px]`} onClick={e => e.stopPropagation()}>
          <TitleCell
            taskId={task.id}
            title={task.title}
            status={task.status}
            subtaskCount={subtaskCount}
            onUpdate={t => onFieldUpdate(task.id, { title: t })}
            onExpand={toggleExpand}
            isExpanded={expanded}
            loadingSubtasks={loadingSubtasks}
            onOpen={() => onTaskClick(task.id)}
          />
        </td>

        {/* Assignee — click to pick */}
        <td className={`${TD} min-w-[130px]`} onClick={e => e.stopPropagation()}>
          <AssigneeCell
            taskId={task.id}
            assignee={task.assignee}
            profiles={profiles}
            onUpdate={a => onFieldUpdate(task.id, { assignee: a, assignee_id: a?.id ?? null })}
          />
        </td>

        {/* Status — click to pick */}
        <td className={`${TD} min-w-[120px]`} onClick={e => e.stopPropagation()}>
          <StatusCell
            taskId={task.id}
            status={task.status}
            onUpdate={s => onFieldUpdate(task.id, { status: s })}
          />
        </td>

        {/* Due date — click to pick */}
        <td className={`${TD} min-w-[110px]`} onClick={e => e.stopPropagation()}>
          <DueDateCell
            taskId={task.id}
            dueDate={task.due_date}
            status={task.status}
            onUpdate={d => onFieldUpdate(task.id, { due_date: d })}
          />
        </td>

        {/* Priority — click to pick */}
        <td className={`${TD} min-w-[90px]`} onClick={e => e.stopPropagation()}>
          <PriorityCell
            taskId={task.id}
            priority={task.priority}
            onUpdate={p => onFieldUpdate(task.id, { priority: p })}
          />
        </td>

        {/* Enhancement (milestone) — click to pick, only when the project has any */}
        {milestones.length > 0 && (
          <td className={`${TD} min-w-[110px]`} onClick={e => e.stopPropagation()}>
            <MilestoneCell
              taskId={task.id}
              milestoneId={task.milestone_id}
              milestones={milestones}
              onUpdate={id => onFieldUpdate(task.id, { milestone_id: id })}
            />
          </td>
        )}

        {/* Source — editable dropdown */}
        <td className={TD} onClick={e => e.stopPropagation()}>
          <SourceCell
            entity="task"
            id={task.id}
            value={(task as { source_metadata?: { created_via?: string } | null }).source_metadata?.created_via ?? null}
          />
        </td>

        {/* Custom fields */}
        {customFields.map(field => (
          <CustomFieldCell
            key={field.id}
            taskId={task.id}
            field={field}
            value={customValues[field.id] ?? null}
            onUpdate={(fieldId, value) => onCustomValueChange(task.id, fieldId, value)}
          />
        ))}
        <td className="px-3 py-[5px]" onClick={e => e.stopPropagation()} />
      </tr>

      {/* Subtask rows */}
      {expanded && subtasks && subtasks.map((sub, i) => {
        const subDone = sub.status === 'done' || sub.status === 'cancelled'
        return (
          <tr key={sub.id} className="border-b border-border/30 bg-muted/10 hover:bg-muted/30 cursor-pointer" onClick={() => onTaskClick(sub.id)}>
            <td className="w-10 px-2 py-[4px] border-r border-border/50 text-center">
              <span className="text-[10px] text-muted-foreground/30 select-none">{rowNum}.{i+1}</span>
            </td>
            <td className={`${TD} max-w-[280px]`}>
              <div className="flex items-center gap-1.5 pl-5 border-l-2 border-border/30">
                <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${STATUS_META[sub.status].dot}`} />
                <span className={`text-[12px] ${subDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{sub.title}</span>
              </div>
            </td>
            <td className={TD}>{sub.assignee ? <div className="flex items-center gap-1"><AvatarInitial name={sub.assignee.full_name} /></div> : <span className="text-[11px] text-muted-foreground/40">—</span>}</td>
            <td className={TD}><span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[sub.status].bg} ${STATUS_META[sub.status].text}`}>{STATUS_META[sub.status].label}</span></td>
            <td className={`${TD} text-[12px] text-muted-foreground`}>{formatDate(sub.due_date)}</td>
            <td className={TD}><span className={`text-[12px] font-medium ${PRIORITY_META[sub.priority ?? 'none']?.color}`}>{PRIORITY_META[sub.priority ?? 'none']?.label}</span></td>
            {milestones.length > 0 && <td className={`${TD} text-[12px] text-muted-foreground`}>{milestones.find(m => m.id === sub.milestone_id)?.name ?? '—'}</td>}
            <td className={TD} onClick={e => e.stopPropagation()}><SourceCell entity="task" id={sub.id} value={(sub as { source_metadata?: { created_via?: string } | null }).source_metadata?.created_via ?? null} /></td>
            {customFields.map(f => <td key={f.id} className={`${TD} text-[12px] text-muted-foreground`}>—</td>)}
            <td className="px-3 py-[4px]" />
          </tr>
        )
      })}
    </>
  )
})

// ── Inline add row ────────────────────────────────────────────────────────────

function InlineAddRow({
  status, colSpan, onAdded, profiles = [], projectId,
}: {
  status: TaskStatus
  colSpan: number
  onAdded: (task: TaskWithDetails) => void
  profiles?: { id: string; full_name: string }[]
  projectId?: string
}) {
  const router = useRouter()
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Quick-set fields
  const [quickPriority, setQuickPriority] = useState<string | null>(null)
  const [quickDueDate, setQuickDueDate] = useState<string | null>(null)
  const [quickAssignee, setQuickAssignee] = useState<{ id: string; full_name: string } | null>(null)
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [showAssigneePicker, setShowAssigneePicker] = useState(false)
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Fixed-position dropdown state (escape overflow clipping)
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })
  const assigneeBtnRef = useRef<HTMLButtonElement>(null)
  const priorityBtnRef = useRef<HTMLButtonElement>(null)
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (active) inputRef.current?.focus() }, [active])

  // Close pickers on outside click
  useEffect(() => {
    if (!showAssigneePicker && !showPriorityPicker && !showDatePicker) return
    function handler(e: MouseEvent) {
      if (pickerRef.current?.contains(e.target as Node)) return
      if (assigneeBtnRef.current?.contains(e.target as Node)) return
      if (priorityBtnRef.current?.contains(e.target as Node)) return
      if (dateBtnRef.current?.contains(e.target as Node)) return
      setShowAssigneePicker(false)
      setShowPriorityPicker(false)
      setShowDatePicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAssigneePicker, showPriorityPicker, showDatePicker])

  function openPicker(btnRef: React.RefObject<HTMLButtonElement | null>, setter: React.Dispatch<React.SetStateAction<boolean>>, others: Array<React.Dispatch<React.SetStateAction<boolean>>>) {
    others.forEach(s => s(false))
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPickerPos({ top: rect.bottom + 6, left: rect.left })
    }
    setter(v => !v)
  }

  function reset() {
    setTitle(''); setQuickPriority(null); setQuickDueDate(null); setQuickAssignee(null)
    setAssigneeSearch(''); setShowAssigneePicker(false); setShowPriorityPicker(false)
  }

  function handleSave() {
    if (!title.trim()) { setActive(false); reset(); return }
    startTransition(async () => {
      const result = await createTask({
        title: title.trim(),
        taskType: 'personal',
        status,
        priority: quickPriority ? normalizeTaskPriority(quickPriority) : 'medium',
        assigneeId: quickAssignee?.id ?? undefined,
        dueDate: quickDueDate ?? undefined,
        projectId,
      })
      if (!result.error && result.data) {
        onAdded({
          id: result.data.id,
          title: title.trim(),
          status,
          priority: quickPriority ?? 'medium',
          task_type: 'personal',
          parent_task_id: null,
          assignee: quickAssignee ?? null,
          assignee_id: quickAssignee?.id ?? null,
          created_by: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: null,
          due_date: quickDueDate,
          completed_at: null,
          request_id: null,
          project_id: projectId ?? null,
          milestone_id: null,
          team_id: null,
          creator: { id: '', full_name: '' },
          subtask_count: 0,
        } as unknown as TaskWithDetails)
        reset()
        setActive(false)
        router.refresh()
      }
    })
  }

  const filteredProfiles = profiles.filter(p =>
    p.full_name.toLowerCase().includes(assigneeSearch.toLowerCase())
  )

  if (!active) {
    return (
      <tr className="border-b border-border/30 hover:bg-muted/20 cursor-pointer" onClick={() => setActive(true)}>
        <td className="w-10 border-r border-border/50" />
        <td colSpan={colSpan - 1} className="px-3 py-[5px]">
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground/50 hover:text-muted-foreground">
            <Plus className="h-3 w-3" />Add task
          </span>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-border/50 bg-primary/[0.03]">
      <td className="w-10 border-r border-border/50" />
      <td colSpan={colSpan - 1} className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          {/* Task name input */}
          <input
            ref={inputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setActive(false); reset() } }}
            placeholder="Task name…"
            className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />

          {/* Quick-set toolbar */}
          <div className="flex items-center gap-1 shrink-0">

            {/* Assignee button */}
            <button
              ref={assigneeBtnRef}
              type="button"
              onClick={() => openPicker(assigneeBtnRef, setShowAssigneePicker, [setShowPriorityPicker, setShowDatePicker])}
              title="Assign"
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
                quickAssignee ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {quickAssignee
                ? <><AvatarInitial name={quickAssignee.full_name} /><span>{quickAssignee.full_name.split(' ')[0]}</span></>
                : <UserRound className="h-3.5 w-3.5" />
              }
            </button>

            {/* Due date button */}
            <button
              ref={dateBtnRef}
              type="button"
              onClick={() => openPicker(dateBtnRef, setShowDatePicker, [setShowAssigneePicker, setShowPriorityPicker])}
              title="Due date"
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
                quickDueDate ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              {quickDueDate && <span>{formatDate(quickDueDate)}</span>}
            </button>

            {/* Priority button */}
            <button
              ref={priorityBtnRef}
              type="button"
              onClick={() => openPicker(priorityBtnRef, setShowPriorityPicker, [setShowAssigneePicker, setShowDatePicker])}
              title="Priority"
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors ${
                quickPriority && quickPriority !== 'none'
                  ? `${PRIORITY_META[quickPriority]?.color} bg-muted font-medium`
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Flag className="h-3.5 w-3.5" />
              {quickPriority && quickPriority !== 'none' && (
                <span>{PRIORITY_META[quickPriority]?.label}</span>
              )}
            </button>

            {/* Fixed-position dropdowns — escape overflow clipping */}
            {showAssigneePicker && (
              <div ref={pickerRef} style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
                className="w-48 rounded-xl border border-border bg-card shadow-2xl">
                <div className="p-1.5 border-b border-border/50">
                  <input autoFocus value={assigneeSearch} onChange={e => setAssigneeSearch(e.target.value)}
                    placeholder="Search…"
                    className="w-full rounded-md bg-muted/60 px-2 py-1 text-xs focus:outline-none" />
                </div>
                <div className="max-h-44 overflow-y-auto p-1">
                  {quickAssignee && (
                    <button onClick={() => { setQuickAssignee(null); setShowAssigneePicker(false) }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                      <X className="h-3 w-3" />Unassign
                    </button>
                  )}
                  {filteredProfiles.map(p => (
                    <button key={p.id} onClick={() => { setQuickAssignee(p); setShowAssigneePicker(false); setAssigneeSearch('') }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted text-left">
                      <AvatarInitial name={p.full_name} />
                      <span className="font-medium">{p.full_name}</span>
                      {quickAssignee?.id === p.id && <Check className="h-3 w-3 ml-auto text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showDatePicker && (
              <div ref={pickerRef} style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
                className="rounded-xl border border-border bg-card shadow-2xl p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Due date</p>
                <input
                  type="date"
                  autoFocus
                  value={toInputDate(quickDueDate)}
                  onChange={e => {
                    setQuickDueDate(e.target.value ? new Date(e.target.value).toISOString() : null)
                    setShowDatePicker(false)
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                {quickDueDate && (
                  <button onClick={() => { setQuickDueDate(null); setShowDatePicker(false) }}
                    className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />Clear
                  </button>
                )}
              </div>
            )}

            {showPriorityPicker && (
              <div ref={pickerRef} style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
                className="w-36 rounded-xl border border-border bg-card shadow-2xl p-1">
                {Object.entries(PRIORITY_META).map(([key, pm]) => (
                  <button key={key} onClick={() => { setQuickPriority(key); setShowPriorityPicker(false) }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted transition-colors">
                    <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
                    <span className={`font-medium ${pm.color}`}>{pm.label}</span>
                    {key === (quickPriority ?? 'none') && <Check className="h-3 w-3 ml-auto text-primary" />}
                  </button>
                ))}
              </div>
            )}

            <div className="w-px h-4 bg-border/60 mx-1" />

            {/* Save / Cancel */}
            <button
              onClick={handleSave}
              disabled={isPending || !title.trim()}
              className="btn-gradient"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <>Save <span className="opacity-60 font-normal">↵</span></>}
            </button>
            <button onClick={() => { setActive(false); reset() }} className="btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Main table ────────────────────────────────────────────────────────────────

interface TaskTableProps {
  tasks: TaskWithDetails[]
  onTaskClick: (id: string) => void
  customFields: CustomField[]
  customFieldValues: Record<string, Record<string, CustomFieldValue['value']>>
  teamId: string | null
  onCustomFieldsChange: (fields: CustomField[]) => void
  onCustomValueChange: (taskId: string, fieldId: string, value: CustomFieldValue['value']) => void
  profiles?: { id: string; full_name: string }[]
  /** Enhancements (milestones) for the current project — omit outside a project context. */
  milestones?: { id: string; name: string }[]
  /** Scopes tasks created via the inline "+ Add task" row to this project — omit outside a project context. */
  projectId?: string
}

export function TaskTable({ tasks: initialTasks, onTaskClick, customFields, customFieldValues, teamId, onCustomFieldsChange, onCustomValueChange, profiles = [], milestones = [], projectId }: TaskTableProps) {
  const [tasks, setTasks] = useState<TaskWithDetails[]>(initialTasks)
  const [prevInitialTasks, setPrevInitialTasks] = useState(initialTasks)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskStatus>>(new Set())
  const [editingField, setEditingField] = useState<CustomField | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPending, startBulkTransition] = useTransition()
  const [bulkError, setBulkError] = useState('')

  if (initialTasks !== prevInitialTasks) {
    setPrevInitialTasks(initialTasks)
    setTasks(initialTasks)
  }

  const handleFieldUpdate = useCallback((taskId: string, patch: Partial<TaskWithDetails>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
  }, [])

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  function handleBulkStatus(status: TaskStatus) {
    const ids = Array.from(selectedIds)
    setBulkError('')
    startBulkTransition(async () => {
      const results = await Promise.all(ids.map(id => updateTaskStatus(id, status)))
      const succeededIds = ids.filter((id, i) => !results[i].error)
      setTasks(prev => prev.map(t => succeededIds.includes(t.id) ? { ...t, status } : t))
      const failedCount = ids.length - succeededIds.length
      if (failedCount > 0) {
        setBulkError(`Failed to update ${failedCount} of ${ids.length} task(s).`)
      }
      clearSelection()
    })
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (!confirm(`Delete ${ids.length} task(s)? This cannot be undone.`)) return
    setBulkError('')
    startBulkTransition(async () => {
      const results = await Promise.all(ids.map(id => deleteTask(id)))
      const succeededIds = ids.filter((id, i) => !results[i].error)
      setTasks(prev => prev.filter(t => !succeededIds.includes(t.id)))
      const failedCount = ids.length - succeededIds.length
      if (failedCount > 0) {
        setBulkError(`Failed to delete ${failedCount} of ${ids.length} task(s).`)
      }
      clearSelection()
    })
  }

  const STATUS_TABS: { value: TaskStatus | 'all'; label: string }[] = [
    { value: 'all',         label: 'All' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'open',        label: 'Open' },
    { value: 'done',        label: 'Done' },
    { value: 'cancelled',   label: 'Cancelled' },
  ]

  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s).length; return acc
  }, {})

  const visibleTasks = statusFilter === 'all' ? tasks : tasks.filter(t => t.status === statusFilter)
  const canAdd = statusFilter === 'all' || statusFilter === 'open' || statusFilter === 'in_progress'
  const addStatus: TaskStatus = statusFilter === 'all' || statusFilter === 'in_progress' ? 'in_progress' : 'open'

  const totalCols = 8 + customFields.length + 1 + (milestones.length > 0 ? 1 : 0)

  // Grouped-by-status rendering only makes sense on the "All" tab — a single-status
  // filter is already one implicit group.
  const isGrouped = statusFilter === 'all'
  const groups = isGrouped
    ? STATUS_ORDER.map(s => ({ status: s, items: visibleTasks.filter(t => t.status === s) })).filter(g => g.items.length > 0)
    : []

  function toggleGroup(status: TaskStatus) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status); else next.add(status)
      return next
    })
  }

  return (
    <>
      {editingField && (
        <EditFieldModal
          field={editingField}
          onDone={updates => { onCustomFieldsChange(customFields.map(f => f.id === editingField.id ? { ...f, ...updates } : f)); setEditingField(null) }}
          onDelete={() => { onCustomFieldsChange(customFields.filter(f => f.id !== editingField.id)); setEditingField(null) }}
          onClose={() => setEditingField(null)}
        />
      )}

      {selectedIds.size > 0 && (
        <div className="mb-2 rounded-xl border border-border bg-card px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CheckSquare className="h-3.5 w-3.5" />{selectedIds.size} selected
            </span>
            <div className="flex gap-2">
              {(['in_progress', 'done'] as TaskStatus[]).map(s => (
                <button key={s} onClick={() => handleBulkStatus(s)} disabled={bulkPending}
                  className={`rounded px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 ${STATUS_META[s].bg} ${STATUS_META[s].text}`}>
                  {STATUS_META[s].label}
                </button>
              ))}
              <button onClick={handleBulkDelete} disabled={bulkPending}
                className="btn-danger">
                {bulkPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}Delete
              </button>
            </div>
            <button onClick={clearSelection} className="btn-ghost ml-auto">Clear</button>
          </div>
          {bulkError && <p className="mt-1.5 text-xs text-red-500">{bulkError}</p>}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Status filter tabs — inside the card, above the table */}
        <div className="flex items-center gap-0 border-b border-border px-3 bg-muted/20">
          {STATUS_TABS.map(tab => {
            const count = tab.value === 'all' ? tasks.length : counts[tab.value] ?? 0
            const active = statusFilter === tab.value
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-primary">
              <th className="w-10 px-2 py-[6px] border-r border-white/15" />
              <th className={TH}>Name</th>
              <th className={TH}>Assignee</th>
              <th className={TH}>Status</th>
              <th className={TH}>Due date</th>
              <th className={TH}>Priority</th>
              {milestones.length > 0 && <th className={TH}>Enhancement</th>}
              <th className={TH}>Source</th>
              {customFields.map(field => (
                <th key={field.id} className={TH}>
                  <div className="flex items-center gap-1 group/col">
                    {field.name}
                    <button onClick={() => setEditingField(field)} className="opacity-0 group-hover/col:opacity-100 rounded p-0.5 text-primary-foreground/60 hover:text-primary-foreground transition-all">
                      <Settings2 className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="px-3 py-[6px]">
                {teamId && <CustomColumnManager teamId={teamId} fields={customFields} onFieldsChange={onCustomFieldsChange} />}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.length === 0 && (
              <tr><td colSpan={totalCols} className="py-16 text-center">
                <p className="text-sm font-medium text-foreground">No tasks found</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {statusFilter === 'all' ? 'Create your first task using the button above.' : `No ${STATUS_META[statusFilter as TaskStatus]?.label} tasks.`}
                </p>
              </td></tr>
            )}
            {isGrouped ? (
              groups.map(({ status, items }) => (
                <Fragment key={status}>
                  <GroupHeader
                    status={status}
                    count={items.length}
                    sharePct={visibleTasks.length > 0 ? (items.length / visibleTasks.length) * 100 : 0}
                    collapsed={collapsedGroups.has(status)}
                    onToggle={() => toggleGroup(status)}
                    colSpan={totalCols}
                  />
                  {!collapsedGroups.has(status) && items.map((task, i) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      rowNum={i + 1}
                      onTaskClick={onTaskClick}
                      customFields={customFields}
                      customValues={customFieldValues[task.id] ?? {}}
                      onCustomValueChange={onCustomValueChange}
                      selected={selectedIds.has(task.id)}
                      onSelectToggle={toggleSelect}
                      profiles={profiles}
                      milestones={milestones}
                      onFieldUpdate={handleFieldUpdate}
                    />
                  ))}
                </Fragment>
              ))
            ) : (
              visibleTasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  rowNum={i + 1}
                  onTaskClick={onTaskClick}
                  customFields={customFields}
                  customValues={customFieldValues[task.id] ?? {}}
                  onCustomValueChange={onCustomValueChange}
                  selected={selectedIds.has(task.id)}
                  onSelectToggle={toggleSelect}
                  profiles={profiles}
                  milestones={milestones}
                  onFieldUpdate={handleFieldUpdate}
                />
              ))
            )}
            {canAdd && (
              <InlineAddRow
                status={addStatus}
                colSpan={totalCols}
                profiles={profiles}
                projectId={projectId}
                onAdded={task => setTasks(prev => [...prev, task])}
              />
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}
