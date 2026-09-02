'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Archive, Trash2, Timer } from 'lucide-react'
import {
  createSlaPolicy,
  updateSlaPolicy,
  archiveSlaPolicy,
  deleteSlaPolicy,
  type SlaPolicyInput,
} from '@/lib/actions/admin/sla-policies'
import { SLA_PRIORITIES, slaConfigToDraft, draftToSlaConfig, type SlaDraft } from '@/lib/forms/sla-draft'
import type { SlaPolicySummary } from '@/lib/queries/services'

type ModalMode = { type: 'create' } | { type: 'edit'; policy: SlaPolicySummary } | null

// ── Create / Edit modal ─────────────────────────────────────────────────────

function PolicyModal({ mode, onClose }: { mode: Exclude<ModalMode, null>; onClose: () => void }) {
  const isEdit = mode.type === 'edit'
  const existing = isEdit ? mode.policy : null

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [slaDraft, setSlaDraft] = useState<SlaDraft>(() => slaConfigToDraft(existing?.config))
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const data: SlaPolicyInput = { name, description, config: draftToSlaConfig(slaDraft) }

    startTransition(async () => {
      const result = isEdit
        ? await updateSlaPolicy(existing!.id, data)
        : await createSlaPolicy(data)

      if (result.error) {
        setError(result.error)
        return
      }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="border-b border-border px-4 py-3 sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Edit SLA Policy' : 'Create SLA Policy'}
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
              placeholder="e.g. IT SLA"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this policy is for"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response / Resolution Targets</p>
            <div className="space-y-2">
              {SLA_PRIORITIES.map((p) => (
                <div key={p} className="grid grid-cols-[70px_1fr_1fr] items-center gap-2">
                  <span className="text-xs font-medium capitalize text-foreground">{p}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={slaDraft[p].response}
                    onChange={(e) => setSlaDraft((prev) => ({ ...prev, [p]: { ...prev[p], response: e.target.value } }))}
                    placeholder="Response (h)"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={slaDraft[p].resolution}
                    onChange={(e) => setSlaDraft((prev) => ({ ...prev, [p]: { ...prev[p], resolution: e.target.value } }))}
                    placeholder="Resolution (h)"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              ))}
            </div>
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

export default function SlaPoliciesAdminClient({ policies }: { policies: SlaPolicySummary[] }) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [archiveTarget, setArchiveTarget] = useState<SlaPolicySummary | null>(null)
  const [archivePending, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SlaPolicySummary | null>(null)
  const [deletePending, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState('')

  function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiveError('')
    startArchive(async () => {
      const result = await archiveSlaPolicy(archiveTarget.id)
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
      const result = await deleteSlaPolicy(deleteTarget.id)
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
          Create SLA Policy
        </button>
      </div>

      {policies.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No SLA policies yet. Create one, then map it to a service from Service Catalog.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {policies.map((p) => {
            const tiers = (['urgent', 'high', 'medium', 'low'] as const).filter((t) => p.config?.[t])
            return (
              <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Timer className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    )}
                  </div>
                </div>

                {tiers.length > 0 ? (
                  <div className="space-y-0.5 text-[11px] text-muted-foreground">
                    {tiers.map((t) => (
                      <p key={t} className="capitalize">
                        {t}: {p.config[t]?.response_hours ?? '—'}h / {p.config[t]?.resolution_hours ?? '—'}h
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] italic text-muted-foreground/60">No tiers configured yet</p>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Mapped to {p.service_count} service{p.service_count === 1 ? '' : 's'}
                </p>

                <div className="mt-1 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
                  <button
                    onClick={() => setModal({ type: 'edit', policy: p })}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => setArchiveTarget(p)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </button>
                  <button
                    onClick={() => setDeleteTarget(p)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && <PolicyModal mode={modal} onClose={() => setModal(null)} />}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-foreground">Archive &ldquo;{archiveTarget.name}&rdquo;?</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Services still mapped to it keep using it — archiving only hides it from the picker for new mappings.
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
