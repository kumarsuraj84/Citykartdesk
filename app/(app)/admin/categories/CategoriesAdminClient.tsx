'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Check, X, Layers, Power } from 'lucide-react'
import {
  createCategory,
  updateCategory,
  toggleCategoryActive,
} from '@/lib/actions/admin/categories'
import type { ServiceCategoryWithSubCategories } from '@/types'

// ── Inline edit for category name/icon ───────────────────────────────────────

function InlineEditRow({ cat }: { cat: ServiceCategoryWithSubCategories }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  const [icon, setIcon] = useState(cat.icon ?? '')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [togglePending, startToggle] = useTransition()

  function handleSave() {
    setError('')
    startTransition(async () => {
      const result = await updateCategory(cat.id, { name, icon })
      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
      }
    })
  }

  function handleCancel() {
    setName(cat.name)
    setIcon(cat.icon ?? '')
    setError('')
    setEditing(false)
  }

  function handleToggle() {
    startToggle(async () => {
      await toggleCategoryActive(cat.id, !cat.is_active)
    })
  }

  const totalServices = cat.sub_categories.reduce((acc, sc) => acc + sc.services.length, 0)

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/* Category header row */}
      <div className="flex items-center gap-4 px-5 py-4">
        {editing ? (
          <>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              placeholder="📋"
              className="w-12 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') handleCancel()
                }}
              />
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={handleSave}
                disabled={pending}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleCancel}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
              {cat.icon ?? '📋'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{cat.name}</p>
              {cat.description && (
                <p className="text-xs text-muted-foreground">{cat.description}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cat.sub_categories.length} sub-categor{cat.sub_categories.length !== 1 ? 'ies' : 'y'}{' '}
                · {totalServices} service{totalServices !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!cat.is_active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Inactive
                </span>
              )}
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                onClick={handleToggle}
                disabled={togglePending}
                title={cat.is_active ? 'Deactivate' : 'Activate'}
                className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  cat.is_active
                    ? 'border-border text-muted-foreground hover:bg-muted'
                    : 'border-green-500/40 text-green-600 hover:bg-green-500/10 dark:text-green-400'
                }`}
              >
                <Power className="h-3 w-3" />
                {cat.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <Link
                href={`/admin/categories/${cat.slug}`}
                className="btn-gradient text-white"
              >
                <Layers className="h-3.5 w-3.5" />
                Manage
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Sub-category list */}
      {cat.sub_categories.length > 0 && (
        <div className="border-t border-border px-5 pb-4 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cat.sub_categories.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                {sc.icon && <span className="text-sm">{sc.icon}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{sc.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {sc.services.length} service{sc.services.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {!sc.is_active && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    Inactive
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create category inline form ───────────────────────────────────────────────

function CreateCategoryForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const result = await createCategory({ name, description, icon })
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
      }
    })
  }

  return (
    <div className="rounded-2xl border border-primary/40 bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <p className="text-sm font-semibold text-foreground">New Category</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-4">
        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Icon</label>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="📁"
              maxLength={4}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Human Resources"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="btn-gradient text-white disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create Category'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function CategoriesAdminClient({
  categories,
}: {
  categories: ServiceCategoryWithSubCategories[]
}) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Click <strong>Edit</strong> on any category to rename it or change its icon inline.
        </p>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="btn-gradient text-white"
          >
            <Plus className="h-4 w-4" />
            New Category
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && <CreateCategoryForm onDone={() => setCreating(false)} />}

      {/* Category list */}
      {categories.length === 0 && !creating ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No categories yet. Create one above.</p>
        </div>
      ) : (
        categories.map((cat) => <InlineEditRow key={cat.id} cat={cat} />)
      )}
    </div>
  )
}
