'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Archive, Trash2, FileText } from 'lucide-react'
import {
  createFormTemplate,
  updateFormTemplate,
  archiveFormTemplate,
  deleteFormTemplate,
  type FormTemplateInput,
} from '@/lib/actions/admin/form-templates'
import type { FormTemplateSummary } from '@/lib/queries/services'

type ModalMode = { type: 'create' } | { type: 'edit'; template: FormTemplateSummary } | null

// ── Create / Edit modal ─────────────────────────────────────────────────────

function TemplateModal({ mode, onClose }: { mode: Exclude<ModalMode, null>; onClose: () => void }) {
  const isEdit = mode.type === 'edit'
  const existing = isEdit ? mode.template : null

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const data: FormTemplateInput = { name, description }

    startTransition(async () => {
      const result = isEdit
        ? await updateFormTemplate(existing!.id, data)
        : await createFormTemplate(data)

      if (result.error) {
        setError(result.error)
        return
      }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Edit Template' : 'Create Form Template'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Hardware Request Basics"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this template is for"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50">
              {pending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function FormTemplatesAdminClient({ templates }: { templates: FormTemplateSummary[] }) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [archiveTarget, setArchiveTarget] = useState<FormTemplateSummary | null>(null)
  const [archivePending, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FormTemplateSummary | null>(null)
  const [deletePending, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState('')

  function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiveError('')
    startArchive(async () => {
      const result = await archiveFormTemplate(archiveTarget.id)
      if (result.error) {
        setArchiveError(result.error)
      } else {
        setArchiveTarget(null)
      }
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleteError('')
    startDelete(async () => {
      const result = await deleteFormTemplate(deleteTarget.id)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setDeleteTarget(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <button onClick={() => setModal({ type: 'create' })} className="btn-gradient">
          <Plus className="h-4 w-4" />
          Create Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No templates yet. Create one, then tag services to it from Service Catalog.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/form-templates/${t.id}`}
                    className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                  >
                    {t.name}
                  </Link>
                  {t.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Used by {t.service_count} service{t.service_count === 1 ? '' : 's'}
              </p>

              <div className="mt-1 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                <Link
                  href={`/admin/form-templates/${t.id}`}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                >
                  Edit Fields
                </Link>
                <button
                  onClick={() => setModal({ type: 'edit', template: t })}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="h-3 w-3" />
                  Rename
                </button>
                <button
                  onClick={() => setArchiveTarget(t)}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Archive className="h-3 w-3" />
                  Archive
                </button>
                <button
                  onClick={() => setDeleteTarget(t)}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && <TemplateModal mode={modal} onClose={() => setModal(null)} />}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-foreground">Archive &ldquo;{archiveTarget.name}&rdquo;?</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Services still tagged to it keep using it — archiving only hides it from the picker for new tags.
            </p>
            {archiveError && <p className="mt-2 text-xs text-destructive">{archiveError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setArchiveTarget(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleArchiveConfirm}
                disabled={archivePending}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
              >
                {archivePending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-foreground">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">This cannot be undone.</p>
            {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deletePending}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
              >
                {deletePending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
