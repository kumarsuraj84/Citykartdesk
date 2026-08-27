'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Archive, Settings2, Tag, Trash2, Copy } from 'lucide-react'
import {
  createService,
  updateService,
  archiveService,
  deleteService,
  saveFormSections,
  type ServiceInput,
} from '@/lib/actions/admin/services'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { ServiceCategoryWithSubCategories, ServiceWithRelations, Team, Profile, SLAConfig } from '@/types'

const SLA_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
type SlaDraft = Record<(typeof SLA_PRIORITIES)[number], { response: string; resolution: string }>

function slaConfigToDraft(config: SLAConfig | null | undefined): SlaDraft {
  const draft = {} as SlaDraft
  for (const p of SLA_PRIORITIES) {
    draft[p] = {
      response: config?.[p]?.response_hours != null ? String(config[p]!.response_hours) : '',
      resolution: config?.[p]?.resolution_hours != null ? String(config[p]!.resolution_hours) : '',
    }
  }
  return draft
}

function draftToSlaConfig(draft: SlaDraft): SLAConfig {
  const config: SLAConfig = {}
  for (const p of SLA_PRIORITIES) {
    const response = draft[p].response.trim()
    const resolution = draft[p].resolution.trim()
    if (!response && !resolution) continue
    config[p] = {
      response_hours: response ? parseFloat(response) : null,
      resolution_hours: resolution ? parseFloat(resolution) : null,
    }
  }
  return config
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileMini = Pick<Profile, 'id' | 'full_name'>

type Props = {
  categories: ServiceCategoryWithSubCategories[]
  teams: Team[]
  profiles: ProfileMini[]
  templates: { id: string; name: string }[]
}

type ModalMode =
  // A service is always created from inside the sub-category it belongs to —
  // category/sub-category come from where you clicked "Add Service", not a
  // dropdown, so the create mode carries that fixed context instead of
  // letting the modal pick it.
  | { type: 'create'; categoryId: string; categoryName: string; subCategoryId: string; subCategoryName: string }
  | { type: 'edit'; service: ServiceWithRelations }
  | { type: 'duplicate'; source: ServiceWithRelations }
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
  teams,
  profiles,
  templates,
  onClose,
}: {
  mode: Exclude<ModalMode, null>
  teams: Team[]
  profiles: ProfileMini[]
  templates: { id: string; name: string }[]
  onClose: () => void
}) {
  const isEdit = mode.type === 'edit'
  const isDuplicate = mode.type === 'duplicate'
  const isCreate = mode.type === 'create'
  const existing = isEdit ? mode.service : isDuplicate ? mode.source : null
  const existingAny = existing as (ServiceWithRelations & { status?: string; owner_id?: string | null; backup_owner_id?: string | null; version?: string; visibility?: string }) | null

  const [name, setName] = useState(isDuplicate ? `${existing?.name ?? ''} (Copy)` : existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  // Category/sub-category are never picked in this modal — they come from
  // where the service was created (the "Add Service" button on a
  // sub-category's own row) or, for edit/duplicate, from the existing
  // service. Fixed for the lifetime of this modal, shown read-only below.
  const categoryId = isCreate ? mode.categoryId : existing?.category_id ?? ''
  const subCategoryId = isCreate ? mode.subCategoryId : existing?.sub_category_id ?? ''
  const categoryName = isCreate ? mode.categoryName : existing?.category?.name ?? '—'
  const subCategoryName = isCreate ? mode.subCategoryName : existing?.sub_category?.name ?? null
  const [teamId, setTeamId] = useState(existing?.team_id ?? '')
  const [templateId, setTemplateId] = useState(existing?.template_id ?? '')
  const [priority, setPriority] = useState<ServiceInput['default_priority']>(
    existing?.default_priority ?? 'medium'
  )
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [status, setStatus] = useState<ServiceStatus>((existingAny?.status as ServiceStatus) ?? 'published')
  const [ownerId, setOwnerId] = useState(existingAny?.owner_id ?? '')
  const [backupOwnerId, setBackupOwnerId] = useState(existingAny?.backup_owner_id ?? '')
  const [version, setVersion] = useState(isDuplicate ? '1.0' : existingAny?.version ?? '1.0')
  const [visibility, setVisibility] = useState<ServiceVisibility>((existingAny?.visibility as ServiceVisibility) ?? 'all')
  const [slaDraft, setSlaDraft] = useState<SlaDraft>(() =>
    slaConfigToDraft(existingAny?.sla_config as SLAConfig | null | undefined)
  )
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

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
      sla_config: draftToSlaConfig(slaDraft),
      template_id: templateId || null,
    }

    startTransition(async () => {
      const result: { error?: string; id?: string } = isEdit
        ? await updateService(existing!.id, data)
        : await createService(data)

      if (result.error) {
        setError(result.error)
        return
      }

      // Duplicate: a template-tagged source already carries its template_id
      // forward via `data` above (same live template, nothing to copy). Only
      // an untagged legacy source — which still owns its own inline form —
      // needs its sections cloned onto the new service the old way, so a
      // duplicate of it isn't left with an empty form.
      if (mode.type === 'duplicate' && result.id && !mode.source.template_id) {
        const sourceSections = resolveServiceFormSections(mode.source)
        if (sourceSections.length > 0) {
          const formResult = await saveFormSections(result.id, sourceSections)
          if (formResult.error) {
            setError(`Service created, but copying the form failed: ${formResult.error}`)
            return
          }
        }
      }

      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="border-b border-border px-5 py-4 sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Edit Service' : isDuplicate ? `Duplicate "${mode.source.name}"` : 'Add Service'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isDuplicate ? (
              <>
                Pre-filled from the source service
                {mode.source.template_id
                  ? ', tagged to the same template'
                  : resolveServiceFormSections(mode.source).length > 0 ? ', including its intake form' : ''}
                {' '}· {categoryName}{subCategoryName ? ` → ${subCategoryName}` : ''}
              </>
            ) : (
              <>Under {categoryName}{subCategoryName ? ` → ${subCategoryName}` : ''}</>
            )}
          </p>
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

          {/* Category / Sub-category — fixed by where this service was
              created (or, for edit/duplicate, by the existing service);
              never a picker here. To move a service, delete and re-add it
              from the target sub-category. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
              {categoryName}{subCategoryName ? ` → ${subCategoryName}` : ''}
            </div>
          </div>

          {/* Form Template — the live source of truth for this service's intake
              form once tagged; forms are no longer built per-service. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Form Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">No template — untagged</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {templateId
                ? "This service's intake form always reflects whatever the tagged template currently says."
                : 'Manage reusable forms under Service Desk → Form Templates.'}
            </p>
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

          {/* SLA Overrides */}
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">SLA Overrides</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Per-priority response/resolution targets for this service. Leave a field blank to inherit the organization&apos;s default for that priority (Admin → Request Config → SLA Targets).
            </p>
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
                    placeholder="Response (h) — org default"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={slaDraft[p].resolution}
                    onChange={(e) => setSlaDraft((prev) => ({ ...prev, [p]: { ...prev[p], resolution: e.target.value } }))}
                    placeholder="Resolution (h) — org default"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              ))}
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
              {pending ? 'Saving…' : isEdit ? 'Save Changes' : isDuplicate ? 'Create Duplicate' : 'Create Service'}
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
  onDuplicate,
  onArchive,
  onDelete,
}: {
  service: ServiceWithRelations
  profiles: ProfileMini[]
  onEdit: (s: ServiceWithRelations) => void
  onDuplicate: (s: ServiceWithRelations) => void
  onArchive: (s: ServiceWithRelations) => void
  onDelete: (s: ServiceWithRelations) => void
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
          Form
        </Link>
        <button
          onClick={() => onDuplicate(service)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <Copy className="h-3 w-3" />
          Duplicate
        </button>
        {service.is_active && (
          <button
            onClick={() => onArchive(service)}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
          >
            <Archive className="h-3 w-3" />
            Archive
          </button>
        )}
        <button
          onClick={() => onDelete(service)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function ServicesAdminClient({ categories, teams, profiles, templates }: Props) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [archiveTarget, setArchiveTarget] = useState<ServiceWithRelations | null>(null)
  const [archivePending, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ServiceWithRelations | null>(null)
  const [deletePending, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState('')

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

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleteError('')
    startDelete(async () => {
      const result = await deleteService(deleteTarget.id)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setDeleteTarget(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Category tree — a service is created from inside the sub-category it
          belongs to ("+ Add Service" below), not picked via a dropdown, so
          there's no context-free "Create Service" button up here anymore. */}
      {categories.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No categories yet — a service is always added from inside a category &amp; sub-category, so create those first.
          </p>
          <Link
            href="/admin/categories"
            className="btn-gradient mt-4 inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Manage Categories
          </Link>
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
                              onDuplicate={(s) => setModal({ type: 'duplicate', source: s })}
                              onArchive={(s) => setArchiveTarget(s)}
                              onDelete={(s) => setDeleteTarget(s)}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="ml-10 text-xs italic text-muted-foreground/60">No services</p>
                      )}
                      <button
                        onClick={() => setModal({
                          type: 'create',
                          categoryId: cat.id,
                          categoryName: cat.name,
                          subCategoryId: sc.id,
                          subCategoryName: sc.name,
                        })}
                        className="ml-6 mt-1.5 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
                      >
                        <Plus className="h-3 w-3" />
                        Add Service
                      </button>
                    </div>
                  ))}
                  {cat.sub_categories.length === 0 && (
                    <div className="px-4 py-3">
                      <p className="ml-6 text-xs italic text-muted-foreground/60">
                        No sub-categories yet — a service needs one to be added under.{' '}
                        <Link href={`/admin/categories/${cat.slug}`} className="not-italic text-primary hover:underline">
                          Add one →
                        </Link>
                      </p>
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
          teams={teams}
          profiles={profiles}
          templates={templates}
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

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-destructive">Delete service permanently?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>{deleteTarget.name}</strong> will be permanently removed. This action cannot be undone.
              If any requests reference it, deletion will be blocked — archive it instead in that case.
            </p>
            {deleteError && (
              <p className="mt-2 text-xs text-destructive">{deleteError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError('') }}
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
        </div>
      )}
    </div>
  )
}
