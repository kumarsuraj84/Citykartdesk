'use client'

import { useState } from 'react'
import { createEscalationRule, updateEscalationRule, deleteEscalationRule } from '@/lib/actions/admin/config'

type EscalationRule = {
  id: string
  name: string
  tier: string
  trigger_pct: number
  notify_roles: string[]
}

// Must match the requests.priority enum ('low' | 'medium' | 'high' | 'urgent') — the
// runtime evaluator in app/api/escalation/run/route.ts matches a rule's tier against a
// request's priority with a strict string compare, so any tier outside this set can
// never fire.
const TIERS = ['urgent', 'high', 'medium', 'low']

export function EscalationRulesClient({ initialRules }: { initialRules: EscalationRule[] }) {
  const [rules, setRules] = useState<EscalationRule[]>(initialRules)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<EscalationRule>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [form, setForm] = useState({ name: '', tier: 'high', trigger_pct: 80, notify_roles: 'manager' })
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  function startEdit(rule: EscalationRule) {
    setEditing(rule.id)
    setEditDraft({ ...rule, notify_roles: rule.notify_roles })
    setError('')
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    const result = await updateEscalationRule(id, {
      name: editDraft.name,
      tier: editDraft.tier,
      trigger_pct: editDraft.trigger_pct,
      notify_roles: editDraft.notify_roles,
    })
    setSaving(false)
    if (result.error) { setError(result.error); return }
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...editDraft } as EscalationRule : r)))
    setEditing(null)
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    const result = await deleteEscalationRule(id)
    setDeleting(null)
    setConfirmDelete(null)
    if (result.error) { setError(result.error); return }
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  async function handleAdd() {
    if (!form.name.trim()) { setAddError('Name is required.'); return }
    setAdding(true)
    setAddError('')
    const roles = form.notify_roles.split(',').map((r) => r.trim()).filter(Boolean)
    const result = await createEscalationRule({ ...form, notify_roles: roles })
    setAdding(false)
    if (result.error) { setAddError(result.error); return }
    setRules((prev) => [...prev, { id: crypto.randomUUID(), ...form, notify_roles: roles }])
    setForm({ name: '', tier: 'high', trigger_pct: 80, notify_roles: 'manager' })
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_100px_100px_1fr_140px] border-b border-border bg-muted/30 px-4 py-2.5 gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tier</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trigger %</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notify Roles</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</span>
        </div>
        {rules.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">No escalation rules configured.</div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className="grid grid-cols-[1fr_100px_100px_1fr_140px] items-center border-b border-border/50 last:border-0 px-4 py-3 gap-3">
            {editing === rule.id ? (
              <>
                <input
                  type="text"
                  value={editDraft.name ?? ''}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <select
                  value={editDraft.tier ?? 'high'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, tier: e.target.value }))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={editDraft.trigger_pct ?? 75}
                  onChange={(e) => setEditDraft((d) => ({ ...d, trigger_pct: Number(e.target.value) }))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm w-20"
                />
                <input
                  type="text"
                  value={(editDraft.notify_roles ?? []).join(', ')}
                  onChange={(e) => setEditDraft((d) => ({ ...d, notify_roles: e.target.value.split(',').map((r) => r.trim()).filter(Boolean) }))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(rule.id)}
                    disabled={saving}
                    className="btn-gradient"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} className="text-xs text-muted-foreground hover:underline">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="text-sm text-foreground">{rule.name}</span>
                <span className="text-sm text-muted-foreground capitalize">{rule.tier}</span>
                <span className="text-sm text-muted-foreground">{rule.trigger_pct}%</span>
                <span className="text-sm text-muted-foreground">{rule.notify_roles.join(', ')}</span>
                <div className="flex gap-2 items-center">
                  <button onClick={() => startEdit(rule)} className="text-xs text-primary hover:underline">Edit</button>
                  {confirmDelete === rule.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        disabled={deleting === rule.id}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deleting === rule.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(rule.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Add Escalation Rule</h3>
        {addError && <p className="text-xs text-red-600">{addError}</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Urgent Warning"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm w-44"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tier</label>
            <select
              value={form.tier}
              onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Trigger %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.trigger_pct}
              onChange={(e) => setForm((f) => ({ ...f, trigger_pct: Number(e.target.value) }))}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm w-24"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notify Roles (comma-sep)</label>
            <input
              type="text"
              value={form.notify_roles}
              onChange={(e) => setForm((f) => ({ ...f, notify_roles: e.target.value }))}
              placeholder="manager, admin"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm w-44"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding}
            className="btn-gradient"
          >
            {adding ? 'Adding…' : 'Add Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
