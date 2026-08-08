'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { GitFork, Plus, Pencil, Trash2, ChevronDown, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssignmentRule } from '@/lib/queries/routing'
import type { Profile } from '@/types'
import {
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
  toggleRuleActive,
} from '@/lib/actions/admin/routing'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RoutingRulesClientProps {
  rules: AssignmentRule[]
  services: { id: string; name: string }[]
  categories: { id: string; name: string; parent_id: string | null }[]
  profiles: Pick<Profile, 'id' | 'full_name' | 'role'>[]
}

type ScopeType = 'service' | 'sub_category' | 'category'
type Strategy = 'direct' | 'round_robin' | 'load_balanced'

interface FormState {
  name: string
  scope_type: ScopeType
  scope_id: string
  strategy: Strategy
  assignee_ids: string[]
  priority_filter: string
  is_active: boolean
}

function formStateFromRule(editRule: AssignmentRule | null): FormState {
  if (editRule) {
    return {
      name: editRule.name,
      scope_type: editRule.scope_type,
      scope_id: editRule.scope_id,
      strategy: editRule.strategy,
      assignee_ids: editRule.assignee_ids,
      priority_filter: editRule.priority_filter ?? '',
      is_active: editRule.is_active,
    }
  }
  return {
    name: '',
    scope_type: 'service',
    scope_id: '',
    strategy: 'round_robin',
    assignee_ids: [],
    priority_filter: '',
    is_active: true,
  }
}

const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low']

const SCOPE_LABELS: Record<ScopeType, string> = {
  service: 'Service',
  sub_category: 'Sub-category',
  category: 'Category',
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  direct: 'Direct',
  round_robin: 'Round-Robin',
  load_balanced: 'Load-Balanced',
}

const STRATEGY_HELP: Record<Strategy, string> = {
  direct: 'Every matching request goes to this person.',
  round_robin: 'Requests rotate evenly across the selected agents.',
  load_balanced: 'Each request goes to the agent with the fewest open tickets.',
}

const SCOPE_BADGE_STYLES: Record<ScopeType, string> = {
  service: 'bg-blue-100 text-blue-700',
  sub_category: 'bg-purple-100 text-purple-700',
  category: 'bg-green-100 text-green-700',
}

const STRATEGY_BADGE_STYLES: Record<Strategy, string> = {
  direct: 'bg-slate-100 text-slate-700',
  round_robin: 'bg-violet-100 text-violet-700',
  load_balanced: 'bg-orange-100 text-orange-700',
}

// ── Utility ────────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
]

function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// ── Searchable user select ─────────────────────────────────────────────────────

