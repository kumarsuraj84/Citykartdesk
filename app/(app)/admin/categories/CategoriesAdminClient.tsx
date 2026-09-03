'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Check, X, Layers, Power, Trash2, LayoutGrid, GitBranch, Download } from 'lucide-react'
import {
  createCategory,
  updateCategory,
  toggleCategoryActive,
  deleteCategory,
} from '@/lib/actions/admin/categories'
import { IconPicker } from '@/components/admin/IconPicker'
import { CategoryIcon } from '@/components/admin/CategoryIcon'
import { BulkImportCategoriesDialog } from '@/components/admin/BulkImportCategoriesDialog'
import CategoryTreeView from './CategoryTreeView'
import { toCSV, downloadCSV } from '@/lib/export/csv'
import type { ServiceCategoryWithSubCategories } from '@/types'

// Mirrors the bulk-import column shape (one row per sub-category) so an
// export can be edited and re-imported without reshaping it first.
const EXPORT_COLUMNS = [
  { key: 'category_name', label: 'category_name' },
  { key: 'category_description', label: 'category_description' },
  { key: 'category_icon', label: 'category_icon' },
  { key: 'sub_category_name', label: 'sub_category_name' },
  { key: 'sub_category_description', label: 'sub_category_description' },
  { key: 'sub_category_icon', label: 'sub_category_icon' },
  { key: 'sla_priority', label: 'sla_priority' },
]

function exportCategoriesToCSV(categories: ServiceCategoryWithSubCategories[]) {
  const rows = categories.flatMap((cat) =>
    cat.sub_categories.length > 0
      ? cat.sub_categories.map((sc) => ({
          category_name: cat.name,
          category_description: cat.description ?? '',
          category_icon: cat.icon ?? '',
          sub_category_name: sc.name,
          sub_category_description: sc.description ?? '',
          sub_category_icon: sc.icon ?? '',
          sla_priority: sc.sla_priority ?? '',
        }))
      // A category with no sub-categories yet still gets one row, so it isn't silently dropped from the export.
      : [{
          category_name: cat.name,
          category_description: cat.description ?? '',
          category_icon: cat.icon ?? '',
          sub_category_name: '',
          sub_category_description: '',
          sub_category_icon: '',
          sla_priority: '',
        }]
  )
  downloadCSV('categories-export.csv', toCSV(rows, EXPORT_COLUMNS))
}

// ── Inline edit for category name/icon ───────────────────────────────────────

function InlineEditRow({ cat }: { cat: ServiceCategoryWithSubCategories }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  const [description, setDescription] = useState(cat.description ?? '')
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
      const result = await updateCategory(cat.id, { name, description, icon, icon_image_url: iconImageUrl })
      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
      }
    })
  }

  function handleCancel() {
    setName(cat.name)
    setDescription(cat.description ?? '')
    setIcon(cat.icon ?? '')
    setIconImageUrl(cat.icon_image_url ?? null)
    setError('')
    setEditing(false)
  }

  function handleToggle() {
    startToggle(async () => {
      await toggleCategoryActive(cat.id, !cat.is_active)
    })
  }

  function handleDeleteConfirm() {
    setDeleteError('')
    startDelete(async () => {
      const result = await deleteCategory(cat.id)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setConfirmingDelete(false)
      }
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/* Category header row */}
      <div className="flex items-start gap-4 px-4 py-3">
        {editing ? (
          <>
            <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
            <div className="min-w-0 flex-1 space-y-2">
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
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description (optional)"
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') handleCancel()
                }}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
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
            <CategoryIcon
              icon={cat.icon}
              iconImageUrl={cat.icon_image_url}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{cat.name}</p>
              {cat.description && (
                <p className="text-xs text-muted-foreground">{cat.description}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {cat.sub_categories.length} sub-categor{cat.sub_categories.length !== 1 ? 'ies' : 'y'}
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
              <button
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
              >
                <Trash2 className="h-3 w-3" />
                Delete
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

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-foreground">
            Permanently delete <strong>{cat.name}</strong>? This cannot be undone.
            Deletion will be blocked while any service is still tagged to one of its sub-categories — untag them first.
          </p>
          {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => { setConfirmingDelete(false); setDeleteError('') }}
              className="btn-soft"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              disabled={deletePending}
              className="btn-danger disabled:opacity-60"
            >
              {deletePending ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      )}

      {/* Sub-category list — capped height + scroll so a category with many
          (40+) sub-categories doesn't push the rest of the page down. */}
      {cat.sub_categories.length > 0 && (
        <div className="border-t border-border px-4 pb-3 pt-2.5">
          <div className="max-h-64 overflow-y-auto pr-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 content-start">
            {cat.sub_categories.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                {(sc.icon || sc.icon_image_url) && (
                  <CategoryIcon icon={sc.icon} iconImageUrl={sc.icon_image_url} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{sc.name}</p>
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
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const result = await createCategory({ name, description, icon, icon_image_url: iconImageUrl })
      if (result.error) {
        setError(result.error)
      } else {
        onDone()
      }
    })
  }

  return (
    <div className="rounded-2xl border border-primary/40 bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">New Category</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-4 py-3">
        <div className="flex gap-3">
          <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
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
  const [view, setView] = useState<'cards' | 'tree'>('cards')

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button
            onClick={() => setView('cards')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
          <button
            onClick={() => setView('tree')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'tree' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Tree View
          </button>
        </div>
        {view === 'cards' && !creating && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCategoriesToCSV(categories)}
              disabled={categories.length === 0}
              className="btn-glossy-light btn-glossy-light-hover disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <BulkImportCategoriesDialog />
            <button
              onClick={() => setCreating(true)}
              className="btn-gradient text-white"
            >
              <Plus className="h-4 w-4" />
              New Category
            </button>
          </div>
        )}
      </div>

      {view === 'tree' ? (
        <CategoryTreeView categories={categories} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Click <strong>Edit</strong> on any category to rename it or change its icon inline.
          </p>

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
        </>
      )}
    </div>
  )
}
