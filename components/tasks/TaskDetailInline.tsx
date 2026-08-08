'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2, Plus, X, Flag, Mail, ExternalLink, FileText,
  CalendarDays, Tag as TagIcon,
} from 'lucide-react'
import {
  updateTaskStatus, updateTaskField, updateTaskTags, updateTaskDates,
  addTaskAssignee, removeTaskAssignee,
} from '@/lib/actions/tasks'
import { SourceCell } from '@/components/ui/SourceCell'
import { TaskActivityFeed } from './TaskActivityFeed'
import { SubtaskList } from './SubtaskList'
import { TaskDependencyList } from './TaskDependencyList'
import { formatRelativeTime } from '@/lib/utils'
import type { TaskWithDetails, TaskCommentWithAuthor, TaskActivityWithActor } from '@/types'
import type { TaskStatus } from '@/types'
import type { TaskAttachment, TaskIntakeContext, TaskDependency } from '@/lib/queries/tasks'

type ProfileMini = { id: string; full_name: string }

interface TaskDetailInlineProps {
  task: TaskWithDetails
  comments: TaskCommentWithAuthor[]
  activity: TaskActivityWithActor[]
  subtasks: TaskWithDetails[]
  dependencies?: { blockedBy: TaskDependency[]; blocking: TaskDependency[] }
  profiles: ProfileMini[]
  assignees: ProfileMini[]
  attachments: TaskAttachment[]
  intakeContext: TaskIntakeContext | null
  currentUserId: string
  currentUserName: string
}

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700',
]
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length] }
function initials(name: string) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }

