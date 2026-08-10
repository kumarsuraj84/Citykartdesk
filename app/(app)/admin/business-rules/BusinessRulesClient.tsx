'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Plus, Pencil, Trash2, X, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/constants/requests'
import {
  createBusinessRule,
  updateBusinessRule,
  deleteBusinessRule,
  toggleBusinessRuleActive,
  migrateLegacyRulesToBusinessRules,
  type BusinessRuleInput,
} from '@/lib/actions/admin/business-rules'
import type { RuleCondition, RuleConditionField, RuleConditionOperator } from '@/lib/rules/evaluate'
import type { RuleAction } from '@/lib/rules/actions'
import type { Profile } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

type Ref = { id: string; name: string }
type SubCatRef = Ref & { category_id: string }
type ProfileRef = Pick<Profile, 'id' | 'full_name' | 'role'>

type BusinessRuleRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  trigger: 'created' | 'updated' | 'schedule'
  schedule_check: 'sla_pct_elapsed' | 'unassigned_minutes' | null
  schedule_threshold: number | null
  conditions: RuleCondition[]
  actions: RuleAction[]
  execution_order: number
}

interface BusinessRulesClientProps {
  rules: BusinessRuleRow[]
  services: Ref[]
  categories: Ref[]
  subCategories: SubCatRef[]
  teams: Ref[]
  profiles: ProfileRef[]
  legacyRulesAvailable: boolean
}

// ── Reference vocab ──────────────────────────────────────────────────────────

const TRIGGER_LABELS = { created: 'Created', updated: 'Edited', schedule: 'On a schedule' } as const
const TRIGGER_BADGE: Record<string, string> = {
  created: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  updated: 'bg-blue-50 text-blue-700 border-blue-100',
  schedule: 'bg-violet-50 text-violet-700 border-violet-100',
}

const FIELD_OPTIONS: { value: RuleConditionField; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'service_id', label: 'Service' },
  { value: 'category_id', label: 'Service Group' },
  { value: 'sub_category_id', label: 'Service Sub Group' },
  { value: 'team_id', label: 'Team' },
  { value: 'requester_id', label: 'Requester' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
]

const OPERATOR_OPTIONS: { value: RuleConditionOperator; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const ACTION_TYPE_LABELS: Record<RuleAction['type'], string> = {
  assign: 'Assign to',
  set_priority: 'Set priority',
  set_status: 'Set status',
  notify: 'Notify',
}

const NOTIFY_ROLE_OPTIONS = ['manager', 'admin', 'platform_owner']

// ── Small UI primitives ──────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
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
      <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  )
}

const selectCls = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20'
const inputCls = selectCls

// ── Condition row ────────────────────────────────────────────────────────────

