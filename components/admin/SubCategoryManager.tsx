'use client'

import { useState, useTransition, useId } from 'react'
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  EyeOff,
  Eye,
  Trash2,
} from 'lucide-react'
import { upsertSubCategory, reorderSubCategories, toggleSubCategoryActive, deleteSubCategory } from '@/lib/actions/admin/categories'
import { IconPicker } from './IconPicker'
import { CategoryIcon } from './CategoryIcon'
import { PriorityBadge } from '@/components/requests/RequestBadges'
import type { ServiceSubCategory, RequestPriority } from '@/types'

export const SLA_PRIORITY_OPTIONS: { value: RequestPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

interface SubCategoryManagerProps {
  categoryId: string
  categoryName: string
  initialSubCategories: ServiceSubCategory[]
}

const inputCls =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground'

// ── Inline edit form ──────────────────────────────────────────────────────────

interface EditFormProps {
  categoryId: string
  initial?: ServiceSubCategory
  nextSortOrder: number
  onSave: (sc: ServiceSubCategory) => void
  onCancel: () => void
}

function EditForm({ categoryId, initial, nextSortOrder, onSave, onCancel }: EditFormProps) {
  const nameId = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '')
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(initial?.icon_image_url ?? null)
  const [slaPriority, setSlaPriority] = useState<RequestPriority | ''>(initial?.sla_priority ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!name.trim()) { setError('Name is required.'); return }
    setError(null)

    startTransition(async () => {
      const result = await upsertSubCategory({
        id: initial?.id,
        categoryId,
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon.trim() || undefined,
        iconImageUrl,
        sortOrder: initial?.sort_order ?? nextSortOrder,
        isActive: initial?.is_active ?? true,
        slaPriority: slaPriority || null,
      })

      if (result.error) {
        setError(result.error)
      } else {
        onSave({
          id: result.id ?? initial?.id ?? '',
          category_id: categoryId,
          name: name.trim(),
          slug: initial?.slug ?? '',
          description: description.trim() || null,
          icon: icon.trim() || null,
          icon_image_url: iconImageUrl,
          sort_order: initial?.sort_order ?? nextSortOrder,
          is_active: initial?.is_active ?? true,
          sla_priority: slaPriority || null,
          created_at: initial?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    })
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <IconPicker emoji={icon} onEmojiChange={setIcon} imageUrl={iconImageUrl} onImageChange={setIconImageUrl} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <label htmlFor={nameId} className="block text-xs font-medium text-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Computers & Laptops"
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this sub-category"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-foreground">SLA Priority (optional)</label>
        <p className="text-[11px] text-muted-foreground">
          Auto-sets a ticket&apos;s priority when this sub-category is picked. Actual response/resolution hours come from whichever service&apos;s SLA Policy applies — a sub-category can be tagged by more than one service.
        </p>
        <select
          value={slaPriority}
          onChange={(e) => setSlaPriority(e.target.value as RequestPriority | '')}
          className={inputCls}
        >
          <option value="">None — leave the ticket&apos;s priority as-is</option>
          {SLA_PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="btn-gradient flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? 'Save changes' : 'Add sub-category'}
        </button>
      </div>
    </div>
  )
}

// ── SubCategoryRow ────────────────────────────────────────────────────────────

interface RowProps {
  sc: ServiceSubCategory
  isFirst: boolean
  isLast: boolean
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleActive: () => void
  confirmingDelete: boolean
  deletePending: boolean
  deleteError: string | null
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function SubCategoryRow({
  sc, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onToggleActive,
  confirmingDelete, deletePending, deleteError, onRequestDelete, onConfirmDelete, onCancelDelete,
}: RowProps) {
  return (
    <div
      className={`rounded-xl border ${
        sc.is_active ? 'border-border bg-card' : 'border-border bg-muted/30 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {(sc.icon || sc.icon_image_url) && (
          <CategoryIcon icon={sc.icon} iconImageUrl={sc.icon_image_url} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-lg" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{sc.name}</p>
          {sc.description && (
            <p className="truncate text-xs text-muted-foreground">{sc.description}</p>
          )}
        </div>
        <div className="shrink-0" title="SLA Priority — auto-applied to a ticket's priority when this sub-category is picked">
          {sc.sla_priority ? (
            <PriorityBadge priority={sc.sla_priority} size="sm" />
          ) : (
            <span className="text-xs text-muted-foreground">–</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted"
            title={sc.is_active ? 'Deactivate' : 'Activate'}
          >
            {sc.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="ml-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-xs text-foreground">
            Permanently delete <strong>{sc.name}</strong>? This cannot be undone. Services tagged with it will lose the tag but are not deleted.
          </p>
          {deleteError && <p className="mt-1 text-xs text-destructive">{deleteError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={deletePending}
              className="btn-danger rounded-lg px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {deletePending ? 'Deleting…' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SubCategoryManager ────────────────────────────────────────────────────────

export function SubCategoryManager({
  categoryId,
  categoryName,
  initialSubCategories,
}: SubCategoryManagerProps) {
  const [subCategories, setSubCategories] = useState<ServiceSubCategory[]>(
    [...initialSubCategories].sort((a, b) => a.sort_order - b.sort_order)
  )
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [, startTransition] = useTransition()
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletePending, startDelete] = useTransition()

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  function handleSave(sc: ServiceSubCategory) {
    setSubCategories((prev) => {
      const idx = prev.findIndex((s) => s.id === sc.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = sc
        return next
      }
      return [...prev, sc]
    })
    setEditingId(null)
    showToast('success', editingId === 'new' ? 'Sub-category added.' : 'Sub-category updated.')
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= subCategories.length) return
    const next = [...subCategories]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSubCategories(next)

    // Persist order
    startTransition(async () => {
      const result = await reorderSubCategories(categoryId, next.map((s) => s.id))
      if (result.error) showToast('error', result.error)
    })
  }

  function handleToggleActive(id: string) {
    const sc = subCategories.find((s) => s.id === id)
    if (!sc) return
    const newActive = !sc.is_active

    setSubCategories((prev) => prev.map((s) => s.id === id ? { ...s, is_active: newActive } : s))

    startTransition(async () => {
      const result = await toggleSubCategoryActive(id, newActive)
      if (result.error) {
        showToast('error', result.error)
        // Revert
        setSubCategories((prev) => prev.map((s) => s.id === id ? { ...s, is_active: !newActive } : s))
      }
    })
  }

  function handleConfirmDelete() {
    if (!confirmingDeleteId) return
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteSubCategory(confirmingDeleteId, categoryId)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setSubCategories((prev) => prev.filter((s) => s.id !== confirmingDeleteId))
        setConfirmingDeleteId(null)
        showToast('success', 'Sub-category deleted.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Sub-category list */}
      {subCategories.length === 0 && editingId !== 'new' && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm font-medium text-foreground">No sub-categories yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add sub-categories to organise services within {categoryName}.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {subCategories.map((sc, i) =>
          editingId === sc.id ? (
            <EditForm
              key={sc.id}
              categoryId={categoryId}
              initial={sc}
              nextSortOrder={subCategories.length}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <SubCategoryRow
              key={sc.id}
              sc={sc}
              isFirst={i === 0}
              isLast={i === subCategories.length - 1}
              onEdit={() => setEditingId(sc.id)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onToggleActive={() => handleToggleActive(sc.id)}
              confirmingDelete={confirmingDeleteId === sc.id}
              deletePending={deletePending}
              deleteError={confirmingDeleteId === sc.id ? deleteError : null}
              onRequestDelete={() => { setConfirmingDeleteId(sc.id); setDeleteError(null) }}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={() => { setConfirmingDeleteId(null); setDeleteError(null) }}
            />
          )
        )}

        {editingId === 'new' && (
          <EditForm
            categoryId={categoryId}
            nextSortOrder={subCategories.length}
            onSave={handleSave}
            onCancel={() => setEditingId(null)}
          />
        )}
      </div>

      {/* Add button */}
      {editingId !== 'new' && (
        <button
          type="button"
          onClick={() => setEditingId('new')}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add sub-category
        </button>
      )}
    </div>
  )
}
