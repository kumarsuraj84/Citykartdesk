'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, Check } from 'lucide-react'
import {
  createTaskStatus,
  updateTaskStatus,
  deleteTaskStatus,
  reorderTaskStatuses,
  createTaskPriority,
  updateTaskPriority,
  deleteTaskPriority,
} from '@/lib/actions/admin/task-config'
import { TaskTemplatesClient } from './TaskTemplatesClient'
import type { TaskTemplate } from '@/lib/queries/admin'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  is_terminal: boolean
  is_active: boolean
}

export type TaskPriority = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  is_active: boolean
}

// ── Color swatch picker ───────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#6b7280', '#3b82f6', '#22c55e', '#ef4444', '#f97316',
  '#eab308', '#8b5cf6', '#ec4899', '#14b8a6', '#9ca3af',
]

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor: value === c ? '#000' : 'transparent',
          }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-5 cursor-pointer rounded border border-border bg-transparent p-0"
        title="Custom color"
      />
    </div>
  )
}

// ── Task Status Builder ───────────────────────────────────────────────────────

function TaskStatusBuilder({ initialStatuses }: { initialStatuses: TaskStatus[] }) {
  const [statuses, setStatuses] = useState<TaskStatus[]>(
    [...initialStatuses].sort((a, b) => a.display_order - b.display_order)
  )
  const [isPending, start] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [newTerminal, setNewTerminal] = useState(false)
  const [error, setError] = useState('')

  function move(index: number, dir: -1 | 1) {
    const next = [...statuses]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    next.forEach((s, i) => (s.display_order = i))
    setStatuses(next)
    start(async () => {
      await reorderTaskStatuses(next.map((s) => s.id))
    })
  }

  function handleAdd() {
    if (!newName.trim()) return
    const value = newName.trim().toLowerCase().replace(/\s+/g, '_')
    start(async () => {
      const result = await createTaskStatus({
        name: newName.trim(),
        value,
        color: newColor,
        display_order: statuses.length,
        is_terminal: newTerminal,
      })
      if (result.error) { setError(result.error); return }
      setStatuses((prev) => [
        ...prev,
        {
          id: result.data!.id,
          name: newName.trim(),
          value,
          color: newColor,
          display_order: prev.length,
          is_terminal: newTerminal,
          is_active: true,
        },
      ])
      setNewName('')
      setNewColor('#6b7280')
      setNewTerminal(false)
      setShowAdd(false)
      setError('')
    })
  }

  function handleToggle(id: string, field: 'is_terminal' | 'is_active', val: boolean) {
    setStatuses((prev) => prev.map((s) => s.id === id ? { ...s, [field]: val } : s))
    start(async () => {
      await updateTaskStatus(id, { [field]: val })
    })
  }

  function handleDelete(id: string) {
    start(async () => {
      const result = await deleteTaskStatus(id)
      if (result.error) { setError(result.error); return }
      setStatuses((prev) => prev.filter((s) => s.id !== id))
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Header */}
        <div className="grid grid-cols-[32px_32px_1fr_120px_90px_80px_60px] gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
          <span />
          <span />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name / Key</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center">Terminal</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center">Active</span>
          <span />
        </div>

        {statuses.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No statuses yet.</div>
        )}

        {statuses.map((s, i) => (
          <div
            key={s.id}
            className="grid grid-cols-[32px_32px_1fr_120px_90px_80px_60px] gap-2 items-center border-b border-border/50 last:border-0 px-4 py-3"
          >
            {/* Order buttons */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0 || isPending}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === statuses.length - 1 || isPending}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Color swatch */}
            <div className="h-4 w-4 rounded-full border border-border/50" style={{ backgroundColor: s.color }} />

            {/* Name + value */}
            <div>
              <div className="text-sm font-medium text-foreground">{s.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{s.value}</div>
            </div>

            {/* Color picker */}
            <ColorPicker
              value={s.color}
              onChange={(c) => {
                setStatuses((prev) => prev.map((x) => x.id === s.id ? { ...x, color: c } : x))
                start(async () => { await updateTaskStatus(s.id, { color: c }) })
              }}
            />

            {/* Terminal toggle */}
            <div className="flex justify-center">
              <button
                onClick={() => handleToggle(s.id, 'is_terminal', !s.is_terminal)}
                disabled={isPending}
                className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                  s.is_terminal
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-border bg-background'
                }`}
              >
                {s.is_terminal && <Check className="h-3 w-3" />}
              </button>
            </div>

            {/* Active toggle */}
            <div className="flex justify-center">
              <button
                onClick={() => handleToggle(s.id, 'is_active', !s.is_active)}
                disabled={isPending}
                className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  s.is_active ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    s.is_active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Delete */}
            <div className="flex justify-end">
              <button
                onClick={() => handleDelete(s.id)}
                disabled={isPending}
                className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Add form */}
      {showAdd ? (
        <div className="rounded-xl border border-ring bg-card p-4 space-y-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }}
              placeholder="Status name (e.g. In Review)"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={newTerminal}
                onChange={(e) => setNewTerminal(e.target.checked)}
                className="rounded"
              />
              Terminal
            </label>
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={isPending || !newName.trim()}
              className="btn-gradient disabled:opacity-40"
            >
              Add Status
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="btn-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
        >
          <Plus className="h-4 w-4" />
          Add Status
        </button>
      )}
    </div>
  )
}

// ── Task Priority Builder ─────────────────────────────────────────────────────

function TaskPriorityBuilder({ initialPriorities }: { initialPriorities: TaskPriority[] }) {
  const [priorities, setPriorities] = useState<TaskPriority[]>(
    [...initialPriorities].sort((a, b) => a.display_order - b.display_order)
  )
  const [isPending, start] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [error, setError] = useState('')

  function move(index: number, dir: -1 | 1) {
    const next = [...priorities]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    next.forEach((p, i) => (p.display_order = i))
    setPriorities(next)
    // Reorder via individual updates
    start(async () => {
      await Promise.all(
        next.map((p, i) => updateTaskPriority(p.id, { display_order: i }))
      )
    })
  }

  function handleAdd() {
    if (!newName.trim()) return
    const value = newName.trim().toLowerCase().replace(/\s+/g, '_')
    start(async () => {
      const result = await createTaskPriority({
        name: newName.trim(),
        value,
        color: newColor,
        display_order: priorities.length,
      })
      if (result.error) { setError(result.error); return }
      setPriorities((prev) => [
        ...prev,
        {
          id: result.data!.id,
          name: newName.trim(),
          value,
          color: newColor,
          display_order: prev.length,
          is_active: true,
        },
      ])
      setNewName('')
      setNewColor('#6b7280')
      setShowAdd(false)
      setError('')
    })
  }

  function handleToggleActive(id: string, val: boolean) {
    setPriorities((prev) => prev.map((p) => p.id === id ? { ...p, is_active: val } : p))
    start(async () => { await updateTaskPriority(id, { is_active: val }) })
  }

  function handleDelete(id: string) {
    start(async () => {
      const result = await deleteTaskPriority(id)
      if (result.error) { setError(result.error); return }
      setPriorities((prev) => prev.filter((p) => p.id !== id))
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Header */}
        <div className="grid grid-cols-[32px_32px_1fr_120px_80px_60px] gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
          <span />
          <span />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name / Key</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center">Active</span>
          <span />
        </div>

        {priorities.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No priorities yet.</div>
        )}

        {priorities.map((p, i) => (
          <div
            key={p.id}
            className="grid grid-cols-[32px_32px_1fr_120px_80px_60px] gap-2 items-center border-b border-border/50 last:border-0 px-4 py-3"
          >
            {/* Order buttons */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0 || isPending}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === priorities.length - 1 || isPending}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Color swatch */}
            <div className="h-4 w-4 rounded-full border border-border/50" style={{ backgroundColor: p.color }} />

            {/* Name + value */}
            <div>
              <div className="text-sm font-medium text-foreground">{p.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{p.value}</div>
            </div>

            {/* Color picker */}
            <ColorPicker
              value={p.color}
              onChange={(c) => {
                setPriorities((prev) => prev.map((x) => x.id === p.id ? { ...x, color: c } : x))
                start(async () => { await updateTaskPriority(p.id, { color: c }) })
              }}
            />

            {/* Active toggle */}
            <div className="flex justify-center">
              <button
                onClick={() => handleToggleActive(p.id, !p.is_active)}
                disabled={isPending}
                className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  p.is_active ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    p.is_active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Delete */}
            <div className="flex justify-end">
              <button
                onClick={() => handleDelete(p.id)}
                disabled={isPending}
                className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Add form */}
      {showAdd ? (
        <div className="rounded-xl border border-ring bg-card p-4 space-y-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }}
            placeholder="Priority name (e.g. Critical)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={isPending || !newName.trim()}
              className="btn-gradient disabled:opacity-40"
            >
              Add Priority
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="btn-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
        >
          <Plus className="h-4 w-4" />
          Add Priority
        </button>
      )}
    </div>
  )
}

// ── Main TaskConfigClient ─────────────────────────────────────────────────────

type Tab = 'statuses' | 'priorities' | 'templates'

export function TaskConfigClient({
  initialStatuses,
  initialPriorities,
  initialTemplates,
  teamId,
}: {
  initialStatuses: TaskStatus[]
  initialPriorities: TaskPriority[]
  initialTemplates: TaskTemplate[]
  teamId: string | null
}) {
  const [tab, setTab] = useState<Tab>('statuses')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'statuses', label: 'Statuses' },
    { id: 'priorities', label: 'Priorities' },
    { id: 'templates', label: 'Templates' },
  ]

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'statuses' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Task Statuses</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure statuses for the task lifecycle. Terminal statuses mark tasks as complete.
            </p>
          </div>
          <TaskStatusBuilder initialStatuses={initialStatuses} />
        </section>
      )}

      {tab === 'priorities' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Task Priorities</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Priority levels available when creating and managing tasks.
            </p>
          </div>
          <TaskPriorityBuilder initialPriorities={initialPriorities} />
        </section>
      )}

      {tab === 'templates' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Task Templates</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Reusable sets of tasks that can be applied to requests automatically.
            </p>
          </div>
          <TaskTemplatesClient initialTemplates={initialTemplates} teamId={teamId} />
        </section>
      )}
    </div>
  )
}