function UserSelect({
  profiles,
  selectedIds,
  onChange,
  multi,
  label,
}: {
  profiles: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  multi: boolean
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = profiles.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase())
  )

  const selectedProfiles = profiles.filter((p) => selectedIds.includes(p.id))

  function toggle(id: string) {
    if (multi) {
      if (selectedIds.includes(id)) {
        onChange(selectedIds.filter((x) => x !== id))
      } else {
        onChange([...selectedIds, id])
      }
    } else {
      onChange([id])
      setOpen(false)
    }
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id))
  }

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>

      {/* Selected chips */}
      {selectedProfiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedProfiles.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
            >
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white',
                  avatarColor(p.id)
                )}
              >
                {getInitials(p.full_name)}
              </span>
              {p.full_name}
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm',
          'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20'
        )}
      >
        <span className="text-muted-foreground">
          {multi ? 'Add agent...' : selectedProfiles.length === 0 ? 'Select agent...' : selectedProfiles[0].full_name}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No results</li>
            )}
            {filtered.map((p) => {
              const selected = selectedIds.includes(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors',
                      selected && 'bg-primary/5'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
                        avatarColor(p.id)
                      )}
                    >
                      {getInitials(p.full_name)}
                    </span>
                    <span className="flex-1 text-left">{p.full_name}</span>
                    <span className="text-xs text-muted-foreground capitalize">{p.role}</span>
                    {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground mb-2">Delete this rule?</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Requests will no longer be auto-assigned for this scope.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="btn-soft"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-danger"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule form modal ────────────────────────────────────────────────────────────

function RuleModal({
  open,
  onClose,
  editRule,
  services,
  categories,
  profiles,
}: {
  open: boolean
  onClose: () => void
  editRule: AssignmentRule | null
  services: { id: string; name: string }[]
  categories: { id: string; name: string; parent_id: string | null }[]
  profiles: Pick<Profile, 'id' | 'full_name' | 'role'>[]
}) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => formStateFromRule(editRule))
  const [saving, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the modal is (re)opened or the rule being edited changes.
  // Adjusting state during render (React's documented pattern) instead of an effect,
  // since this is state derived from props, not an external-system sync.
  const [prevResetKey, setPrevResetKey] = useState<[boolean, AssignmentRule | null]>([open, editRule])
  if (prevResetKey[0] !== open || prevResetKey[1] !== editRule) {
    setPrevResetKey([open, editRule])
    setForm(formStateFromRule(editRule))
    setError(null)
  }

  const scopeOptions =
    form.scope_type === 'service'
      ? services
      : form.scope_type === 'category'
      ? categories.filter((c) => !c.parent_id)
      : categories.filter((c) => !!c.parent_id)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleScopeTypeChange(t: ScopeType) {
    setForm((prev) => ({ ...prev, scope_type: t, scope_id: '' }))
  }

  function handleStrategyChange(s: Strategy) {
    setForm((prev) => ({ ...prev, strategy: s, assignee_ids: [] }))
  }

  function submit() {
    if (!form.name.trim()) { setError('Rule name is required.'); return }
    if (!form.scope_id) { setError('Please select a scope.'); return }
    if (form.assignee_ids.length === 0) { setError('Please select at least one assignee.'); return }

    setError(null)
    startSave(async () => {
      const payload = {
        name: form.name,
        scope_type: form.scope_type,
        scope_id: form.scope_id,
        strategy: form.strategy,
        assignee_ids: form.assignee_ids,
        priority_filter: form.priority_filter || null,
        is_active: form.is_active,
      }

      let result: { error?: string }
      if (editRule) {
        result = await updateAssignmentRule(editRule.id, payload)
      } else {
        result = await createAssignmentRule(payload)
      }

      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
        onClose()
      }
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-end bg-black/40">
      <div className="h-full w-full max-w-md overflow-y-auto bg-background shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {editRule ? 'Edit Rule' : 'New Routing Rule'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 px-6 py-5">
          {error && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Rule name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Rule name</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. IT Hardware — Round-Robin"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Scope type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Scope type</label>
            <div className="flex gap-2">
              {(['service', 'category', 'sub_category'] as ScopeType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleScopeTypeChange(t)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    form.scope_type === t
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  )}
                >
                  {SCOPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Scope select */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {SCOPE_LABELS[form.scope_type]}
            </label>
            <select
              value={form.scope_id}
              onChange={(e) => set('scope_id', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select {SCOPE_LABELS[form.scope_type].toLowerCase()}...</option>
              {scopeOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {/* Strategy */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Strategy</label>
            <select
              value={form.strategy}
              onChange={(e) => handleStrategyChange(e.target.value as Strategy)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="direct">Direct</option>
              <option value="round_robin">Round-Robin</option>
              <option value="load_balanced">Load-Balanced</option>
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">{STRATEGY_HELP[form.strategy]}</p>
          </div>

          {/* Assignees */}
          <UserSelect
            profiles={profiles}
            selectedIds={form.assignee_ids}
            onChange={(ids) => set('assignee_ids', form.strategy === 'direct' ? ids.slice(-1) : ids)}
            multi={form.strategy !== 'direct'}
            label={
              form.strategy === 'direct'
                ? 'Always assign to:'
                : form.strategy === 'round_robin'
                ? 'Rotate among:'
                : 'Pool of agents:'
            }
          />

          {/* Priority filter */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Priority filter</label>
            <select
              value={form.priority_filter}
              onChange={(e) => set('priority_filter', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Any priority</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground">Rule will auto-assign matching requests</p>
            </div>
            <Toggle checked={form.is_active} onChange={(v) => set('is_active', v)} />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="btn-soft"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="btn-gradient disabled:opacity-50"
          >
            {saving ? 'Saving...' : editRule ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule card ──────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onEdit,
  onDelete,
}: {
  rule: AssignmentRule
  onEdit: () => void
  onDelete: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [localActive, setLocalActive] = useState(rule.is_active)

  function handleToggle(v: boolean) {
    setLocalActive(v)
    startTransition(async () => {
      const result = await toggleRuleActive(rule.id, v)
      if (result.error) setLocalActive(!v)
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
      {/* Left: scope */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', SCOPE_BADGE_STYLES[rule.scope_type])}>
            {SCOPE_LABELS[rule.scope_type]}
          </span>
          <span className="text-sm font-semibold text-foreground truncate">{rule.scope_label}</span>
          <span className="text-xs text-muted-foreground truncate">— {rule.name}</span>
        </div>

        {/* Center: strategy + assignees */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STRATEGY_BADGE_STYLES[rule.strategy])}>
            {STRATEGY_LABELS[rule.strategy]}
          </span>

          {rule.assignee_names.map((name, i) => {
            const id = rule.assignee_ids[i] ?? name
            return (
              <span
                key={id}
                title={name}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white',
                  avatarColor(id)
                )}
              >
                {getInitials(name)}
              </span>
            )
          })}

          {rule.priority_filter && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-xs font-medium capitalize">
              {rule.priority_filter}
            </span>
          )}
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-3 shrink-0">
        <Toggle checked={localActive} onChange={handleToggle} disabled={isPending} />
        <button
          onClick={onEdit}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Edit rule"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
          title="Delete rule"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Main client ────────────────────────────────────────────────────────────────

export function RoutingRulesClient({
  rules: initialRules,
  services,
  categories,
  profiles,
}: RoutingRulesClientProps) {
  const [rules, setRules] = useState<AssignmentRule[]>(initialRules)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AssignmentRule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [, startDelete] = useTransition()

  // Resync `rules` whenever the server sends fresh `initialRules` (after
  // router.refresh() following a create/update, triggered by RuleModal.submit).
  // Adjusted during render, not an effect — same pattern as ProjectsTable.tsx.
  const [prevInitialRules, setPrevInitialRules] = useState(initialRules)
  if (prevInitialRules !== initialRules) {
    setPrevInitialRules(initialRules)
    setRules(initialRules)
  }

  function openCreate() {
    setEditTarget(null)
    setModalOpen(true)
  }

  function openEdit(rule: AssignmentRule) {
    setEditTarget(rule)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditTarget(null)
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget
    setDeleteTarget(null)
    startDelete(async () => {
      await deleteAssignmentRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
    })
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitFork className="h-4 w-4" />
          <span>{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
        </div>
        <button
          onClick={openCreate}
          className="btn-gradient"
        >
          <Plus className="h-4 w-4" />
          New Rule
        </button>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <GitFork className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No routing rules yet</p>
          <p className="text-sm text-muted-foreground">
            Create one to start auto-assigning requests.
          </p>
          <button
            onClick={openCreate}
            className="btn-soft mt-4"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => openEdit(rule)}
              onDelete={() => setDeleteTarget(rule.id)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <RuleModal
        open={modalOpen}
        onClose={closeModal}
        editRule={editTarget}
        services={services}
        categories={categories}
        profiles={profiles}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
