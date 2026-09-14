'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { updateRequestPriority } from '@/lib/actions/admin/config'
import { ChevronUp, ChevronDown, ExternalLink, Check, X } from 'lucide-react'

type RequestPriority = {
  id: string
  name: string
  value: string
  color: string
  display_order: number
  sla_multiplier: number
  is_active: boolean
}

type Tab = 'priorities' | 'task-statuses' | 'task-priorities'

interface Props {
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
  { id: 'priorities', label: 'Request Priorities' },
  { id: 'task-statuses', label: 'Task Statuses' },
  { id: 'task-priorities', label: 'Task Priorities' },
]

export function MasterDataClient({ requestPriorities }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('priorities')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Master Data</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage global reference data used across Citykart Desk — priorities and classification values.
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
