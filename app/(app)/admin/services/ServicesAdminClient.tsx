'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Archive, Settings2, Tag } from 'lucide-react'
import {
  createService,
  updateService,
  archiveService,
  type ServiceInput,
} from '@/lib/actions/admin/services'
import type { ServiceCategoryWithSubCategories, ServiceWithRelations, Team, Profile } from '@/types'
import type { ServiceSubCategory } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileMini = Pick<Profile, 'id' | 'full_name'>

type Props = {
  categories: ServiceCategoryWithSubCategories[]
  teams: Team[]
  profiles: ProfileMini[]
}

type ModalMode =
  | { type: 'create' }
  | { type: 'edit'; service: ServiceWithRelations }
  | null

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

type ServiceStatus = 'draft' | 'review' | 'published' | 'retired'
type ServiceVisibility = 'all' | 'agents_only' | 'managers_only'

const STATUS_OPTIONS: { value: ServiceStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'Under Review' },
  { value: 'published', label: 'Published' },
  { value: 'retired', label: 'Retired' },
]

const VISIBILITY_OPTIONS: { value: ServiceVisibility; label: string }[] = [
  { value: 'all', label: 'All Users' },
  { value: 'agents_only', label: 'Agents Only' },
  { value: 'managers_only', label: 'Managers Only' },
]

