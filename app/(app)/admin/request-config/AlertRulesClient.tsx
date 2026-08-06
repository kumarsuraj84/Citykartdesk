'use client'

import { useState, useTransition } from 'react'
import {
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  type AlertRuleData,
} from '@/lib/actions/admin/config'

type AlertRule = {
  id: string
  name: string
  alert_type: string
  entity_type: string
  threshold_minutes: number | null
  notify_roles: string[]
  notify_assignee: boolean
  notify_requester: boolean
  channels: string[]
  is_active: boolean
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  unassigned: 'Unassigned',
  sla_warning: 'SLA Warning',
  sla_breached: 'SLA Breached',
  daily_digest: 'Daily Digest',
}

const ALERT_TYPE_COLORS: Record<string, string> = {
  due_soon: 'bg-warning/10 text-warning border-warning/20',
  overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  unassigned: 'bg-warning/10 text-warning border-warning/20',
  sla_warning: 'bg-info/10 text-info border-info/20',
  sla_breached: 'bg-destructive/10 text-destructive border-destructive/20',
  daily_digest: 'bg-primary/10 text-primary border-primary/20',
}

const BLANK_FORM: Omit<AlertRuleData, 'is_active'> = {
  name: '',
  alert_type: 'due_soon',
  entity_type: 'task',
  threshold_minutes: null,
  notify_roles: ['manager'],
  notify_assignee: true,
  notify_requester: false,
  channels: ['in_app'],
}

function RolesInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const all = ['admin', 'manager', 'agent', 'requester']
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((r) => (
        <label key={r} className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(r)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))
            }
            className="rounded"
          />
          <span className="capitalize">{r}</span>
        </label>
      ))}
    </div>
  )
}

function ChannelsInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const all = ['in_app', 'email']
  return (
    <div className="flex gap-3">
      {all.map((c) => (
        <label key={c} className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(c)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))
            }
            className="rounded"
          />
          <span className="capitalize">{c === 'in_app' ? 'In-App' : 'Email'}</span>
        </label>
      ))}
    </div>
  )
}

function AlertRuleForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: Omit<AlertRuleData, 'is_active'>
  onSubmit: (data: AlertRuleData) => Promise<void>
  onCancel: () => void
  submitLabel: string
}) {
  const [form, setForm] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await onSubmit({ ...form, is_active: true })
      // onSubmit handles closing
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Alert rule name"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Alert Type</label>
          <select
            value={form.alert_type}
            onChange={(e) => set('alert_type', e.target.value as AlertRuleData['alert_type'])}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {Object.entries(ALERT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Entity</label>
          <select
            value={form.entity_type}
            onChange={(e) => set('entity_type', e.target.value as 'request' | 'task')}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="task">Task</option>
            <option value="request">Request</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Threshold (minutes)
          </label>
          <input
            type="number"
            min={0}
            value={form.threshold_minutes ?? ''}
            onChange={(e) =>
              set('threshold_minutes', e.target.value ? parseInt(e.target.value) : null)
            }
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. 1440"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">Notify Options</label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.notify_assignee}
              onChange={(e) => set('notify_assignee', e.target.checked)}
              className="rounded"
            />
            Notify Assignee
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.notify_requester}
              onChange={(e) => set('notify_requester', e.target.checked)}
              className="rounded"
            />
            Notify Requester
          </label>
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Notify Roles</label>
          <div className="mt-1">
            <RolesInput value={form.notify_roles} onChange={(v) => set('notify_roles', v)} />
          </div>
        </div>

        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Channels</label>
          <div className="mt-1">
            <ChannelsInput value={form.channels} onChange={(v) => set('channels', v)} />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="btn-soft"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn-gradient"
        >
          {pending ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  )
}

export function AlertRulesClient({ initialRules }: { initialRules: AlertRule[] }) {
  const [rules, setRules] = useState<AlertRule[]>(initialRules)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function handleCreate(data: AlertRuleData) {
    const result = await createAlertRule(data)
    if (result.error) throw new Error(result.error)
    // Optimistic: re-fetch would normally happen via revalidation. Add placeholder.
    setRules((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...data,
        threshold_minutes: data.threshold_minutes ?? null,
        is_active: true,
      },
    ])
    setShowAdd(false)
  }

  async function handleUpdate(id: string, data: AlertRuleData) {
    const result = await updateAlertRule(id, data)
    if (result.error) throw new Error(result.error)
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...data } : r))
    )
    setEditingId(null)
  }

  function handleToggle(id: string, currentActive: boolean) {
    startTransition(async () => {
      const result = await toggleAlertRule(id, !currentActive)
      if (!result.error) {
        setRules((prev) =>
          prev.map((r) => (r.id === id ? { ...r, is_active: !currentActive } : r))
        )
      }
    })
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this alert rule?')) return
    startTransition(async () => {
      const result = await deleteAlertRule(id)
      if (!result.error) {
        setRules((prev) => prev.filter((r) => r.id !== id))
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_120px_80px_120px_120px_80px_80px] border-b border-border bg-muted/30 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entity</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Threshold</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notify Roles</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active</span>
        </div>

        {rules.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No alert rules configured.
          </div>
        )}

        {rules.map((rule) =>
          editingId === rule.id ? (
            <div key={rule.id} className="border-b border-border/50 last:border-0 p-4">
              <AlertRuleForm
                initial={{
                  name: rule.name,
                  alert_type: rule.alert_type as AlertRuleData['alert_type'],
                  entity_type: rule.entity_type as 'request' | 'task',
                  threshold_minutes: rule.threshold_minutes,
                  notify_roles: rule.notify_roles,
                  notify_assignee: rule.notify_assignee,
                  notify_requester: rule.notify_requester,
                  channels: rule.channels,
                }}
                onSubmit={(data) => handleUpdate(rule.id, data)}
                onCancel={() => setEditingId(null)}
                submitLabel="Update"
              />
            </div>
          ) : (
            <div
              key={rule.id}
              className="grid grid-cols-[1fr_120px_80px_120px_120px_80px_80px] items-center border-b border-border/50 last:border-0 px-4 py-3 gap-2"
            >
              <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>

              <span
                className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  ALERT_TYPE_COLORS[rule.alert_type] ?? 'bg-muted text-muted-foreground border-border'
                }`}
              >
                {ALERT_TYPE_LABELS[rule.alert_type] ?? rule.alert_type}
              </span>

              <span className="text-xs text-muted-foreground capitalize">{rule.entity_type}</span>

              <span className="text-xs text-muted-foreground">
                {rule.threshold_minutes != null ? `${rule.threshold_minutes}m` : '—'}
              </span>

              <div className="flex flex-wrap gap-1">
                {(rule.notify_roles ?? []).map((r) => (
                  <span
                    key={r}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize"
                  >
                    {r}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-1">
                {(rule.channels ?? []).map((c) => (
                  <span
                    key={c}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {c === 'in_app' ? 'In-App' : c}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(rule.id, rule.is_active)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    rule.is_active ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                  aria-label={rule.is_active ? 'Deactivate' : 'Activate'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform ${
                      rule.is_active ? 'translate-x-[18px]' : ''
                    }`}
                  />
                </button>

                <button
                  onClick={() => setEditingId(rule.id)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit"
                >
                  Edit
                </button>

                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  aria-label="Delete"
                >
                  Del
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {showAdd ? (
        <AlertRuleForm
          initial={BLANK_FORM}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
          submitLabel="Add Rule"
        />
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full"
        >
          + Add Alert Rule
        </button>
      )}
    </div>
  )
}
