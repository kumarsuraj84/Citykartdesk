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
import type { RuleCondition, RuleConditionField, RuleConditionOperator, RuleConditionsLogic } from '@/lib/rules/evaluate'
import type { RuleAction } from '@/lib/rules/actions'
import { flattenLeafOptions } from '@/lib/forms/options'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ROLE_LABELS } from '@/lib/constants/roles'
import type { ServiceFormFieldRef } from '@/lib/forms/sections'
import type { Profile, FormFieldType, FormFieldOption, UserRole } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

type Ref = { id: string; name: string }
type SubCatRef = Ref & { category_id: string }
type ProfileRef = Pick<Profile, 'id' | 'full_name' | 'role'>

export type RuleFormFieldRef = ServiceFormFieldRef

type BusinessRuleRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  trigger: ('created' | 'updated' | 'schedule')[]
  schedule_check: 'sla_pct_elapsed' | 'unassigned_minutes' | null
  schedule_threshold: number | null
  conditions: RuleCondition[]
  conditions_logic: RuleConditionsLogic
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
  // Agent-tier only (agent/manager/admin/platform_owner) — for the "Assign to"
  // action's picker. Distinct from `profiles` (the Requester condition's
  // picker), which deliberately stays unfiltered.
  agents: ProfileRef[]
  departments: Ref[]
  locations: Ref[]
  designations: Ref[]
  functions: Ref[]
  projects: Ref[]
  templates: Ref[]
  formFields: RuleFormFieldRef[]
  legacyRulesAvailable: boolean
}

// ── Reference vocab ──────────────────────────────────────────────────────────

const TRIGGER_LABELS = { created: 'Created', updated: 'Edited', schedule: 'On a schedule' } as const
const TRIGGER_BADGE: Record<string, string> = {
  created: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  updated: 'bg-blue-50 text-blue-700 border-blue-100',
  schedule: 'bg-violet-50 text-violet-700 border-violet-100',
}

const REQUEST_FIELD_OPTIONS: { value: RuleConditionField; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'service_id', label: 'Service' },
  { value: 'category_id', label: 'Category' },
  { value: 'sub_category_id', label: 'Sub Category' },
  { value: 'template_id', label: 'Template' },
  { value: 'team_id', label: 'Team' },
  { value: 'project_id', label: 'Project' },
  { value: 'assigned_to', label: 'Technician' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'source_channel', label: 'Source' },
  { value: 'is_sla_breached', label: 'SLA Breached' },
  { value: 'has_attachment', label: 'Has Attachment' },
  { value: 'age_days', label: 'Age (days)' },
]

const REQUESTER_FIELD_OPTIONS: { value: RuleConditionField; label: string }[] = [
  { value: 'requester_id', label: 'Requester' },
  { value: 'requester_role', label: 'Requester Role' },
  { value: 'requester_department_id', label: 'Requester Department' },
  { value: 'requester_location_id', label: 'Requester Location' },
  { value: 'requester_designation_id', label: 'Requester Designation' },
  { value: 'requester_function_id', label: 'Requester Function' },
]

const FORM_FIELD_PREFIX = 'form:'

function encodeFieldSelection(condition: RuleCondition): string {
  return condition.field === 'form_field' ? `${FORM_FIELD_PREFIX}${condition.form_field_id ?? ''}` : condition.field
}

const OPERATOR_OPTIONS: { value: RuleConditionOperator; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
]

const ACTION_TYPE_LABELS: Record<RuleAction['type'], string> = {
  assign: 'Assign to',
  set_priority: 'Set priority',
  set_status: 'Set status',
  set_team: 'Route to team',
  notify: 'Notify',
}

const NOTIFY_ROLE_OPTIONS: UserRole[] = ['manager', 'admin', 'platform_owner']

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

const SOURCE_CHANNEL_OPTIONS = [
  { value: 'portal', label: 'Portal' },
  { value: 'intake', label: 'Intake' },
]

