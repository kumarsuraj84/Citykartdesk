'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Loader2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { createTask, updateTaskStatus } from '@/lib/actions/tasks'
import { TaskStatusBadge, TaskPriorityBadge } from './TaskBadges'
import type { TaskWithDetails, TaskStatus } from '@/types'

// ── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: { status: TaskStatus; label: string; accent: string; dot: string }[] = [
  { status: 'open',        label: 'Open',        accent: 'border-l-blue-400',    dot: 'bg-blue-400' },
  { status: 'in_progress', label: 'In Progress',  accent: 'border-l-amber-400',   dot: 'bg-amber-400' },
  { status: 'done',        label: 'Done',         accent: 'border-l-emerald-400', dot: 'bg-emerald-400' },
  { status: 'cancelled',   label: 'Cancelled',    accent: 'border-l-slate-400',   dot: 'bg-slate-400' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = [
    'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ]
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colors[name.charCodeAt(0) % colors.length]}`}>
      {initials}
    </span>
  )
}

// ── Sortable card ─────────────────────────────────────────────────────────────

function SortableCard({
  task,
  onTaskClick,
  isDragging = false,
}: {
  task: TaskWithDetails
  onTaskClick: (id: string) => void
  isDragging?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: selfDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: selfDragging ? 0.35 : 1,
  }

  // Point-in-time overdue check on frequently-re-rendered card data; not a source of bugs,
  // and threading a shared `now` through the board/DnD tree for this is out of scope here.
  const overdue =
    task.due_date &&
    task.status !== 'done' &&
    task.status !== 'cancelled' &&
    // eslint-disable-next-line react-hooks/purity
    new Date(task.due_date).getTime() < Date.now()

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => !isDragging && onTaskClick(task.id)}
      className={`group relative cursor-pointer rounded-lg border bg-background p-3 shadow-sm transition-all ${
        isDragging
          ? 'border-primary/40 shadow-lg ring-1 ring-primary/20 rotate-[1deg] scale-[1.02]'
          : 'border-border hover:border-ring hover:shadow-md'
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        className="absolute right-2 top-2.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity touch-none"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>

      <p className="pr-5 text-sm font-medium text-foreground leading-snug line-clamp-2 mb-2">
        {task.title}
      </p>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <TaskPriorityBadge priority={task.priority} />
          {task.due_date && (
            <span className={`text-[10px] font-medium ${overdue ? 'text-red-500' : 'text-muted-foreground'}`}>
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
        {task.assignee && <AvatarInitial name={task.assignee.full_name} />}
      </div>
    </div>
  )
}

// ── Drag overlay card (floating clone while dragging) ─────────────────────────

function OverlayCard({ task }: { task: TaskWithDetails }) {
  return <SortableCard task={task} onTaskClick={() => {}} isDragging />
}

// ── Column drop zone ──────────────────────────────────────────────────────────

function BoardColumn({
  status,
  accent,
  tasks,
  onTaskClick,
  isOver,
}: {
  status: TaskStatus
  label: string
  accent: string
  tasks: TaskWithDetails[]
  onTaskClick: (id: string) => void
  isOver: boolean
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: status })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  function handleSave() {
    if (!title.trim()) { setAdding(false); return }
    startTransition(async () => {
      const result = await createTask({ title: title.trim(), taskType: 'personal', status })
      if (!result.error) { setTitle(''); setAdding(false) }
    })
  }

  const canAdd = status === 'open' || status === 'in_progress'

  return (
    <div
      className={`flex w-[calc(25%-12px)] min-w-[220px] shrink-0 flex-col gap-3 rounded-xl border bg-card border-l-4 ${accent} p-3 transition-colors ${
        isOver ? 'bg-primary/5 border-primary/30' : 'border-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={status} />
          <span className="text-xs font-semibold text-muted-foreground">{tasks.length}</span>
        </div>
      </div>

      {/* Cards drop zone — also registered as a droppable so empty columns accept drops */}
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setDropRef}
          className={`flex flex-col gap-2 min-h-[60px] rounded-lg transition-colors ${isOver ? 'bg-primary/5 ring-1 ring-primary/20' : ''}`}
        >
          {tasks.map(task => (
            <SortableCard key={task.id} task={task} onTaskClick={onTaskClick} />
          ))}
        </div>
      </SortableContext>

      {/* Inline add */}
      {canAdd && (
        adding ? (
          <div className="rounded-lg border border-border bg-background p-2 shadow-sm">
            <input
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') { setAdding(false); setTitle('') }
              }}
              placeholder="Task title…"
              className="mb-2 w-full rounded border border-border bg-muted/40 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isPending || !title.trim()}
                className="btn-gradient"
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </button>
              <button onClick={() => { setAdding(false); setTitle('') }} className="text-xs text-muted-foreground hover:text-foreground">Esc</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add task
          </button>
        )
      )}
    </div>
  )
}

// ── Board root ────────────────────────────────────────────────────────────────

export function TaskBoardView({ tasks: initialTasks, onTaskClick }: { tasks: TaskWithDetails[]; onTaskClick: (id: string) => void }) {
  const [tasks, setTasks] = useState<TaskWithDetails[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<TaskWithDetails | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const [, startTransition] = useTransition()

  // Re-sync local board state whenever the server passes a new snapshot of tasks.
  // Adjusting state during render (React's documented pattern) instead of an effect.
  const [prevInitialTasks, setPrevInitialTasks] = useState(initialTasks)
  if (prevInitialTasks !== initialTasks) {
    setPrevInitialTasks(initialTasks)
    setTasks(initialTasks)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const grouped = COLUMNS.reduce<Record<TaskStatus, TaskWithDetails[]>>(
    (acc, { status }) => { acc[status] = tasks.filter(t => t.status === status); return acc },
    { open: [], in_progress: [], done: [], cancelled: [] }
  )

  function findColumnForTask(id: string): TaskStatus | null {
    for (const { status } of COLUMNS) {
      if (grouped[status].some(t => t.id === id)) return status
    }
    return null
  }

  function onDragStart({ active }: DragStartEvent) {
    const task = tasks.find(t => t.id === active.id)
    if (task) setActiveTask(task)
  }

  function resolveColumn(overId: string): TaskStatus | null {
    // Direct column drop zone
    const col = COLUMNS.find(c => c.status === overId)
    if (col) return col.status
    // Card — find which column it lives in
    const task = tasks.find(t => t.id === overId)
    return task?.status ?? null
  }

  function onDragOver({ over }: DragOverEvent) {
    setOverColumn(over ? resolveColumn(String(over.id)) : null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null)
    setOverColumn(null)
    if (!over) return

    const fromCol = findColumnForTask(String(active.id))
    const toCol = resolveColumn(String(over.id))

    if (!toCol || fromCol === toCol) return

    const taskId = String(active.id)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: toCol } : t))
    startTransition(async () => {
      const result = await updateTaskStatus(taskId, toCol)
      if (result.error) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: fromCol ?? t.status } : t))
        toast.error(result.error)
      }
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="overflow-x-auto pb-4">
        <div className="flex min-w-[900px] items-start gap-4">
          {COLUMNS.map(({ status, label, accent }) => (
            <BoardColumn
              key={status}
              status={status}
              label={label}
              accent={accent}
              tasks={grouped[status]}
              onTaskClick={onTaskClick}
              isOver={overColumn === status}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTask ? <OverlayCard task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
