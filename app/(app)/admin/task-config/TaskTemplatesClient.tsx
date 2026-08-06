'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Edit2, Save, X, GripVertical, Clock } from 'lucide-react'
import { createTaskTemplate, updateTaskTemplate, deleteTaskTemplate, upsertTemplateItem, deleteTemplateItem } from '@/lib/actions/admin/config'
import type { TaskTemplate, TaskTemplateItem } from '@/lib/queries/admin'

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'text-red-600 bg-red-50 border-red-100',
  high:   'text-orange-600 bg-orange-50 border-orange-100',
  medium: 'text-blue-600 bg-blue-50 border-blue-100',
  low:    'text-slate-600 bg-slate-50 border-slate-200',
}

// ── Template item row ─────────────────────────────────────────────────────────

function TemplateItemRow({
  item,
  templateId,
  onDeleted,
  onUpdated,
}: {
  item: TaskTemplateItem
  templateId: string
  onDeleted: (id: string) => void
  onUpdated: (updated: TaskTemplateItem) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [title, setTitle]       = useState(item.title)
  const [priority, setPriority] = useState(item.default_priority)
  const [offset, setOffset]     = useState(String(item.due_offset_days ?? ''))
  const [isPending, start]      = useTransition()

  function handleSave() {
    start(async () => {
      const result = await upsertTemplateItem({
        id: item.id,
        templateId,
        title,
        defaultPriority: priority,
        dueOffsetDays: offset ? parseInt(offset, 10) : null,
        position: item.position,
      })
      if (!result.error) {
        onUpdated({ ...item, title, default_priority: priority, due_offset_days: offset ? parseInt(offset, 10) : null })
        setEditing(false)
      }
    })
  }

  function handleDelete() {
    start(async () => {
      await deleteTemplateItem(item.id)
      onDeleted(item.id)
    })
  }

  if (editing) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-ring bg-muted/30 p-2.5 space-y-2">
        <GripVertical className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
        <div className="flex-1 space-y-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskTemplateItem['default_priority'])}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <input
              type="number"
              min="0"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder="Due offset days"
              className="w-36 rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={isPending} className="btn-gradient disabled:opacity-40">
              <Save className="h-3 w-3" /> Save
            </button>
            <button onClick={() => setEditing(false)} className="btn-soft">Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background px-3 py-2 group">
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
      <span className="flex-1 text-sm text-foreground">{item.title}</span>
      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLES[item.default_priority]}`}>
        {item.default_priority}
      </span>
      {item.due_offset_days != null && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          +{item.due_offset_days}d
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted">
          <Edit2 className="h-3 w-3" />
        </button>
        <button onClick={handleDelete} disabled={isPending} className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onDeleted,
}: {
  template: TaskTemplate
  onDeleted: (id: string) => void
}) {
  const [expanded, setExpanded]     = useState(false)
  const [items, setItems]           = useState<TaskTemplateItem[]>(template.items ?? [])
  const [editingName, setEditingName] = useState(false)
  const [name, setName]             = useState(template.name)
  const [newTitle, setNewTitle]     = useState('')
  const [showAdd, setShowAdd]       = useState(false)
  const [isPending, start]          = useTransition()

  function handleRename() {
    if (!name.trim() || name === template.name) { setEditingName(false); return }
    start(async () => {
      await updateTaskTemplate(template.id, { name })
      setEditingName(false)
    })
  }

  function handleAddItem() {
    if (!newTitle.trim()) return
    start(async () => {
      const result = await upsertTemplateItem({
        templateId: template.id,
        title: newTitle.trim(),
        position: items.length,
      })
      if (!result.error && result.data) {
        setItems((prev) => [...prev, {
          id: result.data!.id,
          template_id: template.id,
          title: newTitle.trim(),
          description: null,
          default_priority: 'medium',
          due_offset_days: null,
          position: items.length,
        }])
        setNewTitle('')
        setShowAdd(false)
      }
    })
  }

  function handleDelete() {
    start(async () => {
      await deleteTaskTemplate(template.id)
      onDeleted(template.id)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditingName(false) }}
            className="flex-1 rounded-lg border border-ring bg-background px-2 py-1 text-sm font-semibold focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditingName(true)} className="flex-1 text-left text-sm font-semibold text-foreground hover:text-primary">
            {name}
          </button>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {items.length} task{items.length !== 1 ? 's' : ''}
        </span>
        <button onClick={handleDelete} disabled={isPending} className="rounded-lg p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Items */}
      {expanded && (
        <div className="p-3 space-y-2">
          {items.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">No task items yet. Add some below.</p>
          ) : (
            items.map((item) => (
              <TemplateItemRow
                key={item.id}
                item={item}
                templateId={template.id}
                onDeleted={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
                onUpdated={(updated) => setItems((prev) => prev.map((i) => i.id === updated.id ? updated : i))}
              />
            ))
          )}

          {/* Add item */}
          {showAdd ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setShowAdd(false) }}
                placeholder="Task title…"
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button onClick={handleAddItem} disabled={isPending || !newTitle.trim()} className="btn-gradient disabled:opacity-40">
                Add
              </button>
              <button onClick={() => setShowAdd(false)} className="btn-soft">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border/60 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              <Plus className="h-3.5 w-3.5 mx-auto" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

export function TaskTemplatesClient({
  initialTemplates,
  teamId,
}: {
  initialTemplates: TaskTemplate[]
  teamId: string | null
}) {
  const [templates, setTemplates] = useState<TaskTemplate[]>(initialTemplates)
  const [showForm, setShowForm]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [isPending, start]        = useTransition()

  function handleCreate() {
    if (!newName.trim()) return
    start(async () => {
      const result = await createTaskTemplate({ name: newName.trim(), teamId: teamId ?? undefined })
      if (!result.error && result.data) {
        setTemplates((prev) => [{
          id: result.data!.id,
          name: newName.trim(),
          description: null,
          team_id: teamId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          items: [],
        }, ...prev])
        setNewName('')
        setShowForm(false)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Create new template */}
      {showForm ? (
        <div className="flex gap-2 rounded-xl border border-ring bg-card p-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false) }}
            placeholder="Template name (e.g. Employee Onboarding)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={handleCreate} disabled={isPending || !newName.trim()} className="btn-gradient disabled:opacity-40">
            Create
          </button>
          <button onClick={() => setShowForm(false)} className="btn-soft">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      )}

      {/* Template list */}
      {templates.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-border bg-card">
          <p className="text-sm font-medium text-muted-foreground">No templates yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a template to bundle reusable task sets for requests.
          </p>
        </div>
      ) : (
        templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            onDeleted={(id) => setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id))}
          />
        ))
      )}
    </div>
  )
}
