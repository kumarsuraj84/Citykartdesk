'use client'

import { useState, useTransition } from 'react'
import { ChevronRight, ChevronDown, Plus, Pencil, Power, Trash2, Check, X } from 'lucide-react'
import {
  createCategory,
  updateCategory,
  toggleCategoryActive,
  deleteCategory,
  upsertSubCategory,
} from '@/lib/actions/admin/categories'
import { IconPicker } from '@/components/admin/IconPicker'
import { CategoryIcon } from '@/components/admin/CategoryIcon'
import { SubCategoryManager, SLA_PRIORITY_OPTIONS } from '@/components/admin/SubCategoryManager'
import type { ServiceCategoryWithSubCategories, RequestPriority } from '@/types'

// ── Global "+ New Category" ──────────────────────────────────────────────────
// Deliberately a standalone mini-form here (not shared with CategoriesAdminClient's
// CreateCategoryForm) to avoid a circular import between the two client files.

function NewCategoryForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const result = await createCategory({ name, description, icon, icon_image_url: iconImageUrl })
      if (result.error) setError(result.error)
      else onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex gap-3">
        <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. HR"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
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
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-soft">Cancel</button>
        <button type="submit" disabled={pending} className="btn-gradient text-white disabled:opacity-60">
          {pending ? 'Creating…' : 'Create Category'}
        </button>
      </div>
    </form>
  )
}

// ── Global "+ New Sub-Category" ──────────────────────────────────────────────
// The concrete answer to "creating a sub-category from outside a category
// should ask which category" — an explicit Category select up front, rather
// than only ever being creatable from inside that category's own page.

function NewSubCategoryForm({
  categories,
  onDone,
}: {
  categories: ServiceCategoryWithSubCategories[]
  onDone: () => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(null)
  const [slaPriority, setSlaPriority] = useState<RequestPriority | ''>('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) { setError('Pick a category.'); return }
    setError('')
    const cat = categories.find((c) => c.id === categoryId)
    startTransition(async () => {
      const result = await upsertSubCategory({
        categoryId,
        name,
        description: description || undefined,
        icon: icon || undefined,
        iconImageUrl,
        sortOrder: cat?.sub_categories.length ?? 0,
        isActive: true,
        slaPriority: slaPriority || null,
      })
      if (result.error) setError(result.error)
      else onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Category <span className="text-destructive">*</span>
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">Select a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-3">
        <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Laptop Issue"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description (optional)"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">SLA Priority (optional)</label>
        <select
          value={slaPriority}
          onChange={(e) => setSlaPriority(e.target.value as RequestPriority | '')}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">None — leave the ticket&apos;s priority as-is</option>
          {SLA_PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-soft">Cancel</button>
        <button type="submit" disabled={pending} className="btn-gradient text-white disabled:opacity-60">
          {pending ? 'Adding…' : 'Add Sub-Category'}
        </button>
      </div>
    </form>
  )
}

// ── Category node (expand → full SubCategoryManager for that category) ──────

function CategoryNode({ cat, defaultExpanded }: { cat: ServiceCategoryWithSubCategories; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  const [icon, setIcon] = useState(cat.icon ?? '')
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(cat.icon_image_url ?? null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [togglePending, startToggle] = useTransition()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deletePending, startDelete] = useTransition()

  function handleSave() {
    setError('')
    startTransition(async () => {
      const result = await updateCategory(cat.id, { name, icon, icon_image_url: iconImageUrl })
      if (result.error) setError(result.error)
      else setEditing(false)
    })
  }

  function handleCancel() {
    setName(cat.name)
    setIcon(cat.icon ?? '')
    setIconImageUrl(cat.icon_image_url ?? null)
    setError('')
    setEditing(false)
  }

  function handleToggle() {
    startToggle(async () => { await toggleCategoryActive(cat.id, !cat.is_active) })
  }

  function handleDeleteConfirm() {
    setDeleteError('')
    startDelete(async () => {
      const result = await deleteCategory(cat.id)
      if (result.error) setDeleteError(result.error)
      else setConfirmingDelete(false)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {editing ? (
          <>
            <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel() }}
              />
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={handleSave} disabled={pending} className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleCancel} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-muted">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </>
        ) : (
          <>
            <CategoryIcon
              icon={cat.icon}
              iconImageUrl={cat.icon_image_url}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base"
            />
            <button type="button" onClick={() => setExpanded((v) => !v)} className="min-w-0 flex-1 text-left">
              <span className="font-medium text-foreground">{cat.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {cat.sub_categories.length} sub-categor{cat.sub_categories.length !== 1 ? 'ies' : 'y'}
              </span>
              {!cat.is_active && (
                <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Inactive</span>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => setEditing(true)} title="Rename" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleToggle} disabled={togglePending} title={cat.is_active ? 'Deactivate' : 'Activate'} className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
                <Power className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setConfirmingDelete(true)} title="Delete" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {confirmingDelete && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-xs text-foreground">
            Permanently delete <strong>{cat.name}</strong>? This cannot be undone. Deletion will be blocked while any service is still tagged to one of its sub-categories.
          </p>
          {deleteError && <p className="mt-1 text-xs text-destructive">{deleteError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setConfirmingDelete(false); setDeleteError('') }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">
              Cancel
            </button>
            <button onClick={handleDeleteConfirm} disabled={deletePending} className="btn-danger rounded-lg px-3 py-1.5 text-xs disabled:opacity-60">
              {deletePending ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border p-3">
          {/* Keyed on the sub-category count so a global "+ New Sub-Category"
              add (which mutates this category from outside this component's
              own state) forces a remount with fresh data — SubCategoryManager's
              internal list state otherwise only ever seeds from its initial
              props once and won't pick up an externally-added row. */}
          <SubCategoryManager
            key={cat.sub_categories.length}
            categoryId={cat.id}
            categoryName={cat.name}
            initialSubCategories={cat.sub_categories}
          />
        </div>
      )}
    </div>
  )
}

// ── Main tree view ────────────────────────────────────────────────────────────

export default function CategoryTreeView({ categories }: { categories: ServiceCategoryWithSubCategories[] }) {
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [creatingSubCategory, setCreatingSubCategory] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Expand a category to browse, edit, or add its sub-categories in place.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setCreatingSubCategory(true)} className="btn-soft">
            <Plus className="h-3.5 w-3.5" />
            New Sub-Category
          </button>
          <button onClick={() => setCreatingCategory(true)} className="btn-gradient text-white">
            <Plus className="h-4 w-4" />
            New Category
          </button>
        </div>
      </div>

      {creatingCategory && <NewCategoryForm onDone={() => setCreatingCategory(false)} />}
      {creatingSubCategory && <NewSubCategoryForm categories={categories} onDone={() => setCreatingSubCategory(false)} />}

      {categories.length === 0 && !creatingCategory ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No categories yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat, i) => (
            <CategoryNode key={cat.id} cat={cat} defaultExpanded={i === 0} />
          ))}
        </div>
      )}
    </div>
  )
}