function Avatar({ name, size = 6 }: { name: string; size?: 5 | 6 }) {
  const dim = size === 5 ? 'h-5 w-5' : 'h-6 w-6'
  return (
    <span className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarColor(name)}`} title={name}>
      {initials(name)}
    </span>
  )
}

const STATUS_PILL: Record<string, string> = {
  open:        'bg-muted text-muted-foreground border-border',
  in_progress: 'bg-warning/10 text-warning border-warning/30',
  done:        'bg-success/10 text-success border-success/30',
  cancelled:   'bg-muted text-muted-foreground border-border',
}
const PRIORITY_COLOR: Record<string, string> = {
  low: 'text-muted-foreground', medium: 'text-warning', high: 'text-destructive',
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="min-h-[28px]">{children}</div>
    </div>
  )
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function TaskDetailInline({
  task, comments, activity, subtasks, dependencies, profiles,
  assignees: initialAssignees, attachments, intakeContext,
  currentUserId, currentUserName,
}: TaskDetailInlineProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(task.description ?? '')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const descInputRef = useRef<HTMLTextAreaElement>(null)

  // Local, optimistic copies of the editable metadata.
  const [status, setStatus] = useState<string>(task.status)
  const [priority, setPriority] = useState<string>(task.priority)
  const [assignees, setAssignees] = useState<ProfileMini[]>(initialAssignees)
  const [tags, setTags] = useState<string[]>(((task as { tags?: string[] }).tags) ?? [])
  const [startDate, setStartDate] = useState<string>((task as { start_date?: string | null }).start_date?.slice(0, 10) ?? '')
  const [dueDate, setDueDate] = useState<string>(task.due_date ? task.due_date.slice(0, 10) : '')

  const [assignOpen, setAssignOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => { if (editingTitle) titleInputRef.current?.focus() }, [editingTitle])
  useEffect(() => { if (editingDesc) descInputRef.current?.focus() }, [editingDesc])

  const source = (task as { source_metadata?: { created_via?: string } | null }).source_metadata?.created_via ?? null
  const assignedIds = new Set(assignees.map(a => a.id))
  const available = profiles.filter(p => !assignedIds.has(p.id))

  function saveTitle() {
    const val = titleValue.trim()
    if (!val || val === task.title) { setEditingTitle(false); return }
    startTransition(async () => { await updateTaskField(task.id, 'title', val); setEditingTitle(false); router.refresh() })
  }
  function saveDesc() {
    const val = descValue.trim()
    startTransition(async () => { await updateTaskField(task.id, 'description', val || null); setEditingDesc(false); router.refresh() })
  }
  function changeStatus(v: string) { setStatus(v); startTransition(async () => { await updateTaskStatus(task.id, v as TaskStatus); router.refresh() }) }
  function changePriority(v: string) { setPriority(v); startTransition(async () => { await updateTaskField(task.id, 'priority', v); router.refresh() }) }
  function saveDates(s: string, d: string) { startTransition(async () => { await updateTaskDates(task.id, s || null, d || null); router.refresh() }) }

  function addAssignee(p: ProfileMini) {
    setAssignees(prev => [...prev, p]); setAssignOpen(false)
    startTransition(async () => { await addTaskAssignee(task.id, p.id); router.refresh() })
  }
  function removeAssignee(id: string) {
    setAssignees(prev => prev.filter(a => a.id !== id))
    startTransition(async () => { await removeTaskAssignee(task.id, id); router.refresh() })
  }
  function addTag() {
    const t = tagInput.trim()
    if (!t || tags.includes(t)) { setTagInput(''); return }
    const next = [...tags, t]; setTags(next); setTagInput('')
    startTransition(async () => { await updateTaskTags(task.id, next); router.refresh() })
  }
  function removeTag(t: string) {
    const next = tags.filter(x => x !== t); setTags(next)
    startTransition(async () => { await updateTaskTags(task.id, next); router.refresh() })
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
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
              className="w-full rounded-lg border border-ring bg-background px-2 py-1 text-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <h1 onClick={() => setEditingTitle(true)} className="cursor-text truncate text-lg font-bold leading-snug text-foreground hover:bg-muted/50 rounded px-1 -mx-1 transition-colors">
              {task.title}
            </h1>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap pt-1 text-[11px] text-muted-foreground">Created {fmtDate(task.created_at)}</span>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Left column */}
        <div className="flex-1 space-y-5 border-b border-border px-5 py-5 lg:border-b-0 lg:border-r">
          {/* Metadata grid */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <MetaCell label="Status">
              <select
                value={status}
                onChange={(e) => changeStatus(e.target.value)}
                className={`appearance-none rounded-full border px-2.5 py-1 text-xs font-semibold capitalize outline-none ${STATUS_PILL[status] ?? STATUS_PILL.open}`}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </MetaCell>

            <MetaCell label="Owner">
              <div className="flex items-center gap-2">
                <Avatar name={task.creator.full_name} />
                <span className="text-xs font-medium text-foreground">{task.creator.full_name}</span>
              </div>
            </MetaCell>

            <MetaCell label="Dates">
              <div className="flex items-center gap-1.5 text-xs">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="date" value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); saveDates(e.target.value, dueDate) }}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                />
                <span className="text-muted-foreground">→</span>
                <input
                  type="date" value={dueDate}
                  onChange={(e) => { setDueDate(e.target.value); saveDates(startDate, e.target.value) }}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                />
              </div>
            </MetaCell>

            <MetaCell label="Priority">
              <span className="inline-flex items-center gap-1.5">
                <Flag className={`h-3.5 w-3.5 ${PRIORITY_COLOR[priority] ?? ''}`} />
                <select
                  value={priority}
                  onChange={(e) => changePriority(e.target.value)}
                  className={`appearance-none bg-transparent text-xs font-semibold capitalize outline-none ${PRIORITY_COLOR[priority] ?? ''}`}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </span>
            </MetaCell>

            <MetaCell label="Assignees">
              <div className="flex flex-wrap items-center gap-1.5">
                {assignees.map((a) => (
                  <span key={a.id} className="group inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-1.5">
                    <Avatar name={a.full_name} size={5} />
                    <span className="text-[11px] font-medium text-foreground">{a.full_name.split(' ')[0]}</span>
                    <button onClick={() => removeAssignee(a.id)} className="text-muted-foreground/50 hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <div className="relative">
                  <button onClick={() => setAssignOpen(v => !v)} className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {assignOpen && (
                    <div className="absolute left-0 top-7 z-20 max-h-60 w-52 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-2xl">
                      {available.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">Everyone is assigned.</p>
                      ) : available.map((p) => (
                        <button key={p.id} onClick={() => addAssignee(p)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted">
                          <Avatar name={p.full_name} size={5} />
                          <span className="text-foreground">{p.full_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </MetaCell>

            <MetaCell label="Source">
              <div className="flex items-center gap-2">
                <SourceCell entity="task" id={task.id} value={source} />
                {intakeContext && (
                  <Link
                    href={intakeContext.reviewId ? `/intake/review/${intakeContext.reviewId}` : '/intake/inbox'}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    Open thread <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                )}
              </div>
            </MetaCell>

            <MetaCell label="Tags">
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {t}
                    <button onClick={() => removeTag(t)} className="text-muted-foreground/50 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-1.5 py-0.5">
                  <TagIcon className="h-3 w-3 text-muted-foreground" />
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                    onBlur={addTag}
                    placeholder="Add"
                    className="w-12 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
                  />
                </span>
              </div>
            </MetaCell>

          </div>

          {/* Context & Thread (intake-sourced tasks) */}
          {intakeContext && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Context &amp; Thread</h3>
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Mail className="h-3.5 w-3.5" />{intakeContext.channelName ?? 'Intake'}
                  </span>
                  <Link
                    href={intakeContext.reviewId ? `/intake/review/${intakeContext.reviewId}` : '/intake/inbox'}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    Open thread <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{intakeContext.subject ?? '(no subject)'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {intakeContext.fromAddress ?? 'unknown'}
                  {intakeContext.threadCount > 1 && ` · ${intakeContext.threadCount} messages`}
                  {intakeContext.receivedAt && ` · ${formatRelativeTime(intakeContext.receivedAt)}`}
                </p>
                {intakeContext.bodyText && (
                  <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-primary/10 pt-2 text-xs leading-relaxed text-foreground/80">
                    {intakeContext.bodyText.slice(0, 2000)}
                  </div>
                )}
                {intakeContext.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {intakeContext.attachments.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-foreground">
                        <FileText className="h-3 w-3 text-muted-foreground" />{f.file_name}
                        <span className="text-muted-foreground">{formatBytes(f.file_size)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">Description</h3>
            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  ref={descInputRef}
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setEditingDesc(false); setDescValue(task.description ?? '') } }}
                  rows={4}
                  placeholder="Add a description…"
                  className="w-full resize-none rounded-lg border border-ring bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-2">
                  <button onClick={saveDesc} className="btn-gradient">Save</button>
                  <button onClick={() => { setEditingDesc(false); setDescValue(task.description ?? '') }} className="btn-ghost">Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)} className="min-h-[50px] cursor-text rounded-lg px-2 py-2 -mx-2 hover:bg-muted/50 transition-colors">
                {task.description
                  ? <p className="whitespace-pre-wrap text-sm text-foreground">{task.description}</p>
                  : <p className="text-sm italic text-muted-foreground">Add description…</p>}
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
        </div>

        {/* Right column — Activities / Timeline */}
        <div className="w-full shrink-0 px-4 py-5 lg:w-[360px]">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Activities / Timeline</h3>
          <TaskActivityFeed
            taskId={task.id}
            comments={comments}
            activity={activity}
            attachments={attachments}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onCommentPosted={() => router.refresh()}
          />
        </div>
      </div>

      {isPending && (
        <div className="pointer-events-none fixed bottom-4 right-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
