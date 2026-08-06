'use client'

import { useState } from 'react'
import { Plus, Trash2, Pencil, Power } from 'lucide-react'
import {
  createIntakeRule, updateIntakeRule, deleteIntakeRule, setIntakeRuleEnabled,
  type IntakeRule, type RuleInput, type IntakeWorkType, type IntakePriority, type RuleMatchField,
} from '@/lib/actions/intake/rules'

const FIELDS: RuleMatchField[] = ['both', 'subject', 'text', 'sender', 'all']
const WORK_TYPES: IntakeWorkType[] = ['request', 'task', 'approval', 'informational', 'ignore']

type Option = { value: string; label: string }
export type MasterData = {
  departments: string[]
  categories: Option[]
  subcategories: (Option & { categorySlug: string | null })[]
  priorities: Option[]
}

// The form works on a flat string-friendly draft; converted to RuleInput on save.
type Draft = {
  name: string; enabled: boolean; match_field: RuleMatchField; keywords: string; regex: string
  type: '' | IntakeWorkType; department: string; category: string; subcategory: string
  priority: '' | IntakePriority; weight: number
}

const EMPTY: Draft = {
  name: '', enabled: true, match_field: 'both', keywords: '', regex: '',
  type: '', department: '', category: '', subcategory: '', priority: '', weight: 8,
}

function toDraft(r: IntakeRule): Draft {
  return {
    name: r.name, enabled: r.enabled, match_field: r.match_field,
    keywords: r.match_keywords.join(', '), regex: r.match_regex ?? '',
    type: r.output_type ?? '', department: r.output_department ?? '',
    category: r.output_category ?? '', subcategory: r.output_subcategory ?? '',
    priority: r.output_priority ?? '', weight: r.weight,
  }
}

function toInput(d: Draft): RuleInput {
  return {
    name: d.name, enabled: d.enabled, match_field: d.match_field,
    match_keywords: d.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    match_regex: d.regex.trim() || null,
    output_type: d.type || null, output_department: d.department.trim() || null,
    output_category: d.category.trim() || null, output_subcategory: d.subcategory.trim() || null,
    output_priority: d.priority || null, weight: d.weight,
  }
}

function outcomeSummary(r: IntakeRule): string {
  const parts = [
    r.output_type && `type → ${r.output_type}`,
    r.output_department && `dept → ${r.output_department}`,
    r.output_category && `category → ${r.output_category}`,
    r.output_subcategory && `sub → ${r.output_subcategory}`,
    r.output_priority && `priority → ${r.output_priority}`,
  ].filter(Boolean)
  return parts.join(' · ') || '—'
}

const inputCls = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-ring'
const labelCls = 'text-xs font-medium text-muted-foreground mb-1 block'

