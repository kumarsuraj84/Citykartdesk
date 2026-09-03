'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  X, Loader2, ChevronDown, User, Calendar, Flag,
  Circle, CheckCircle2, XCircle, Clock, ExternalLink,
} from 'lucide-react'
import { updateTaskStatus, updateTaskField } from '@/lib/actions/tasks'
import { attachToProject } from '@/lib/actions/projects'
import { FolderKanban } from 'lucide-react'
import { TaskActivityFeed } from './TaskActivityFeed'
import { SubtaskList } from './SubtaskList'
import { TaskDependencyList } from './TaskDependencyList'
import { formatRelativeTime } from '@/lib/utils'
import type { TaskDependency } from '@/lib/queries/tasks'
import type { TaskWithDetails, TaskCommentWithAuthor, TaskActivityWithActor } from '@/types'
import type { TaskStatus, TaskPriority } from '@/types'

type ProfileMini = { id: string; full_name: string }

interface TaskDetailPanelProps {
  task: TaskWithDetails
  comments: TaskCommentWithAuthor[]
  activity: TaskActivityWithActor[]
  subtasks: TaskWithDetails[]
  dependencies?: { blockedBy: TaskDependency[]; blocking: TaskDependency[] }
  linkedRequest?: { id: string; request_no: string; title: string } | null
  linkedProject?: { id: string; name: string } | null
  allProjects?: { id: string; name: string }[]
  profiles: ProfileMini[]
  currentUserId: string
  currentUserName: string
  onClose: () => void
  onRefreshPanel: () => void
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, { label: string; Icon: React.ElementType; cls: string; iconCls: string }> = {
  open:        { label: 'To Do',       Icon: Circle,        cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',      iconCls: 'text-slate-400' },
  in_progress: { label: 'In Progress', Icon: Clock,         cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400',     iconCls: 'text-amber-500' },
  done:        { label: 'Done',        Icon: CheckCircle2,  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400', iconCls: 'text-emerald-500' },
  cancelled:   { label: 'Cancelled',   Icon: XCircle,       cls: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-500',       iconCls: 'text-slate-400' },
}

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; flagCls: string }> = {
  high:   { label: 'High',   flagCls: 'text-red-500'   },
  medium: { label: 'Normal', flagCls: 'text-blue-500'  },
  low:    { label: 'Low',    flagCls: 'text-slate-400' },
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function AvatarInitial({ name, size = 6 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700']
  const color = colors[name.charCodeAt(0) % colors.length]
  const sizeClass = size === 5 ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sizeClass} ${color}`}>
      {initials}
    </span>
  )
}

// ── Inline dropdown ───────────────────────────────────────────────────────────

function DropdownProp({
  trigger, children, open, onToggle,
}: {
  trigger: React.ReactNode
  children: React.ReactNode
  open: boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onToggle()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])
  return (
    <div className="relative" ref={ref}>
      <div onClick={onToggle} className="cursor-pointer">{trigger}</div>
      {open && (
        <div className="absolute left-0 top-full z-[60] mt-1 min-w-[160px] rounded-xl border border-border bg-card shadow-lg py-1">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function TaskDetailPanel({
  task,
  comments,
  activity,
  subtasks,
  dependencies,
  linkedRequest,
  linkedProject,
  allProjects = [],
  profiles,
  currentUserId,
  currentUserName,
  onClose,
  onRefreshPanel,
}: TaskDetailPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(task.description ?? '')
  const [openDrop, setOpenDrop] = useState<'status' | 'priority' | 'assignee' | 'due' | 'project' | null>(null)
  const [localProject, setLocalProject] = useState(linkedProject ?? null)
  const [localStatus, setLocalStatus]         = useState<TaskStatus>(task.status)
  const [localPriority, setLocalPriority]     = useState<TaskPriority>(task.priority)
  const [localAssigneeId, setLocalAssigneeId] = useState<string | null>(task.assignee_id)
  const [localDueDate, setLocalDueDate]       = useState<string | null>(task.due_date)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const descInputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { if (editingTitle) titleInputRef.current?.focus() }, [editingTitle])
  useEffect(() => { if (editingDesc)  descInputRef.current?.focus()  }, [editingDesc])

  function saveTitle() {
    const val = titleValue.trim()
    if (!val || val === task.title) { setEditingTitle(false); return }
    startTransition(async () => {
      const result = await updateTaskField(task.id, 'title', val)
      if (result?.error) { toast.error(result.error); setTitleValue(task.title); setEditingTitle(false); return }
      setEditingTitle(false)
    })
  }

  function saveDesc() {
    const prev = task.description ?? ''
    startTransition(async () => {
      const result = await updateTaskField(task.id, 'description', descValue.trim() || null)
      if (result?.error) { toast.error(result.error); setDescValue(prev); setEditingDesc(false); return }
      setEditingDesc(false)
    })
  }

  function changeStatus(value: TaskStatus) {
    const prev = localStatus
    setLocalStatus(value); setOpenDrop(null)
    startTransition(async () => {
      const result = await updateTaskStatus(task.id, value)
      if (result?.error) { toast.error(result.error); setLocalStatus(prev) }
    })
  }
  function changePriority(value: TaskPriority) {
    const prev = localPriority
    setLocalPriority(value); setOpenDrop(null)
    startTransition(async () => {
      const result = await updateTaskField(task.id, 'priority', value)
      if (result?.error) { toast.error(result.error); setLocalPriority(prev) }
    })
  }
  function changeAssignee(value: string | null) {
    const prev = localAssigneeId
    setLocalAssigneeId(value); setOpenDrop(null)
    startTransition(async () => {
      const result = await updateTaskField(task.id, 'assignee_id', value)
      if (result?.error) { toast.error(result.error); setLocalAssigneeId(prev) }
    })
  }
  function changeDueDate(value: string) {
    const prev = localDueDate
    const v = value || null; setLocalDueDate(v); setOpenDrop(null)
    startTransition(async () => {
      const result = await updateTaskField(task.id, 'due_date', v)
      if (result?.error) { toast.error(result.error); setLocalDueDate(prev) }
    })
  }
  function changeProject(project: { id: string; name: string } | null) {
    const prev = localProject
    setLocalProject(project); setOpenDrop(null)
    startTransition(async () => {
      const result = await attachToProject('task', task.id, project?.id ?? null)
      if (result?.error) { toast.error(result.error); setLocalProject(prev) }
    })
  }

  const statusCfg    = STATUS_CONFIG[localStatus]
  const priorityCfg  = PRIORITY_CONFIG[localPriority]
  const assignee     = profiles.find((p) => p.id === localAssigneeId) ?? null
  const dueDateLabel = localDueDate
    ? new Date(localDueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Centered modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={`relative flex w-full flex-col rounded-2xl bg-card shadow-2xl overflow-hidden transition-opacity ${isPending ? 'opacity-90' : ''}`}
          style={{ maxWidth: 960, maxHeight: '90vh' }}
        >

          {/* ── Header ── */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 shrink-0">
            {/* Task type pill */}
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Circle className="h-3 w-3" />
              Task
            </span>

            {/* Status dropdown */}
            <DropdownProp
              open={openDrop === 'status'}
              onToggle={() => setOpenDrop(openDrop === 'status' ? null : 'status')}
              trigger={
                <button className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${statusCfg.cls}`}>
                  <statusCfg.Icon className={`h-3 w-3 ${statusCfg.iconCls}`} />
                  {statusCfg.label}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </button>
              }
            >
              {(Object.entries(STATUS_CONFIG) as [TaskStatus, typeof STATUS_CONFIG[TaskStatus]][]).map(([value, cfg]) => (
                <button
                  key={value}
                  onClick={() => changeStatus(value)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted/50 ${value === localStatus ? 'opacity-100' : 'opacity-60'}`}
                >
                  <cfg.Icon className={`h-3.5 w-3.5 ${cfg.iconCls}`} />
                  {cfg.label}
                </button>
              ))}
            </DropdownProp>

            <div className="flex-1" />

            {/* Project picker */}
            <DropdownProp
              open={openDrop === 'project'}
              onToggle={() => setOpenDrop(openDrop === 'project' ? null : 'project')}
              trigger={
                <button className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                  <FolderKanban className="h-3 w-3" />
                  {localProject?.name ?? 'Project'}
                </button>
              }
            >
              <button
                onClick={() => changeProject(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
              >
                No project
              </button>
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => changeProject(p)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${p.id === localProject?.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                >
                  {p.name}
                </button>
              ))}
            </DropdownProp>

            {/* Linked request badge */}
            {linkedRequest && (
              <Link
                href={`/requests/${linkedRequest.id}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="font-mono">{linkedRequest.request_no}</span>
                <span className="text-primary/70">·</span>
                <span className="max-w-[180px] truncate">{linkedRequest.title}</span>
              </Link>
            )}

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Body (two columns) ── */}
          <div className="flex min-h-0 flex-1 overflow-hidden">

            {/* ── LEFT: main content ── */}
            <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4 gap-4 border-r border-border">

              {/* Title */}
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle()
                    if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(task.title) }
                  }}
                  className="w-full rounded-lg border border-ring bg-background px-2 py-1 text-xl font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <h2
                  onClick={() => setEditingTitle(true)}
                  className="cursor-text text-xl font-bold text-foreground hover:bg-muted/40 rounded px-1 -mx-1 py-0.5 transition-colors"
                  title="Click to edit"
                >
                  {task.title}
                </h2>
              )}

              {/* Properties grid — 2 columns like ClickUp */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-0 rounded-xl border border-border/60 bg-background/50 px-5 py-1">

                {/* Status (read-only here — controlled from header) */}
                <div className="col-span-2 grid grid-cols-2 gap-x-6 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground border-r border-border/40">
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                    <span className="w-24 shrink-0">Status</span>
                    <span className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${statusCfg.cls}`}>
                      <statusCfg.Icon className={`h-3 w-3 ${statusCfg.iconCls}`} />
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 py-2">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Assignees</span>
                    <DropdownProp
                      open={openDrop === 'assignee'}
                      onToggle={() => setOpenDrop(openDrop === 'assignee' ? null : 'assignee')}
                      trigger={
                        <button className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted/60 transition-colors">
                          {assignee ? (
                            <><AvatarInitial name={assignee.full_name} size={5} /><span className="text-foreground">{assignee.full_name}</span></>
                          ) : (
                            <span className="text-muted-foreground">Empty</span>
                          )}
                        </button>
                      }
                    >
                      <button onClick={() => changeAssignee(null)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50">
                        <User className="h-3.5 w-3.5" /> Unassigned
                      </button>
                      {profiles.map((p) => (
                        <button key={p.id} onClick={() => changeAssignee(p.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 ${p.id === localAssigneeId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                          <AvatarInitial name={p.full_name} size={5} />{p.full_name}
                        </button>
                      ))}
                    </DropdownProp>
                  </div>
                </div>

                {/* Dates | Priority */}
                <div className="col-span-2 grid grid-cols-2 gap-x-6 border-b border-border/40">
                  <div className="flex items-center gap-2 py-2 border-r border-border/40">
                    <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Due Date</span>
                    <DropdownProp
                      open={openDrop === 'due'}
                      onToggle={() => setOpenDrop(openDrop === 'due' ? null : 'due')}
                      trigger={
                        <button className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted/60 transition-colors">
                          <span className={dueDateLabel ? 'text-foreground' : 'text-muted-foreground'}>
                            {dueDateLabel ?? 'Empty'}
                          </span>
                        </button>
                      }
                    >
                      <div className="px-3 py-2">
                        <input type="date" value={localDueDate?.slice(0, 10) ?? ''} onChange={(e) => changeDueDate(e.target.value)}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" autoFocus />
                        {localDueDate && (
                          <button onClick={() => changeDueDate('')} className="mt-1 block w-full text-left px-1 py-0.5 text-xs text-red-500 hover:text-red-600">Clear date</button>
                        )}
                      </div>
                    </DropdownProp>
                  </div>
                  <div className="flex items-center gap-2 py-2">
                    <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Priority</span>
                    <DropdownProp
                      open={openDrop === 'priority'}
                      onToggle={() => setOpenDrop(openDrop === 'priority' ? null : 'priority')}
                      trigger={
                        <button className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-muted/60 transition-colors">
                          <Flag className={`h-3 w-3 ${priorityCfg.flagCls}`} />
                          <span className="text-foreground">{priorityCfg.label}</span>
                        </button>
                      }
                    >
                      {(Object.entries(PRIORITY_CONFIG) as [TaskPriority, typeof PRIORITY_CONFIG[TaskPriority]][]).map(([value, cfg]) => (
                        <button key={value} onClick={() => changePriority(value)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 ${value === localPriority ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                          <Flag className={`h-3.5 w-3.5 ${cfg.flagCls}`} />{cfg.label}
                        </button>
                      ))}
                    </DropdownProp>
                  </div>
                </div>

                {/* Created by */}
                <div className="col-span-2">
                  <div className="flex items-center gap-2 py-2">
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">Created by</span>
                    <div className="flex items-center gap-1.5">
                      <AvatarInitial name={task.creator.full_name} size={5} />
                      <span className="text-xs text-foreground">{task.creator.full_name}</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Description */}
              <div>
                {editingDesc ? (
                  <div className="space-y-2">
                    <textarea
                      ref={descInputRef}
                      value={descValue}
                      onChange={(e) => setDescValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setEditingDesc(false); setDescValue(task.description ?? '') }
                      }}
                      rows={4}
                      placeholder="Write a description…"
                      className="w-full resize-none rounded-lg border border-ring bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex gap-2">
                      <button onClick={saveDesc} className="btn-gradient">Save</button>
                      <button onClick={() => { setEditingDesc(false); setDescValue(task.description ?? '') }} className="btn-ghost">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => setEditingDesc(true)}
                    className="cursor-text rounded-lg px-3 py-2.5 -mx-3 hover:bg-muted/40 transition-colors min-h-[56px] border border-transparent hover:border-border/60"
                  >
                    {task.description ? (
                      <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/50">Write, press &apos;/&apos; for commands…</p>
                    )}
                  </div>
                )}
              </div>

              {/* Subtasks */}
              <div className="rounded-xl border border-border bg-background/50 px-4 py-3">
                <SubtaskList parentTaskId={task.id} initialSubtasks={subtasks} profiles={profiles} />
              </div>

              {/* Dependencies */}
              {dependencies && (
                <div className="rounded-xl border border-border bg-background/50 px-4 py-3">
                  <TaskDependencyList
                    taskId={task.id}
                    initialBlockedBy={dependencies.blockedBy}
                    initialBlocking={dependencies.blocking}
                  />
                </div>
              )}

              {/* Created timestamp */}
              <p className="text-[10px] text-muted-foreground/50 -mt-2" suppressHydrationWarning>
                Created {formatRelativeTime(task.created_at)}
              </p>
            </div>

            {/* ── RIGHT: Activity + Comment ── */}
            <div className="flex w-[340px] shrink-0 flex-col overflow-hidden">
              {/* Activity label */}
              <div className="border-b border-border px-4 py-2.5 shrink-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</p>
              </div>

              {/* Feed — scrollable */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <TaskActivityFeed
                  taskId={task.id}
                  comments={comments}
                  activity={activity}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  onCommentPosted={onRefreshPanel}
                />
              </div>
            </div>
          </div>

          {/* Saving indicator */}
          {isPending && (
            <div className="absolute bottom-4 right-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
