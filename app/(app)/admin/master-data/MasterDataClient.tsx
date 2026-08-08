'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { createTag, updateTag, deleteTag, updateRequestPriority } from '@/lib/actions/admin/config'
import { Trash2, Plus, ChevronUp, ChevronDown, ExternalLink, Check, X } from 'lucide-react'

type Tag = {
  id: string
  name: string
  color: string
  is_active: boolean
  created_at: string
}

type RequestPriority = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  sla_multiplier: number
  is_active: boolean
}

type Tab = 'tags' | 'priorities' | 'task-statuses' | 'task-priorities'

interface Props {
  tags: Tag[]
  requestPriorities: RequestPriority[]
}

function ColorSwatch({ color, onChange, onBlur }: { color: string; onChange: (c: string) => void; onBlur?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="h-7 w-7 cursor-pointer rounded border border-gray-200 p-0.5"
      />
      <span className="font-mono text-xs text-gray-500">{color}</span>
    </div>
  )
}

function TagsTab({ tags }: { tags: Tag[] }) {
  const [items, setItems] = useState<Tag[]>(tags)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    if (!newName.trim()) return
    setError('')
    startTransition(async () => {
      const res = await createTag({ name: newName.trim(), color: newColor })
      if (res.error) { setError(res.error); return }
      // Optimistic: add temp item, page will revalidate
      setItems((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: newName.trim(), color: newColor, is_active: true, created_at: new Date().toISOString() },
      ])
      setNewName('')
      setNewColor('#6b7280')
    })
  }

  function handleColorChange(id: string, color: string) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)))
  }

  function handleToggleActive(tag: Tag) {
    const next = !tag.is_active
    setItems((prev) => prev.map((t) => (t.id === tag.id ? { ...t, is_active: next } : t)))
    startTransition(async () => {
      const res = await updateTag(tag.id, { is_active: next })
      if (res.error) {
        setItems((prev) => prev.map((t) => (t.id === tag.id ? { ...t, is_active: tag.is_active } : t)))
      }
    })
  }

  function handleColorBlur(tag: Tag, color: string) {
    startTransition(async () => {
      await updateTag(tag.id, { color })
    })
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this tag? This cannot be undone.')) return
    setItems((prev) => prev.filter((t) => t.id !== id))
    startTransition(async () => {
      const res = await deleteTag(id)
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="space-y-4">
      {/* Preview chips */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-100 bg-gray-50 p-4">
        {items.filter((t) => t.is_active).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
        {items.filter((t) => t.is_active).length === 0 && (
          <span className="text-sm text-gray-400">No active tags</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Color</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((tag) => (
              <tr key={tag.id} className={cn('bg-white transition-colors hover:bg-gray-50', !tag.is_active && 'opacity-50')}>
                <td className="px-4 py-3 font-medium text-gray-800">{tag.name}</td>
                <td className="px-4 py-3">
                  <ColorSwatch
                    color={tag.color}
                    onChange={(c) => handleColorChange(tag.id, c)}
                    onBlur={() => handleColorBlur(tag, tag.color)}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => handleToggleActive(tag)}
                    className={cn(
                      'inline-flex h-6 w-11 items-center rounded-full transition-colors',
                      tag.is_active ? 'bg-blue-600' : 'bg-gray-200'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform',
                        tag.is_active && 'translate-x-6'
                      )}
                    />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(tag.id)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Delete tag"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add inline */}
      <div className="flex items-end gap-3 rounded-lg border border-dashed border-gray-300 bg-white p-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">Tag Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="e.g. Network"
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Color</label>
          <ColorSwatch color={newColor} onChange={setNewColor} />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newName.trim() || isPending}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Tag
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}

function PrioritiesTab({ priorities }: { priorities: RequestPriority[] }) {
  const [items, setItems] = useState<RequestPriority[]>(priorities)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<RequestPriority>>({})
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function startEdit(p: RequestPriority) {
    setEditingId(p.id)
    setEditValues({ name: p.name, color: p.color, sla_multiplier: p.sla_multiplier, is_active: p.is_active })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValues({})
  }

  function saveEdit(id: string) {
    setError('')
    const current = items.find((p) => p.id === id)
    if (!current) return
    const update = {
      name: editValues.name ?? current.name,
      color: editValues.color ?? current.color,
      sla_multiplier: editValues.sla_multiplier ?? current.sla_multiplier,
      is_active: editValues.is_active ?? current.is_active,
    }
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...update } : p))
    )
    setEditingId(null)
    startTransition(async () => {
      const res = await updateRequestPriority(id, update)
      if (res.error) setError(res.error)
    })
  }

  function moveOrder(id: string, dir: 'up' | 'down') {
    const idx = items.findIndex((p) => p.id === id)
    if (dir === 'up' && idx === 0) return
    if (dir === 'down' && idx === items.length - 1) return
    const next = [...items]
    const swap = dir === 'up' ? idx - 1 : idx + 1
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    // reassign display_order
    const reordered = next.map((p, i) => ({ ...p, display_order: i }))
    setItems(reordered)
    startTransition(async () => {
      await Promise.all(
        reordered.map((p) => updateRequestPriority(p.id, { display_order: p.display_order }))
      )
    })
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left w-16">Order</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Value</th>
              <th className="px-4 py-3 text-left">Color</th>
              <th className="px-4 py-3 text-left">SLA Multiplier</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((p, idx) => {
              const isEditing = editingId === p.id
              return (
                <tr key={p.id} className={cn('bg-white transition-colors hover:bg-gray-50', !p.is_active && 'opacity-50')}>
                  {/* Order */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveOrder(p.id, 'up')}
                        disabled={idx === 0 || isPending}
                        className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-20"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveOrder(p.id, 'down')}
                        disabled={idx === items.length - 1 || isPending}
                        className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-20"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  {/* Name */}
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {isEditing ? (
                      <input
                        value={editValues.name ?? ''}
                        onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))}
                        className="w-full rounded border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </span>
                    )}
                  </td>
                  {/* Value (read-only) */}
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{p.value}</span>
                  </td>
                  {/* Color */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <ColorSwatch
                        color={editValues.color ?? p.color}
                        onChange={(c) => setEditValues((v) => ({ ...v, color: c }))}
                      />
                    ) : (
                      <span className="font-mono text-xs text-gray-500">{p.color}</span>
                    )}
                  </td>
                  {/* SLA Multiplier */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={editValues.sla_multiplier ?? p.sla_multiplier}
                        onChange={(e) => setEditValues((v) => ({ ...v, sla_multiplier: parseFloat(e.target.value) }))}
                        className="w-24 rounded border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="text-gray-700">{p.sla_multiplier}x</span>
                    )}
                  </td>
                  {/* Active */}
                  <td className="px-4 py-3 text-center">
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={editValues.is_active ?? p.is_active}
                        onChange={(e) => setEditValues((v) => ({ ...v, is_active: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                    ) : (
                      <span className={cn('inline-block h-2 w-2 rounded-full', p.is_active ? 'bg-green-400' : 'bg-gray-300')} />
                    )}
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => saveEdit(p.id)}
                          className="rounded p-1 text-green-600 hover:bg-green-50"
                          title="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(p)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        SLA multiplier scales the base resolution time. 0.25x = 4x faster (critical), 2.00x = 2x slower (low).
        The <span className="font-mono">value</span> field is read-only as it maps to request data.
      </p>
    </div>
  )
}

function ReferenceTab({ label, href }: { label: string; href: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16">
      <p className="text-sm text-gray-500">
        {label} are managed in their dedicated configuration page.
      </p>
      <a
        href={href}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        Go to {label} Config
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'priorities', label: 'Request Priorities' },
  { id: 'task-statuses', label: 'Task Statuses' },
  { id: 'task-priorities', label: 'Task Priorities' },
]

export function MasterDataClient({ tags, requestPriorities }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('tags')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Master Data</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage global reference data used across Citykart Desk — tags, priorities, and classification values.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'tags' && <TagsTab tags={tags} />}
      {activeTab === 'priorities' && <PrioritiesTab priorities={requestPriorities} />}
      {activeTab === 'task-statuses' && (
        <ReferenceTab label="Task Statuses" href="/admin/task-config" />
      )}
      {activeTab === 'task-priorities' && (
        <ReferenceTab label="Task Priorities" href="/admin/task-config" />
      )}
    </div>
  )
}