function conditionValueOptions(field: RuleConditionField, refs: BusinessRulesClientProps): { value: string; label: string }[] | null {
  if (field === 'priority') return Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))
  if (field === 'status') return Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
  if (field === 'service_id') return refs.services.map((s) => ({ value: s.id, label: s.name }))
  if (field === 'category_id') return refs.categories.map((c) => ({ value: c.id, label: c.name }))
  if (field === 'sub_category_id') return refs.subCategories.map((c) => ({ value: c.id, label: c.name }))
  if (field === 'template_id') return refs.templates.map((t) => ({ value: t.id, label: t.name }))
  if (field === 'team_id') return refs.teams.map((t) => ({ value: t.id, label: t.name }))
  if (field === 'project_id') return refs.projects.map((p) => ({ value: p.id, label: p.name }))
  if (field === 'assigned_to') return refs.agents.map((p) => ({ value: p.id, label: p.full_name }))
  if (field === 'requester_id') return refs.profiles.map((p) => ({ value: p.id, label: p.full_name }))
  if (field === 'requester_role') return (Object.keys(ROLE_LABELS) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))
  if (field === 'requester_department_id') return refs.departments.map((d) => ({ value: d.id, label: d.name }))
  if (field === 'requester_location_id') return refs.locations.map((l) => ({ value: l.id, label: l.name }))
  if (field === 'requester_designation_id') return refs.designations.map((d) => ({ value: d.id, label: d.name }))
  if (field === 'requester_function_id') return refs.functions.map((f) => ({ value: f.id, label: f.name }))
  if (field === 'source_channel') return SOURCE_CHANNEL_OPTIONS
  if (field === 'is_sla_breached' || field === 'has_attachment') return YES_NO_OPTIONS
  return null // title/description/age_days — free text/number input
}

// 'toggle' is intentionally excluded — FieldRenderer.tsx has no case for it
// (falls through to `default: return null`), so a service form field of that
// type never actually renders or collects a value; a rule condition built
// against it would be permanently unsatisfiable.
const BOOLEAN_FIELD_TYPES: FormFieldType[] = ['checkbox']
const OPTION_FIELD_TYPES: FormFieldType[] = ['select', 'multiselect', 'radio']
const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

function formFieldValueOptions(field: RuleFormFieldRef): { value: string; label: string }[] | null {
  if (BOOLEAN_FIELD_TYPES.includes(field.type)) return YES_NO_OPTIONS
  if (OPTION_FIELD_TYPES.includes(field.type)) return flattenLeafOptions(field.options)
  return null // text/textarea/number/date/email/phone/file — free input
}

/** Summarizes a rule's per-condition AND/OR connectors for the card list —
 *  "all"/"any" when every connector agrees, "mixed" when it's a real
 *  sum-of-products (some AND, some OR). See matchesConditions() in evaluate.ts. */
function summarizeConditionLogic(rule: BusinessRuleRow): 'all' | 'any' | 'mixed' {
  const connectors = rule.conditions.slice(1).map((c) => c.logic ?? rule.conditions_logic)
  if (connectors.every((l) => l === 'AND')) return 'all'
  if (connectors.every((l) => l === 'OR')) return 'any'
  return 'mixed'
}

function formFieldInputType(field: RuleFormFieldRef): string {
  if (field.type === 'number') return 'number'
  if (field.type === 'date') return 'date'
  return 'text'
}

// "is"/"is not" accept several values in the UI. One value is stored as plain
// equals/not_equals (so existing rules and single-value rules are unchanged);
// two or more are stored as in/not_in with an array value.
const MULTI_OPERATOR: Partial<Record<RuleConditionOperator, RuleConditionOperator>> = { equals: 'in', not_equals: 'not_in' }

function uiOperator(c: RuleCondition): RuleConditionOperator {
  if (c.operator === 'in') return 'equals'
  if (c.operator === 'not_in') return 'not_equals'
  return c.operator
}

function selectedValues(c: RuleCondition): string[] {
  if (Array.isArray(c.value)) return c.value
  return typeof c.value === 'string' && c.value ? [c.value] : []
}

function withValues(c: RuleCondition, op: RuleConditionOperator, values: string[]): RuleCondition {
  const multi = MULTI_OPERATOR[op]
  if (multi && values.length > 1) return { ...c, operator: multi, value: values }
  return { ...c, operator: op, value: values[0] ?? null }
}