function RuleForm({ draft, onChange, onSave, onCancel, saving, submitLabel, master }: {
  draft: Draft
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  submitLabel: string
  master: MasterData
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  // Subcategory (service) options are scoped to the chosen category when one is set.
  const subOptions = draft.category
    ? master.subcategories.filter((s) => s.categorySlug === draft.category)
    : master.subcategories
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Rule name</label>
          <input className={inputCls} value={draft.name} placeholder="e.g. Mail from legal@ → Legal, urgent"
            onChange={(e) => set('name', e.target.value)} />
        </div>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">When the mail matches</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>In field</label>
          <select className={inputCls} value={draft.match_field} onChange={(e) => set('match_field', e.target.value as RuleMatchField)}>
            {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Keywords (comma separated)</label>
          <input className={inputCls} value={draft.keywords} placeholder="invoice, purchase order, gst"
            onChange={(e) => set('keywords', e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <label className={labelCls}>…or regex (optional)</label>
          <input className={`${inputCls} font-mono`} value={draft.regex} placeholder="e.g. (urgent|asap)"
            onChange={(e) => set('regex', e.target.value)} />
        </div>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Then set (any subset)</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Type</label>
          <select className={inputCls} value={draft.type} onChange={(e) => set('type', e.target.value as Draft['type'])}>
            <option value="">— unchanged —</option>
            {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select className={inputCls} value={draft.priority} onChange={(e) => set('priority', e.target.value as Draft['priority'])}>
            <option value="">— unchanged —</option>
            {master.priorities.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Weight (1–10)</label>
          <input type="number" min={1} max={10} className={inputCls} value={draft.weight}
            onChange={(e) => set('weight', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
        </div>
        <div>
          <label className={labelCls}>Department</label>
          <select className={inputCls} value={draft.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">— unchanged —</option>
            {master.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Category</label>
          {/* Changing category clears a now-mismatched subcategory. */}
          <select className={inputCls} value={draft.category}
            onChange={(e) => onChange({ ...draft, category: e.target.value, subcategory: '' })}>
            <option value="">— unchanged —</option>
            {master.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Subcategory</label>
          <select className={inputCls} value={draft.subcategory} onChange={(e) => set('subcategory', e.target.value)}>
            <option value="">— unchanged —</option>
            {subOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onSave} disabled={saving}
          className="rounded-md bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  )
}

export function IntakeRulesClient({ initialRules, master }: { initialRules: IntakeRule[]; master: MasterData }) {
  const [rules, setRules] = useState<IntakeRule[]>(initialRules)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleAdd() {
    setError(''); setSaving(true)
    const res = await createIntakeRule(toInput(addDraft))
    setSaving(false)
    if (res.error) { setError(res.error); return }
    const input = toInput(addDraft)
    setRules((prev) => [{ id: res.id!, ...input } as IntakeRule, ...prev])
    setAddDraft(EMPTY); setAdding(false)
  }

  async function handleSaveEdit(id: string) {
    setError(''); setSaving(true)
    const res = await updateIntakeRule(id, toInput(editDraft))
    setSaving(false)
    if (res.error) { setError(res.error); return }
    const input = toInput(editDraft)
    setRules((prev) => prev.map((r) => (r.id === id ? { id, ...input } as IntakeRule : r)))
    setEditing(null)
  }

  async function handleToggle(r: IntakeRule) {
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))
    const res = await setIntakeRuleEnabled(r.id, !r.enabled)
    if (res.error) {
      setError(res.error)
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: r.enabled } : x)))
    }
  }

  async function handleDelete(id: string) {
    const res = await deleteIntakeRule(id)
    if (res.error) { setError(res.error); return }
    setRules((prev) => prev.filter((r) => r.id !== id))
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {adding ? (
        <RuleForm draft={addDraft} onChange={setAddDraft} onSave={handleAdd} master={master}
          onCancel={() => { setAdding(false); setAddDraft(EMPTY); setError('') }}
          saving={saving} submitLabel="Create rule" />
      ) : (
        <button onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-1.5 text-sm font-medium text-white">
          <Plus className="h-4 w-4" /> New rule
        </button>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-[1fr_1.2fr_70px_120px] gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Rule', 'Outcome', 'Weight', 'Actions'].map((h) => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {rules.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No custom rules yet. They run before the built-in rules and take precedence when they match.
          </div>
        )}

        {rules.map((r) => (
          <div key={r.id} className="border-b border-border last:border-0">
            {editing === r.id ? (
              <div className="p-4">
                <RuleForm draft={editDraft} onChange={setEditDraft} onSave={() => handleSaveEdit(r.id)} master={master}
                  onCancel={() => { setEditing(null); setError('') }} saving={saving} submitLabel="Save changes" />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1.2fr_70px_120px] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className={`truncate text-sm font-medium ${r.enabled ? '' : 'text-muted-foreground line-through'}`}>{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.match_field}: {r.match_keywords.join(', ')}{r.match_regex ? ` /${r.match_regex}/` : ''}
                  </div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{outcomeSummary(r)}</div>
                <div className="text-sm tabular-nums">{r.weight}</div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleToggle(r)} title={r.enabled ? 'Disable' : 'Enable'}
                    className={`rounded p-1.5 hover:bg-muted ${r.enabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    <Power className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditing(r.id); setEditDraft(toDraft(r)); setError('') }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                  {confirmDelete === r.id ? (
                    <>
                      <button onClick={() => handleDelete(r.id)} className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded px-2 py-1 text-xs text-muted-foreground">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(r.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