const STATUS_BADGE: Record<ServiceStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  review: { label: 'Review', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  published: { label: 'Published', className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  retired: { label: 'Retired', className: 'bg-destructive/10 text-destructive' },
}

// ── Service modal ─────────────────────────────────────────────────────────────

function ServiceModal({
  mode,
  categories,
  teams,
  profiles,
  onClose,
}: {
  mode: Exclude<ModalMode, null>
  categories: ServiceCategoryWithSubCategories[]
  teams: Team[]
  profiles: ProfileMini[]
  onClose: () => void
}) {
  const isEdit = mode.type === 'edit'
  const existing = isEdit ? mode.service : null
  const existingAny = existing as (ServiceWithRelations & { status?: string; owner_id?: string | null; backup_owner_id?: string | null; version?: string; visibility?: string }) | null

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  const [categoryId, setCategoryId] = useState(existing?.category_id ?? '')
  const [subCategoryId, setSubCategoryId] = useState(existing?.sub_category_id ?? '')
  const [teamId, setTeamId] = useState(existing?.team_id ?? '')
  const [priority, setPriority] = useState<ServiceInput['default_priority']>(
    existing?.default_priority ?? 'medium'
  )
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [status, setStatus] = useState<ServiceStatus>((existingAny?.status as ServiceStatus) ?? 'published')
  const [ownerId, setOwnerId] = useState(existingAny?.owner_id ?? '')
  const [backupOwnerId, setBackupOwnerId] = useState(existingAny?.backup_owner_id ?? '')
  const [version, setVersion] = useState(existingAny?.version ?? '1.0')
  const [visibility, setVisibility] = useState<ServiceVisibility>((existingAny?.visibility as ServiceVisibility) ?? 'all')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  // Derive sub-categories for selected category
  const selectedCat = categories.find((c) => c.id === categoryId)
  const subCategories: ServiceSubCategory[] = selectedCat
    ? (selectedCat.sub_categories as ServiceSubCategory[])
    : []

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const data: ServiceInput = {
      name,
      description,
      icon,
      category_id: categoryId,
      sub_category_id: subCategoryId || undefined,
      team_id: teamId,
      default_priority: priority,
      is_active: isActive,
      status,
      owner_id: ownerId || null,
      backup_owner_id: backupOwnerId || null,
      version: version.trim() || '1.0',
      visibility,
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateService(existing!.id, data)
        : await createService(data)

      if (result.error) {
        setError(result.error)
      } else {
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="border-b border-border px-5 py-4 sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Edit Service' : 'Create Service'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {/* Name + Icon row */}
          <div className="flex gap-3">
            <div className="w-20 shrink-0">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Icon</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="📋"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                maxLength={4}
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
                placeholder="e.g. Laptop Replacement"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short description shown in the catalog"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Category + Sub-category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Category <span className="text-destructive">*</span>
              </label>
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId('') }}
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Sub-category</label>
              <select
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                disabled={!categoryId}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              >
                <option value="">None</option>
                {subCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>{sc.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Team + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Team <span className="text-destructive">*</span>
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Default Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as ServiceInput['default_priority'])}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Governance section divider */}
          <div className="border-t border-border pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Governance</p>

            {/* Status + Version */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ServiceStatus)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Version</label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            {/* Visibility */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as ServiceVisibility)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {VISIBILITY_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>

            {/* Owner + Backup Owner */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Owner</label>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Backup Owner</label>
                <select
                  value={backupOwnerId}
                  onChange={(e) => setBackupOwnerId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Active toggle */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm text-foreground">Active (visible in catalog)</span>
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-soft"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn-gradient disabled:opacity-60"
            >
              {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Service row ───────────────────────────────────────────────────────────────

function ServiceRow({
  service,
  profiles,
  onEdit,
  onArchive,
}: {
  service: ServiceWithRelations
  profiles: ProfileMini[]
  onEdit: (s: ServiceWithRelations) => void
  onArchive: (s: ServiceWithRelations) => void
}) {
  const svcAny = service as ServiceWithRelations & { status?: string; owner_id?: string | null; version?: string }
  const govStatus = (svcAny.status ?? 'published') as ServiceStatus
  const badge = STATUS_BADGE[govStatus] ?? STATUS_BADGE.published
  const owner = profiles.find((p) => p.id === svcAny.owner_id)

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-sm">
      {/* Icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
        {service.icon ?? '📋'}
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{service.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {service.category && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Tag className="h-2.5 w-2.5" />
              {service.category.name}
            </span>
          )}
          {service.team && (
            <span className="text-[11px] text-muted-foreground">{service.team.name}</span>
          )}
        </div>
      </div>

      {/* Governance columns */}
      <div className="hidden shrink-0 items-center gap-3 lg:flex">
        {/* Status badge */}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
        {/* Owner */}
        <span className="text-[11px] text-muted-foreground w-28 truncate text-right">
          {owner?.full_name ?? 'Unassigned'}
        </span>
        {/* Version */}
        <span className="text-[11px] text-muted-foreground w-10 text-right">
          v{svcAny.version ?? '1.0'}
        </span>
      </div>

      {/* Active badge (mobile fallback status) */}
      <div className="flex shrink-0 items-center gap-2">
        {!service.is_active ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Inactive
          </span>
        ) : (
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400 lg:hidden">
            Active
          </span>
        )}
        <button
          onClick={() => onEdit(service)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
        <Link
          href={`/admin/services/${service.id}`}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <Settings2 className="h-3 w-3" />
          Edit Form
        </Link>
        {service.is_active && (
          <button
            onClick={() => onArchive(service)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
          >
            <Archive className="h-3 w-3" />
            Archive
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function ServicesAdminClient({ categories, teams, profiles }: Props) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [archiveTarget, setArchiveTarget] = useState<ServiceWithRelations | null>(null)
  const [archivePending, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState('')

  function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiveError('')
    startArchive(async () => {
      const result = await archiveService(archiveTarget.id)
      if (result.error) {
        setArchiveError(result.error)
      } else {
        setArchiveTarget(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => setModal({ type: 'create' })}
          className="btn-gradient"
        >
          <Plus className="h-4 w-4" />
          Create Service
        </button>
      </div>

      {/* Category tree */}
      {categories.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No categories found. Create categories first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const allServices = cat.sub_categories.flatMap((sc) => sc.services)
            const totalServices = allServices.length

            return (
              <div key={cat.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {/* Category header */}
                <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
                    {cat.icon ?? '📁'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{cat.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {cat.sub_categories.length} sub-categor{cat.sub_categories.length !== 1 ? 'ies' : 'y'} · {totalServices} service{totalServices !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {!cat.is_active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </div>

                {/* Sub-categories */}
                <div className="divide-y divide-border/60">
                  {cat.sub_categories.map((sc) => (
                    <div key={sc.id} className="px-4 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <div className="ml-3 h-px w-3 bg-border" />
                        <Tag className="h-3 w-3 text-muted-foreground/60" />
                        <span className="text-xs font-medium text-muted-foreground">{sc.name}</span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {sc.services.length} service{sc.services.length !== 1 ? 's' : ''}
                        </span>
                        {!sc.is_active && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Inactive
                          </span>
                        )}
                      </div>
                      {sc.services.length > 0 ? (
                        <div className="ml-6 space-y-1.5">
                          {sc.services.map((service) => (
                            <ServiceRow
                              key={service.id}
                              service={service}
                              profiles={profiles}
                              onEdit={(s) => setModal({ type: 'edit', service: s })}
                              onArchive={(s) => setArchiveTarget(s)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="ml-10 text-xs italic text-muted-foreground/60">No services</p>
                      )}
                    </div>
                  ))}
                  {cat.sub_categories.length === 0 && (
                    <div className="px-4 py-3">
                      <p className="ml-6 text-xs italic text-muted-foreground/60">No sub-categories</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      {modal && (
        <ServiceModal
          mode={modal}
          categories={categories}
          teams={teams}
          profiles={profiles}
          onClose={() => setModal(null)}
        />
      )}

      {/* Archive confirmation dialog */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Archive service?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>{archiveTarget.name}</strong> will be hidden from the catalog. You can re-activate it via Edit.
            </p>
            {archiveError && (
              <p className="mt-2 text-xs text-destructive">{archiveError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setArchiveTarget(null)}
                className="btn-soft"
              >
                Cancel
              </button>
              <button
                onClick={handleArchiveConfirm}
                disabled={archivePending}
                className="btn-danger disabled:opacity-60"
              >
                {archivePending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