function ConditionRow({
  condition,
  isFirst,
  onChange,
  onRemove,
  refs,
}: {
  condition: RuleCondition
  isFirst: boolean
  onChange: (c: RuleCondition) => void
  onRemove: () => void
  refs: BusinessRulesClientProps
}) {
  const operator = uiOperator(condition)
  const needsValue = operator !== 'is_empty' && operator !== 'is_not_empty'
  const allowsMultiple = operator === 'equals' || operator === 'not_equals'
  const formField = condition.field === 'form_field' ? refs.formFields.find((f) => f.id === condition.form_field_id) : undefined
  const options = condition.field === 'form_field'
    ? (formField ? formFieldValueOptions(formField) : null)
    : conditionValueOptions(condition.field, refs)

  const formFieldsByService = new Map<string, RuleFormFieldRef[]>()
  for (const f of refs.formFields) {
    const list = formFieldsByService.get(f.serviceName) ?? []
    list.push(f)
    formFieldsByService.set(f.serviceName, list)
  }

  // Grouped, searchable field picker — group headers are non-leaf entries
  // (SearchableSelect renders those as disabled section labels).
  const fieldOptions: FormFieldOption[] = [
    { value: 'group:request', label: 'Request', children: REQUEST_FIELD_OPTIONS.map((f) => ({ value: f.value, label: f.label })) },
    { value: 'group:requester', label: 'Requester', children: REQUESTER_FIELD_OPTIONS.map((f) => ({ value: f.value, label: f.label })) },
    ...[...formFieldsByService.entries()].map(([serviceName, fields]) => ({
      value: `group:svc:${serviceName}`,
      label: serviceName,
      children: fields.map((f) => ({ value: `${FORM_FIELD_PREFIX}${f.id}`, label: f.label })),
    })),
  ]

  function handleFieldChange(raw: string) {
    if (raw.startsWith(FORM_FIELD_PREFIX)) {
      onChange({ field: 'form_field', form_field_id: raw.slice(FORM_FIELD_PREFIX.length), operator: 'equals', value: null })
    } else {
      onChange({ field: raw as RuleConditionField, operator: condition.operator, value: null })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {isFirst ? (
        <span className="w-14 shrink-0" />
      ) : (
        <div className="flex w-14 shrink-0 overflow-hidden rounded-md border border-border text-[11px] font-semibold">
          {(['AND', 'OR'] as const).map((logic) => (
            <button
              key={logic}
              type="button"
              onClick={() => onChange({ ...condition, logic })}
              className={cn(
                'flex-1 py-1.5 transition-colors',
                (condition.logic ?? 'AND') === logic
                  ? 'bg-primary/10 text-primary'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              {logic}
            </button>
          ))}
        </div>
      )}
      <SearchableSelect
        options={fieldOptions}
        value={encodeFieldSelection(condition)}
        onChange={handleFieldChange}
        placeholder="Search fields…"
        className="min-w-[160px] flex-1 basis-[160px]"
      />
      {/* Fixed width, not flex-1 — a native <select> won't shrink gracefully
          like the Combobox-based fields do; sharing flex-1 with them squeezes
          this down to just the arrow with the selected label invisible. */}
      <select
        value={operator}
        onChange={(e) => onChange(withValues(condition, e.target.value as RuleConditionOperator, selectedValues(condition)))}
        className={cn(selectCls, 'w-40 shrink-0')}
      >
        {OPERATOR_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {needsValue && (
        options && allowsMultiple ? (
          <SearchableSelect
            multiple
            options={options}
            value={selectedValues(condition)}
            onChange={(values) => onChange(withValues(condition, operator, values))}
            placeholder="Select one or more…"
            className="min-w-[160px] flex-1 basis-[160px]"
          />
        ) : options ? (
          <SearchableSelect
            options={options}
            value={typeof condition.value === 'string' ? condition.value : ''}
            onChange={(v) => onChange({ ...condition, value: v })}
            placeholder="Search…"
            className="min-w-[160px] flex-1 basis-[160px]"
          />
        ) : (
          <input
            type={condition.field === 'form_field' && formField ? formFieldInputType(formField) : condition.field === 'age_days' ? 'number' : 'text'}
            value={typeof condition.value === 'string' ? condition.value : ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder={condition.field === 'age_days' ? 'Days…' : 'Text…'}
            className={cn(inputCls, 'min-w-[160px] flex-1 basis-[160px]')}
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
    else if (type === 'set_team') onChange({ type: 'set_team', params: { teamId: '' } })
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
          <SearchableSelect
            multiple
            options={refs.agents.map((p) => ({ value: p.id, label: `${p.full_name} (${ROLE_LABELS[p.role]})` }))}
            value={action.params.assigneeIds}
            onChange={(next) => onChange({ type: 'assign', params: { ...action.params, assigneeIds: next } })}
            placeholder="Search agents…"
          />
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

      {action.type === 'set_team' && (
        <div className="space-y-1.5">
          <select
            value={action.params.teamId}
            onChange={(e) => onChange({ type: 'set_team', params: { teamId: e.target.value } })}
            className={selectCls}
          >
            <option value="" disabled>Select a team…</option>
            {refs.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Moves the ticket to this Team without changing its Service — for splitting one Service&apos;s tickets across several sub-teams by Category (e.g. via a Sub Category condition above), so only that sub-team sees it in their Team Queue.
          </p>
        </div>
      )}

      {action.type === 'notify' && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-3">
            {NOTIFY_ROLE_OPTIONS.map((role) => (
              <label key={role} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={action.params.roles.includes(role)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...action.params.roles, role] : action.params.roles.filter((r) => r !== role)
                    onChange({ type: 'notify', params: { ...action.params, roles: next } })
                  }}
                />
                {ROLE_LABELS[role]}
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
              Technician
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
      trigger: rule.trigger.length > 0 ? rule.trigger : ['created'],
      schedule_check: rule.schedule_check,
      schedule_threshold: rule.schedule_threshold,
      conditions: rule.conditions ?? [],
      conditions_logic: rule.conditions_logic ?? 'AND',
      actions: rule.actions ?? [],
      execution_order: rule.execution_order,
    }
  }
  return {
    name: '',
    description: '',
    is_active: true,
    trigger: ['created'],
    schedule_check: null,
    schedule_threshold: null,
    conditions: [],
    conditions_logic: 'AND',
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
    const logic: RuleConditionsLogic | undefined = form.conditions.length > 0 ? 'AND' : undefined
    set('conditions', [...form.conditions, { field: 'priority', operator: 'equals', value: null, logic }])
  }
  function addAction() {
    set('actions', [...form.actions, { type: 'assign', params: { strategy: 'direct', assigneeIds: [] } }])
  }

  function toggleTrigger(t: 'created' | 'updated' | 'schedule') {
    setForm((prev) => {
      const has = prev.trigger.includes(t)
      if (has && prev.trigger.length === 1) return prev // at least one trigger required
      const nextTrigger = has ? prev.trigger.filter((x) => x !== t) : [...prev.trigger, t]
      const stillScheduled = nextTrigger.includes('schedule')
      return {
        ...prev,
        trigger: nextTrigger,
        schedule_check: stillScheduled ? prev.schedule_check : null,
        schedule_threshold: stillScheduled ? prev.schedule_threshold : null,
      }
    })
  }

  function submit() {
    if (!form.name.trim()) { setError('Rule name is required.'); return }
    if (form.trigger.length === 0) { setError('Pick at least one trigger.'); return }
    if (form.trigger.includes('schedule') && (!form.schedule_check || form.schedule_threshold == null)) {
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
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">{editRule ? 'Edit Business Rule' : 'New Business Rule'}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 px-4 py-4">
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
            <p className="mb-1.5 text-xs text-muted-foreground">Pick one or more — no need to duplicate a rule per trigger.</p>
            <div className="flex gap-2">
              {(['created', 'updated', 'schedule'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={form.trigger.includes(t)}
                  onClick={() => toggleTrigger(t)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    form.trigger.includes(t) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  )}
                >
                  {TRIGGER_LABELS[t]}
                </button>
              ))}
            </div>
            {form.trigger.includes('updated') && (
              <p className="mt-1.5 text-xs text-muted-foreground">&quot;Edited&quot; fires after a status change or priority change.</p>
            )}
          </div>

          {form.trigger.includes('schedule') && (
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
              {form.conditions.length === 0
                ? 'No conditions — matches every request.'
                : form.conditions.length === 1
                ? 'This condition must match.'
                : 'Each condition combines with the one above it — AND groups tighter than OR, so "X AND Y OR A AND B" means (X AND Y) OR (A AND B).'}
            </p>
            <div className="space-y-2">
              {form.conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  isFirst={i === 0}
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

        <div className="shrink-0 border-t border-border px-4 py-3 flex gap-3 justify-end">
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
          {rule.trigger.map((t) => (
            <span key={t} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', TRIGGER_BADGE[t])}>
              {TRIGGER_LABELS[t]}
              {t === 'schedule' && rule.schedule_check ? ` · ${rule.schedule_check === 'sla_pct_elapsed' ? `${rule.schedule_threshold}% SLA` : `${rule.schedule_threshold}m unassigned`}` : ''}
            </span>
          ))}
          <span className="text-sm font-semibold text-foreground truncate">{rule.name}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {rule.conditions.length === 0
            ? 'Matches every request'
            : `${rule.conditions.length} condition${rule.conditions.length === 1 ? '' : 's'}${rule.conditions.length > 1 ? ` (${summarizeConditionLogic(rule)})` : ''}`}
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
        <button onClick={onDelete} className="rounded-lg border border-border p-1.5 text-red-600/70 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors" title="Delete rule" aria-label="Delete rule">
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
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl">
        <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4">{body}</p>
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