function conditionValueOptions(field: RuleConditionField, refs: BusinessRulesClientProps): { value: string; label: string }[] | null {
  if (field === 'priority') return Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))
  if (field === 'status') return Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
  if (field === 'service_id') return refs.services.map((s) => ({ value: s.id, label: s.name }))
  if (field === 'category_id') return refs.categories.map((c) => ({ value: c.id, label: c.name }))
  if (field === 'sub_category_id') return refs.subCategories.map((c) => ({ value: c.id, label: c.name }))
  if (field === 'team_id') return refs.teams.map((t) => ({ value: t.id, label: t.name }))
  if (field === 'requester_id') return refs.profiles.map((p) => ({ value: p.id, label: p.full_name }))
  return null // title/description — free text
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  refs,
}: {
  condition: RuleCondition
  onChange: (c: RuleCondition) => void
  onRemove: () => void
  refs: BusinessRulesClientProps
}) {
  const needsValue = condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty'
  const options = conditionValueOptions(condition.field, refs)

  return (
    <div className="flex items-center gap-2">
      <select
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value as RuleConditionField, operator: condition.operator, value: null })}
        className={cn(selectCls, 'flex-1')}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as RuleConditionOperator })}
        className={cn(selectCls, 'flex-1')}
      >
        {OPERATOR_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {needsValue && (
        options ? (
          <select
            value={typeof condition.value === 'string' ? condition.value : ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className={cn(selectCls, 'flex-1')}
          >
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={typeof condition.value === 'string' ? condition.value : ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="Text…"
            className={cn(inputCls, 'flex-1')}
          />
        )
      )}
      <button type="button" onClick={onRemove} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Action row ───────────────────────────────────────────────────────────────

function ActionRow({
  action,
  onChange,
  onRemove,
  refs,
}: {
  action: RuleAction
  onChange: (a: RuleAction) => void
  onRemove: () => void
  refs: BusinessRulesClientProps
}) {
  function changeType(type: RuleAction['type']) {
    if (type === 'assign') onChange({ type: 'assign', params: { strategy: 'direct', assigneeIds: [] } })
    else if (type === 'set_priority') onChange({ type: 'set_priority', params: { priority: 'medium' } })
    else if (type === 'set_status') onChange({ type: 'set_status', params: { status: 'in_progress' } })
    else onChange({ type: 'notify', params: { roles: ['manager'], notifyAssignee: false, notifyRequester: false, channels: ['in_app'] } })
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <select value={action.type} onChange={(e) => changeType(e.target.value as RuleAction['type'])} className={cn(selectCls, 'flex-1')}>
          {(Object.keys(ACTION_TYPE_LABELS) as RuleAction['type'][]).map((t) => (
            <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {action.type === 'assign' && (
        <div className="space-y-2">
          <select
            value={action.params.strategy}
            onChange={(e) => onChange({ type: 'assign', params: { ...action.params, strategy: e.target.value as 'direct' | 'round_robin' | 'load_balanced' } })}
            className={selectCls}
          >
            <option value="direct">Direct (first agent)</option>
            <option value="round_robin">Round-robin</option>
            <option value="load_balanced">Load-balanced (fewest open)</option>
          </select>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
            {refs.profiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={action.params.assigneeIds.includes(p.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...action.params.assigneeIds, p.id]
                      : action.params.assigneeIds.filter((id) => id !== p.id)
                    onChange({ type: 'assign', params: { ...action.params, assigneeIds: next } })
                  }}
                />
                {p.full_name} <span className="text-xs text-muted-foreground capitalize">({p.role})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {action.type === 'set_priority' && (
        <select
          value={action.params.priority}
          onChange={(e) => onChange({ type: 'set_priority', params: { priority: e.target.value } })}
          className={selectCls}
        >
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}

      {action.type === 'set_status' && (
        <select
          value={action.params.status}
          onChange={(e) => onChange({ type: 'set_status', params: { status: e.target.value } })}
          className={selectCls}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}

      {action.type === 'notify' && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-3">
            {NOTIFY_ROLE_OPTIONS.map((role) => (
              <label key={role} className="flex items-center gap-1.5 capitalize">
                <input
                  type="checkbox"
                  checked={action.params.roles.includes(role)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...action.params.roles, role] : action.params.roles.filter((r) => r !== role)
                    onChange({ type: 'notify', params: { ...action.params, roles: next } })
                  }}
                />
                {role}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={action.params.notifyAssignee}
                onChange={(e) => onChange({ type: 'notify', params: { ...action.params, notifyAssignee: e.target.checked } })}
              />
              Assignee
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={action.params.notifyRequester}
                onChange={(e) => onChange({ type: 'notify', params: { ...action.params, notifyRequester: e.target.checked } })}
              />
              Requester
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            {(['in_app', 'email'] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-1.5 capitalize">
                <input
                  type="checkbox"
                  checked={action.params.channels.includes(ch)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...action.params.channels, ch] : action.params.channels.filter((c) => c !== ch)
                    onChange({ type: 'notify', params: { ...action.params, channels: next } })
                  }}
                />
                {ch === 'in_app' ? 'In-app' : 'Email'}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Editor drawer ────────────────────────────────────────────────────────────

function formStateFromRule(rule: BusinessRuleRow | null): BusinessRuleInput {
  if (rule) {
    return {
      name: rule.name,
      description: rule.description ?? '',
      is_active: rule.is_active,
      trigger: rule.trigger,
      schedule_check: rule.schedule_check,
      schedule_threshold: rule.schedule_threshold,
      conditions: rule.conditions ?? [],
      actions: rule.actions ?? [],
      execution_order: rule.execution_order,
    }
  }
  return {
    name: '',
    description: '',
    is_active: true,
    trigger: 'created',
    schedule_check: null,
    schedule_threshold: null,
    conditions: [],
    actions: [],
    execution_order: 0,
  }
}

function RuleEditor({
  open,
  onClose,
  editRule,
  refs,
}: {
  open: boolean
  onClose: () => void
  editRule: BusinessRuleRow | null
  refs: BusinessRulesClientProps
}) {
  const router = useRouter()
  const [form, setForm] = useState<BusinessRuleInput>(() => formStateFromRule(editRule))
  const [saving, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Reset whenever the drawer (re)opens for a different rule — state derived
  // from props, adjusted during render (same pattern as RoutingRulesClient).
  const [prevKey, setPrevKey] = useState<[boolean, BusinessRuleRow | null]>([open, editRule])
  if (prevKey[0] !== open || prevKey[1] !== editRule) {
    setPrevKey([open, editRule])
    setForm(formStateFromRule(editRule))
    setError(null)
  }

  function set<K extends keyof BusinessRuleInput>(key: K, value: BusinessRuleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function addCondition() {
    set('conditions', [...form.conditions, { field: 'priority', operator: 'equals', value: null }])
  }
  function addAction() {
    set('actions', [...form.actions, { type: 'assign', params: { strategy: 'direct', assigneeIds: [] } }])
  }

  function submit() {
    if (!form.name.trim()) { setError('Rule name is required.'); return }
    if (form.trigger === 'schedule' && (!form.schedule_check || form.schedule_threshold == null)) {
      setError('Schedule rules need a check type and threshold.')
      return
    }
    if (form.actions.length === 0) { setError('Add at least one action.'); return }

    setError(null)
    startSave(async () => {
      const result = editRule ? await updateBusinessRule(editRule.id, form) : await createBusinessRule(form)
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
      <div className="h-full w-full max-w-xl overflow-y-auto bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{editRule ? 'Edit Business Rule' : 'New Business Rule'}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 px-6 py-5">
          {error && <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Name</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Route hardware requests" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Description</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" className={inputCls} />
          </div>

          {/* Trigger */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Execute when a request is</label>
            <div className="flex gap-2">
              {(['created', 'updated', 'schedule'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('trigger', t)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    form.trigger === t ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  )}
                >
                  {TRIGGER_LABELS[t]}
                </button>
              ))}
            </div>
            {form.trigger === 'updated' && (
              <p className="mt-1.5 text-xs text-muted-foreground">Fires after a status change or priority change.</p>
            )}
          </div>

          {form.trigger === 'schedule' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Check</label>
                <select
                  value={form.schedule_check ?? ''}
                  onChange={(e) => set('schedule_check', (e.target.value || null) as BusinessRuleInput['schedule_check'])}
                  className={selectCls}
                >
                  <option value="">Select…</option>
                  <option value="sla_pct_elapsed">% of SLA elapsed</option>
                  <option value="unassigned_minutes">Unassigned for (minutes)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Threshold</label>
                <input
                  type="number"
                  min="0"
                  value={form.schedule_threshold ?? ''}
                  onChange={(e) => set('schedule_threshold', e.target.value ? Number(e.target.value) : null)}
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-foreground">Conditions</label>
              <button type="button" onClick={addCondition} className="text-xs text-primary hover:underline">+ Add condition</button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {form.conditions.length === 0 ? 'No conditions — matches every request.' : 'All conditions must match.'}
            </p>
            <div className="space-y-2">
              {form.conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  refs={refs}
                  onChange={(next) => set('conditions', form.conditions.map((c2, i2) => (i2 === i ? next : c2)))}
                  onRemove={() => set('conditions', form.conditions.filter((_, i2) => i2 !== i))}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-foreground">Actions</label>
              <button type="button" onClick={addAction} className="text-xs text-primary hover:underline">+ Add action</button>
            </div>
            <div className="space-y-2">
              {form.actions.map((a, i) => (
                <ActionRow
                  key={i}
                  action={a}
                  refs={refs}
                  onChange={(next) => set('actions', form.actions.map((a2, i2) => (i2 === i ? next : a2)))}
                  onRemove={() => set('actions', form.actions.filter((_, i2) => i2 !== i))}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Execution order</label>
            <input
              type="number"
              value={form.execution_order}
              onChange={(e) => set('execution_order', Number(e.target.value))}
              className={cn(inputCls, 'max-w-[120px]')}
            />
            <p className="mt-1 text-xs text-muted-foreground">Lower runs first. Later matching rules can override earlier actions.</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground">Rule runs automatically when enabled</p>
            </div>
            <Toggle checked={form.is_active} onChange={(v) => set('is_active', v)} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex gap-3 justify-end">
          <button onClick={onClose} className="btn-soft">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn-gradient disabled:opacity-50">
            {saving ? 'Saving…' : editRule ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, onEdit, onDelete }: { rule: BusinessRuleRow; onEdit: () => void; onDelete: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [localActive, setLocalActive] = useState(rule.is_active)

  function handleToggle(v: boolean) {
    setLocalActive(v)
    startTransition(async () => {
      const result = await toggleBusinessRuleActive(rule.id, v)
      if (result.error) setLocalActive(!v)
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', TRIGGER_BADGE[rule.trigger])}>
            {TRIGGER_LABELS[rule.trigger]}
            {rule.trigger === 'schedule' && rule.schedule_check ? ` · ${rule.schedule_check === 'sla_pct_elapsed' ? `${rule.schedule_threshold}% SLA` : `${rule.schedule_threshold}m unassigned`}` : ''}
          </span>
          <span className="text-sm font-semibold text-foreground truncate">{rule.name}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {rule.conditions.length === 0 ? 'Matches every request' : `${rule.conditions.length} condition${rule.conditions.length === 1 ? '' : 's'}`}
          {' · '}
          {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'}
          {' · order '}{rule.execution_order}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Toggle checked={localActive} onChange={handleToggle} disabled={isPending} />
        <button onClick={onEdit} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit rule">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={onDelete} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors" title="Delete rule">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ open, title, body, onConfirm, onCancel }: { open: boolean; title: string; body: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-6">{body}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-soft">Cancel</button>
          <button onClick={onConfirm} className="btn-danger">Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Main client ──────────────────────────────────────────────────────────────

export function BusinessRulesClient(props: BusinessRulesClientProps) {
  const router = useRouter()
  const [rules, setRules] = useState<BusinessRuleRow[]>(props.rules)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BusinessRuleRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [migrating, startMigrate] = useTransition()
  const [, startDelete] = useTransition()

  const [prevRules, setPrevRules] = useState(props.rules)
  if (prevRules !== props.rules) {
    setPrevRules(props.rules)
    setRules(props.rules)
  }

  function openCreate() { setEditTarget(null); setModalOpen(true) }
  function openEdit(rule: BusinessRuleRow) { setEditTarget(rule); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditTarget(null) }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget
    setDeleteTarget(null)
    startDelete(async () => {
      await deleteBusinessRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
    })
  }

  function handleMigrate() {
    startMigrate(async () => {
      await migrateLegacyRulesToBusinessRules()
      router.refresh()
    })
  }

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Zap className="h-4 w-4" />
          <span>{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
        </div>
        <div className="flex items-center gap-2">
          {props.legacyRulesAvailable && (
            <button onClick={handleMigrate} disabled={migrating} className="btn-soft disabled:opacity-50">
              <RefreshCw className={cn('h-4 w-4', migrating && 'animate-spin')} />
              {migrating ? 'Migrating…' : 'Migrate legacy rules'}
            </button>
          )}
          <button onClick={openCreate} className="btn-gradient">
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Zap className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No business rules yet</p>
          <p className="text-sm text-muted-foreground">Create one to automate request handling.</p>
          <button onClick={openCreate} className="btn-soft mt-4">
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} onEdit={() => openEdit(rule)} onDelete={() => setDeleteTarget(rule.id)} />
          ))}
        </div>
      )}

      <RuleEditor open={modalOpen} onClose={closeModal} editRule={editTarget} refs={props} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this rule?"
        body="This rule will no longer run. This can't be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
