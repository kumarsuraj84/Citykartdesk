'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { ChevronDown, Plus, Loader2, Trash2, User, Flag, Calendar, UserRound } from 'lucide-react'
import { createSubtask, toggleSubtaskDone, deleteTask } from '@/lib/actions/tasks'
import type { TaskWithDetails, TaskPriority } from '@/types'

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'high',   label: 'High',   color: 'text-red-500' },
  { value: 'medium', label: 'Medium', color: 'text-amber-500' },
  { value: 'low',    label: 'Low',    color: 'text-slate-400' },
]

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = [
    'bg-violet-100 text-violet-700',
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ]
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${color}`}>
      {initials}
    </span>
  )
}

const DUE_DATE_PRESETS = [
  { key: 'today',    label: 'Today',     days: 0 },
  { key: 'tomorrow', label: 'Tomorrow',  days: 1 },
  { key: 'week',     label: 'This week', days: 7 },
]

function addDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function InlineSubtaskAddRow({
  onAdd,
  onCancel,
  profiles,
}: {
  onAdd: (title: string, assigneeId?: string, dueDate?: string, priority?: TaskPriority) => void
  onCancel: () => void
  profiles: { id: string; full_name: string }[]
}) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<{ id: string; full_name: string } | null>(null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [priority, setPriority] = useState<TaskPriority | null>(null)

  const [showAssignee, setShowAssignee] = useState(false)
  const [showDate, setShowDate] = useState(false)
  const [showPriority, setShowPriority] = useState(false)
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })
  const [assigneeSearch, setAssigneeSearch] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const assigneeBtnRef = useRef<HTMLButtonElement>(null)
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const priorityBtnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!showAssignee && !showDate && !showPriority) return
    function close(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAssignee(false); setShowDate(false); setShowPriority(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showAssignee, showDate, showPriority])

  function openPicker(btnRef: React.RefObject<HTMLButtonElement | null>, setter: (v: boolean) => void, others: ((v: boolean) => void)[]) {
    others.forEach(s => s(false))
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPickerPos({ top: rect.bottom + 6, left: rect.left })
    }
    setter(v => !v)
  }

  function handleSave() {
    if (title.trim()) onAdd(title.trim(), assignee?.id, dueDate ?? undefined, priority ?? undefined)
    else onCancel()
  }

  const filteredProfiles = profiles.filter(p =>
    p.full_name.toLowerCase().includes(assigneeSearch.toLowerCase())
  )

  const activePriority = PRIORITY_OPTIONS.find(p => p.value === priority)

  return (
    <tr className="border-t border-border bg-muted/20">
      <td className="w-7 py-1.5 pl-2">
        <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" />
      </td>
      <td colSpan={3} className="py-1.5 pr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onCancel()
            }}
            placeholder="Subtask name…"
            className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
          />

          {/* Quick-set: Assignee */}
          <button
            ref={assigneeBtnRef}
            onClick={() => openPicker(assigneeBtnRef, setShowAssignee, [setShowDate, setShowPriority])}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
              assignee ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="Assign"
          >
            <UserRound className="h-3 w-3" />
            {assignee ? assignee.full_name.split(' ')[0] : null}
          </button>

          {/* Quick-set: Due date */}
          <button
            ref={dateBtnRef}
            onClick={() => openPicker(dateBtnRef, setShowDate, [setShowAssignee, setShowPriority])}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
              dueDate ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="Due date"
          >
            <Calendar className="h-3 w-3" />
            {dueDate ? dueDate : null}
          </button>

          {/* Quick-set: Priority */}
          <button
            ref={priorityBtnRef}
            onClick={() => openPicker(priorityBtnRef, setShowPriority, [setShowAssignee, setShowDate])}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
              priority ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="Priority"
          >
            <Flag className={`h-3 w-3 ${activePriority?.color ?? ''}`} />
            {priority ? activePriority?.label : null}
          </button>

          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-1">Cancel</button>
          <button onClick={handleSave} disabled={!title.trim()} className="btn-gradient disabled:opacity-40 text-xs">Save</button>
        </div>

        {/* Fixed-position dropdowns */}
        {(showAssignee || showDate || showPriority) && (
          <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}
            className="rounded-lg border border-border bg-card shadow-xl min-w-[160px] overflow-hidden"
          >
            {showAssignee && (
              <div className="p-2">
                <input
                  autoFocus
                  value={assigneeSearch}
                  onChange={e => setAssigneeSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded border border-border bg-muted/50 px-2 py-1 text-xs outline-none mb-1.5"
                />
                {assignee && (
                  <button
                    onClick={() => { setAssignee(null); setShowAssignee(false) }}
                    className="w-full text-left px-2 py-1 text-xs text-red-500 hover:bg-muted rounded"
                  >
                    Unassign
                  </button>
                )}
                {filteredProfiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setAssignee(p); setShowAssignee(false); setAssigneeSearch('') }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <AvatarInitial name={p.full_name} />
                    {p.full_name}
                  </button>
                ))}
              </div>
            )}
            {showDate && (
              <div className="p-1">
                {dueDate && (
                  <button
                    onClick={() => { setDueDate(null); setShowDate(false) }}
                    className="w-full text-left px-2 py-1 text-xs text-red-500 hover:bg-muted rounded"
                  >
                    Clear date
                  </button>
                )}
                {DUE_DATE_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => { setDueDate(addDays(p.days)); setShowDate(false) }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <span>{p.label}</span>
                    <span className="text-muted-foreground">{addDays(p.days)}</span>
                  </button>
                ))}
                <div className="border-t border-border mt-1 pt-1 px-2">
                  <input
                    type="date"
                    value={dueDate ?? ''}
                    onChange={e => { setDueDate(e.target.value || null); setShowDate(false) }}
                    className="w-full text-xs bg-transparent outline-none py-1"
                  />
                </div>
              </div>
            )}
            {showPriority && (
              <div className="p-1">
                {PRIORITY_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { setPriority(p.value); setShowPriority(false) }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted ${priority === p.value ? 'font-semibold' : ''}`}
                  >
                    <Flag className={`h-3 w-3 ${p.color}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

interface SubtaskListProps {
  parentTaskId: string
  initialSubtasks: TaskWithDetails[]
  profiles?: { id: string; full_name: string }[]
}

export function SubtaskList({ parentTaskId, initialSubtasks, profiles = [] }: SubtaskListProps) {
  const [subtasks, setSubtasks] = useState<TaskWithDetails[]>(initialSubtasks)
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [, startTransition] = useTransition()

  function handleToggle(subtask: TaskWithDetails) {
    const done = subtask.status !== 'done'
    setSubtasks((prev) =>
      prev.map((s) => s.id === subtask.id ? { ...s, status: done ? 'done' : 'open' } : s)
    )
    startTransition(async () => {
      await toggleSubtaskDone(subtask.id, done)
    })
  }

  function handleDelete(subtaskId: string) {
    setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId))
    startTransition(async () => {
      await deleteTask(subtaskId)
    })
  }

  function handleAdd(title: string, assigneeId?: string, dueDate?: string, priority?: TaskPriority) {
    setAdding(false)
    startTransition(async () => {
      const result = await createSubtask(parentTaskId, title, { assigneeId, dueDate, priority })
      if (!result.error && result.data) {
        const assigneeProfile = assigneeId ? profiles.find(p => p.id === assigneeId) : null
        setSubtasks((prev) => [
          ...prev,
          {
            id: result.data!.id,
            title,
            status: 'open',
            priority: priority ?? 'medium',
            task_type: 'personal',
            parent_task_id: parentTaskId,
            assignee: assigneeProfile ? { id: assigneeProfile.id, full_name: assigneeProfile.full_name } : null,
            assignee_id: assigneeId ?? null,
            created_by: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            description: null,
            due_date: dueDate ?? null,
            completed_at: null,
            request_id: null,
            team_id: null,
            creator: { id: '', full_name: '' },
          } as unknown as TaskWithDetails,
        ])
      }
    })
  }

  const openCount = subtasks.filter((s) => s.status !== 'done' && s.status !== 'cancelled').length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          {subtasks.length === 0 ? 'Add subtask' : (
            <>Subtasks <span className="font-normal text-muted-foreground">{openCount} open</span></>
          )}
        </button>
        <button
          onClick={() => { setAdding(true); setCollapsed(false) }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Table */}
      {!collapsed && (
        <table className="w-full table-auto">
          {subtasks.length > 0 && (
            <thead>
              <tr className="border-b border-border">
                <th className="w-7" />
                <th className="py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                <th className="w-24 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Assignee</th>
                <th className="w-20 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
                <th className="w-16 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority</th>
              </tr>
            </thead>
          )}
          <tbody>
            {subtasks.map((subtask) => {
              const isDone = subtask.status === 'done'
              const flagColor = subtask.priority === 'high' ? 'text-red-500' : subtask.priority === 'medium' ? 'text-amber-500' : 'text-slate-400'
              return (
                <tr key={subtask.id} className="group border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="w-7 py-1.5 pl-2">
                    <button
                      onClick={() => handleToggle(subtask)}
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border hover:border-muted-foreground'
                      }`}
                    >
                      {isDone && (
                        <svg className="h-2 w-2" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm flex-1 ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {subtask.title}
                      </span>
                      <button
                        onClick={() => handleDelete(subtask.id)}
                        className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Delete subtask"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className="w-24 py-1.5">
                    {subtask.assignee
                      ? <AvatarInitial name={subtask.assignee.full_name} />
                      : <User className="h-4 w-4 text-muted-foreground/30" />
                    }
                  </td>
                  <td className="w-20 py-1.5 text-xs text-muted-foreground">
                    {subtask.due_date ? subtask.due_date.slice(0, 10) : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="w-16 py-1.5">
                    <Flag className={`h-3.5 w-3.5 ${subtask.priority ? flagColor : 'text-muted-foreground/30'}`} />
                  </td>
                </tr>
              )
            })}

            {adding ? (
              <InlineSubtaskAddRow
                onAdd={handleAdd}
                onCancel={() => setAdding(false)}
                profiles={profiles}
              />
            ) : (
              <tr className="cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setAdding(true)}>
                <td className="w-7 py-1.5 pl-2">
                  <span className="inline-block h-3.5 w-3.5 rounded-full border border-border/50" />
                </td>
                <td colSpan={4} className="py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                  + Add subtask
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
