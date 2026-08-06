'use client'

import { useState, useEffect, useTransition, type ReactNode } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { LayoutList, Columns3, CalendarDays } from 'lucide-react'
import { TaskTable } from '@/components/tasks/TaskTable'
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel'
import { FilterDropdown } from '@/components/tasks/FilterTabs'
import { loadTaskPanelData } from '@/lib/actions/tasks'
import type {
  TaskWithDetails,
  TaskCommentWithAuthor,
  TaskActivityWithActor,
  CustomField,
  CustomFieldValue,
} from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PanelData {
  task: TaskWithDetails
  comments: TaskCommentWithAuthor[]
  activity: TaskActivityWithActor[]
  subtasks: TaskWithDetails[]
  linkedRequest: { id: string; request_no: string; title: string } | null
}

interface TasksClientProps {
  tasks: TaskWithDetails[]
  profiles: { id: string; full_name: string }[]
  currentUserId: string
  currentUserName: string
  initialTaskId?: string
  teamId: string | null
  initialCustomFields: CustomField[]
  initialCustomFieldValues: Record<string, Record<string, CustomFieldValue['value']>>
  toolbarActions?: ReactNode
}

type ViewMode = 'table' | 'board' | 'calendar'

// ── Lazily-loaded views ─────────────────────────────────────────────────────────
// Board (dnd-kit) and Calendar pull in heavy client deps that the default Table view
// doesn't need. Load their chunks only when the user switches to that view.
function ViewLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
    </div>
  )
}

const TaskBoardView = dynamic(
  () => import('@/components/tasks/TaskBoardView').then((m) => m.TaskBoardView),
  { loading: ViewLoading, ssr: false }
)
const TaskCalendarView = dynamic(
  () => import('@/components/tasks/TaskCalendarView').then((m) => m.TaskCalendarView),
  { loading: ViewLoading, ssr: false }
)

// ── View switcher ─────────────────────────────────────────────────────────────

const VIEW_OPTIONS: { value: ViewMode; label: string; Icon: React.ElementType }[] = [
  { value: 'table',    label: 'Table',    Icon: LayoutList },
  { value: 'board',    label: 'Board',    Icon: Columns3 },
  { value: 'calendar', label: 'Calendar', Icon: CalendarDays },
]

function ViewSwitcher({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
      {VIEW_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all ${
            view === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Client ────────────────────────────────────────────────────────────────────

export function TasksClient({
  tasks,
  profiles,
  currentUserId,
  currentUserName,
  initialTaskId,
  teamId,
  initialCustomFields,
  initialCustomFieldValues,
  toolbarActions,
}: TasksClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const rawView = searchParams.get('view') ?? 'table'
  const view: ViewMode = ['table', 'board', 'calendar'].includes(rawView) ? (rawView as ViewMode) : 'table'

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null)
  const [panelData, setPanelData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(false)

  // Custom fields state — mutable client-side as user adds/removes columns
  const [customFields, setCustomFields] = useState<CustomField[]>(initialCustomFields)
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, Record<string, CustomFieldValue['value']>>>(initialCustomFieldValues)

  function setView(v: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', v)
    startTransition(() => { router.replace(`/tasks?${params.toString()}`) })
  }

  async function openPanel(id: string) {
    setSelectedTaskId(id)
    setLoading(true)
    try {
      const { task, comments, activity, subtasks, linkedRequest } = await loadTaskPanelData(id)
      if (task) {
        setPanelData({
          task,
          comments: comments as TaskCommentWithAuthor[],
          activity: activity as TaskActivityWithActor[],
          subtasks: subtasks as TaskWithDetails[],
          linkedRequest: linkedRequest ?? null,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setSelectedTaskId(null)
    setPanelData(null)
  }

  async function refreshPanel(taskId: string) {
    try {
      const { task, comments, activity, subtasks, linkedRequest } = await loadTaskPanelData(taskId)
      if (task) {
        setPanelData({
          task,
          comments: comments as TaskCommentWithAuthor[],
          activity: activity as TaskActivityWithActor[],
          subtasks: subtasks as TaskWithDetails[],
          linkedRequest: linkedRequest ?? null,
        })
      }
    } catch { /* silent */ }
  }

  function handleCustomValueChange(taskId: string, fieldId: string, value: CustomFieldValue['value']) {
    setCustomFieldValues(prev => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? {}), [fieldId]: value },
    }))
  }

  useEffect(() => {
    if (initialTaskId) openPanel(initialTaskId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId])

  return (
    <>
      {/* Unified toolbar: filter dropdown ← → view switcher + actions */}
      <div className="flex items-center justify-between gap-3">
        <FilterDropdown />
        <div className="flex items-center gap-2">
          <ViewSwitcher view={view} onChange={setView} />
          {toolbarActions}
        </div>
      </div>

      {/* Active view */}
      {view === 'table' && (
        <TaskTable
          tasks={tasks}
          onTaskClick={openPanel}
          customFields={customFields}
          customFieldValues={customFieldValues}
          teamId={teamId}
          onCustomFieldsChange={setCustomFields}
          onCustomValueChange={handleCustomValueChange}
          profiles={profiles}
        />
      )}
      {view === 'board' && <TaskBoardView tasks={tasks} onTaskClick={openPanel} />}
      {view === 'calendar' && <TaskCalendarView tasks={tasks} onTaskClick={openPanel} />}

      {/* Loading overlay */}
      {loading && !panelData && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
              <span className="text-xs">Loading…</span>
            </div>
          </div>
        </>
      )}

      {/* Detail panel */}
      {panelData && selectedTaskId && (
        <TaskDetailPanel
          key={selectedTaskId}
          task={panelData.task}
          comments={panelData.comments}
          activity={panelData.activity}
          subtasks={panelData.subtasks}
          linkedRequest={panelData.linkedRequest}
          profiles={profiles}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={handleClose}
          onRefreshPanel={() => refreshPanel(selectedTaskId)}
        />
      )}
    </>
  )
}
