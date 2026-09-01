'use client'

import { useState, useTransition, useMemo } from 'react'
import { Plus, Pencil, Archive, Tag, Trash2, Copy, CheckSquare, MinusSquare, Square } from 'lucide-react'
import {
  createService,
  updateService,
  archiveService,
  deleteService,
  saveFormSections,
  type ServiceInput,
} from '@/lib/actions/admin/services'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { IconPicker } from '@/components/admin/IconPicker'
import type { ServiceCategoryWithSubCategories, Team, Profile } from '@/types'
import type { ServiceWithTags } from '@/lib/queries/services'

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileMini = Pick<Profile, 'id' | 'full_name'>

type Props = {
  services: ServiceWithTags[]
  categoryTree: ServiceCategoryWithSubCategories[]
  teams: Team[]
  profiles: ProfileMini[]
  templates: { id: string; name: string }[]
  slaPolicies: { id: string; name: string }[]
}

type ModalMode =
  | { type: 'create' }
  | { type: 'edit'; service: ServiceWithTags }
  | { type: 'duplicate'; source: ServiceWithTags }
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
  categoryTree,
  services,
  teams,
  profiles,
  templates,
  slaPolicies,
  onClose,
}: {
  mode: Exclude<ModalMode, null>
  categoryTree: ServiceCategoryWithSubCategories[]
  services: ServiceWithTags[]
  teams: Team[]
  profiles: ProfileMini[]
  templates: { id: string; name: string }[]
  slaPolicies: { id: string; name: string }[]
  onClose: () => void
}) {
  const isEdit = mode.type === 'edit'
  const isDuplicate = mode.type === 'duplicate'
  const existing = isEdit ? mode.service : isDuplicate ? mode.source : null
  const existingAny = existing as (ServiceWithTags & { status?: string; owner_id?: string | null; backup_owner_id?: string | null; version?: string; visibility?: string }) | null

  const [name, setName] = useState(isDuplicate ? `${existing?.name ?? ''} (Copy)` : existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? '')
  const [iconImageUrl, setIconImageUrl] = useState<string | null>(existingAny?.icon_image_url ?? null)
  const [tagIds, setTagIds] = useState<string[]>(existing?.sub_category_tag_ids ?? [])
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
  const [slaPolicyId, setSlaPolicyId] = useState(existingAny?.sla_policy_id ?? '')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function toggleTag(subCategoryId: string) {
    setTagIds((prev) => prev.includes(subCategoryId) ? prev.filter((id) => id !== subCategoryId) : [...prev, subCategoryId])
  }

  // Which sub-category is already tagged to a DIFFERENT service — a
  // sub-category should only ever be selectable from one service at a time,
  // so no two services' create-request forms offer the same category. Self
  // is excluded when editing so a service's own current tags never show as
  // "taken by" themselves.
  const excludeServiceId = isEdit ? existing!.id : null
  const takenBy = useMemo(() => {
    const map = new Map<string, { serviceId: string; serviceName: string }>()
    for (const s of services) {
      if (s.id === excludeServiceId) continue
      for (const subId of s.sub_category_tag_ids) {
        if (!map.has(subId)) map.set(subId, { serviceId: s.id, serviceName: s.name })
      }
    }
    return map
  }, [services, excludeServiceId])

  function selectableIdsForCategory(cat: ServiceCategoryWithSubCategories): string[] {
    return cat.sub_categories
      .filter((sc) => tagIds.includes(sc.id) || !takenBy.has(sc.id))
      .map((sc) => sc.id)
  }

  function toggleCategoryAll(cat: ServiceCategoryWithSubCategories) {
    const selectable = selectableIdsForCategory(cat)
    const allSelected = selectable.length > 0 && selectable.every((id) => tagIds.includes(id))
    setTagIds((prev) => {
      if (allSelected) {
        const remove = new Set(selectable)
        return prev.filter((id) => !remove.has(id))
      }
      const next = new Set(prev)
      selectable.forEach((id) => next.add(id))
      return [...next]
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const data: ServiceInput = {
      name,
      description,
      icon,
      icon_image_url: iconImageUrl,
      sub_category_tag_ids: tagIds,
      team_id: teamId,
      default_priority: priority,
      is_active: isActive,
      status,
      owner_id: ownerId || null,
      backup_owner_id: backupOwnerId || null,
      version: version.trim() || '1.0',
      visibility,
      sla_policy_id: slaPolicyId || null,
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
            {isEdit ? 'Edit Service' : isDuplicate ? `Duplicate "${mode.source.name}"` : 'Create Service'}
          </h2>
          {isDuplicate && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pre-filled from the source service
              {mode.source.template_id
                ? ', tagged to the same template'
                : resolveServiceFormSections(mode.source).length > 0 ? ', including its intake form' : ''}
              {tagIds.length > 0 ? `, and the same ${tagIds.length} tagged categor${tagIds.length === 1 ? 'y' : 'ies'}` : ''}.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {/* Name + Icon row */}
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
                placeholder="e.g. IT"
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

          {/* SLA Policy — the reusable, named response/resolution table this
              service resolves deadlines from (Service Desk → SLA Policies). */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">SLA Policy</label>
            <select
              value={slaPolicyId}
              onChange={(e) => setSlaPolicyId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">No policy — no SLA deadlines</option>
              {slaPolicies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {slaPolicyId
                ? 'Response/resolution hours for tickets on this service always come from the mapped policy, per priority.'
                : 'Manage reusable SLA tables under Service Desk → SLA Policies.'}
            </p>
          </div>

          {/* Tag Categories — which sub-categories a requester can pick as a
              built-in field when submitting a ticket for this service. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tag Categories</label>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Which categories/sub-categories requesters can pick when raising a ticket for this service.
            </p>
            <div className="max-h-52 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
              {categoryTree.length === 0 ? (
                <p className="text-xs italic text-muted-foreground/60">No categories yet — manage them under Categories.</p>
              ) : (
                categoryTree.map((cat) => {
                  const selectable = selectableIdsForCategory(cat)
                  const selectedCount = selectable.filter((id) => tagIds.includes(id)).length
                  const allSelected = selectable.length > 0 && selectedCount === selectable.length
                  const someSelected = selectedCount > 0 && !allSelected
                  return (
                    <div key={cat.id}>
                      <div className="mb-1 flex items-center gap-1.5">
                        {cat.sub_categories.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleCategoryAll(cat)}
                            disabled={selectable.length === 0}
                            title={allSelected ? 'Deselect all' : 'Select all available'}
                            className="shrink-0 text-muted-foreground hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          >
                            {allSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            ) : someSelected ? (
                              <MinusSquare className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <p className="flex items-center gap-1 text-xs font-semibold text-foreground">
                          {cat.icon && <span>{cat.icon}</span>}
                          {cat.name}
                        </p>
                      </div>
                      {cat.sub_categories.length === 0 ? (
                        <p className="ml-4 text-[11px] italic text-muted-foreground/60">No sub-categories</p>
                      ) : (
                        <div className="ml-4 space-y-1">
                          {cat.sub_categories.map((sc) => {
                            const isChecked = tagIds.includes(sc.id)
                            const taken = takenBy.get(sc.id)
                            const isDisabled = !!taken && !isChecked
                            return (
                              <label
                                key={sc.id}
                                className={`flex items-center gap-2 text-xs ${isDisabled ? 'text-muted-foreground/50' : 'text-foreground'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isDisabled}
                                  onChange={() => toggleTag(sc.id)}
                                  className="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary disabled:cursor-not-allowed"
                                />
                                <span className="flex-1 truncate">{sc.name}</span>
                                {isDisabled && (
                                  <span
                                    className="shrink-0 text-[10px] italic text-muted-foreground/70"
                                    title={`Already tagged to "${taken.serviceName}" — untag it there first if you want to move it here.`}
                                  >
                                    Used by {taken.serviceName}
                                  </span>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
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
  service: ServiceWithTags
  profiles: ProfileMini[]
  onEdit: (s: ServiceWithTags) => void
  onDuplicate: (s: ServiceWithTags) => void
  onArchive: (s: ServiceWithTags) => void
  onDelete: (s: ServiceWithTags) => void
}) {
  const svcAny = service as ServiceWithTags & { status?: string; owner_id?: string | null; version?: string }
  const govStatus = (svcAny.status ?? 'published') as ServiceStatus
  const badge = STATUS_BADGE[govStatus] ?? STATUS_BADGE.published
  const owner = profiles.find((p) => p.id === svcAny.owner_id)
  const tagCount = service.sub_category_tag_ids.length

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-sm">
      {/* Icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-lg">
        {service.icon_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL not in next.config's remote patterns
          <img src={service.icon_image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          service.icon ?? '📋'
        )}
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{service.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Tag className="h-2.5 w-2.5" />
            {tagCount} categor{tagCount === 1 ? 'y' : 'ies'} tagged
          </span>
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

export default function ServicesAdminClient({ services, categoryTree, teams, profiles, templates, slaPolicies }: Props) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [archiveTarget, setArchiveTarget] = useState<ServiceWithTags | null>(null)
  const [archivePending, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ServiceWithTags | null>(null)
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

      {/* Flat service list — a broad service (IT/HR/Facilities) is no longer
          nested under a category; category is a field tagged to it instead. */}
      {services.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No services yet. Create the first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((service) => (
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
      )}

      {/* Create / Edit modal */}
      {modal && (
        <ServiceModal
          mode={modal}
          categoryTree={categoryTree}
          services={services}
          teams={teams}
          profiles={profiles}
          templates={templates}
          slaPolicies={slaPolicies}
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
