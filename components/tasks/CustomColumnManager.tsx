'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, X, ChevronDown, Type, Hash, Calendar, List,
  CheckSquare, LayoutList, Trash2, Settings2, GripVertical,
} from 'lucide-react'
import { createCustomField, updateCustomField, deleteCustomField } from '@/lib/actions/tasks'
import type { CustomField, CustomFieldType, CustomFieldOption } from '@/types'

// ── Field type config ─────────────────────────────────────────────────────────

const FIELD_TYPES: { value: CustomFieldType; label: string; Icon: React.ElementType; description: string }[] = [
  { value: 'text',        label: 'Text',        Icon: Type,        description: 'Short text entry' },
  { value: 'number',      label: 'Number',      Icon: Hash,        description: 'Numeric value' },
  { value: 'date',        label: 'Date',        Icon: Calendar,    description: 'Date picker' },
  { value: 'dropdown',    label: 'Dropdown',    Icon: List,        description: 'Single select from options' },
  { value: 'multi_select',label: 'Multi-select',Icon: LayoutList,  description: 'Multiple selections' },
  { value: 'checkbox',    label: 'Checkbox',    Icon: CheckSquare, description: 'True / false toggle' },
]

const OPTION_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#64748b',
]

// ── Add-column modal ──────────────────────────────────────────────────────────

function AddColumnModal({
  teamId,
  onDone,
  onClose,
}: {
  teamId: string
  onDone: (field: CustomField) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'type' | 'config'>('type')
  const [fieldType, setFieldType] = useState<CustomFieldType>('text')
  const [name, setName] = useState('')
  const [options, setOptions] = useState<CustomFieldOption[]>([
    { value: 'Option 1', color: OPTION_COLORS[0] },
    { value: 'Option 2', color: OPTION_COLORS[1] },
  ])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'config') nameRef.current?.focus()
  }, [step])

  function addOption() {
    setOptions((prev) => [
      ...prev,
      { value: `Option ${prev.length + 1}`, color: OPTION_COLORS[prev.length % OPTION_COLORS.length] },
    ])
  }

  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateOptionValue(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => idx === i ? { ...o, value } : o))
  }

  function updateOptionColor(i: number, color: string) {
    setOptions((prev) => prev.map((o, idx) => idx === i ? { ...o, color } : o))
  }

  function handleCreate() {
    if (!name.trim()) { setError('Field name is required.'); return }
    const needsOptions = fieldType === 'dropdown' || fieldType === 'multi_select'
    if (needsOptions && options.filter(o => o.value.trim()).length === 0) {
      setError('Add at least one option.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createCustomField({
        teamId,
        name: name.trim(),
        fieldType,
        options: needsOptions ? options.filter(o => o.value.trim()) : undefined,
      })
      if (result.error) { setError(result.error); return }
      onDone({
        id: result.data!.id,
        team_id: teamId,
        name: name.trim(),
        field_type: fieldType,
        options: needsOptions ? options.filter(o => o.value.trim()) : null,
        position: 0,
        created_by: null,
        created_at: new Date().toISOString(),
      })
    })
  }

  const needsOptions = fieldType === 'dropdown' || fieldType === 'multi_select'

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[420px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {step === 'type' ? 'Choose field type' : 'Configure field'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Pick type */}
        {step === 'type' && (
          <div className="p-4 grid grid-cols-2 gap-2">
            {FIELD_TYPES.map(({ value, label, Icon, description }) => (
              <button
                key={value}
                onClick={() => { setFieldType(value); setStep('config') }}
                className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-background p-3.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-3.5 w-3.5 text-foreground" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">{label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{description}</p>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'config' && (
          <div className="p-5 space-y-4">
            {/* Back + type pill */}
            <div className="flex items-center gap-2">
              <button onClick={() => setStep('type')} className="btn-ghost">← Back</button>
              <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                {FIELD_TYPES.find(f => f.value === fieldType)?.label}
              </span>
            </div>

            {/* Field name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Field name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !needsOptions) handleCreate() }}
                placeholder={`e.g. ${fieldType === 'dropdown' ? 'Function' : fieldType === 'date' ? 'Target date' : 'Notes'}`}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Dropdown/multi-select options */}
            {needsOptions && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Options</label>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {/* Color dot */}
                      <div className="relative group/color">
                        <div
                          className="h-5 w-5 shrink-0 rounded-full cursor-pointer border-2 border-white shadow-sm"
                          style={{ background: opt.color ?? '#6366f1' }}
                        />
                        <select
                          value={opt.color ?? '#6366f1'}
                          onChange={(e) => updateOptionColor(i, e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full"
                        >
                          {OPTION_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <input
                        value={opt.value}
                        onChange={(e) => updateOptionValue(i, e.target.value)}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <button onClick={() => removeOption(i)} className="shrink-0 text-muted-foreground/50 hover:text-red-500 transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addOption}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add option
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={isPending || !name.trim()}
                className="btn-gradient flex-1"
              >
                {isPending ? 'Creating…' : 'Create field'}
              </button>
              <button onClick={onClose} className="btn-soft">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Edit-field modal ──────────────────────────────────────────────────────────

function EditFieldModal({
  field,
  onDone,
  onDelete,
  onClose,
}: {
  field: CustomField
  onDone: (updated: Partial<CustomField>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(field.name)
  const [options, setOptions] = useState<CustomFieldOption[]>(field.options ?? [])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const needsOptions = field.field_type === 'dropdown' || field.field_type === 'multi_select'

  function addOption() {
    setOptions(prev => [...prev, { value: `Option ${prev.length + 1}`, color: OPTION_COLORS[prev.length % OPTION_COLORS.length] }])
  }
  function removeOption(i: number) { setOptions(prev => prev.filter((_, idx) => idx !== i)) }
  function updateOptionValue(i: number, value: string) { setOptions(prev => prev.map((o, idx) => idx === i ? { ...o, value } : o)) }
  function updateOptionColor(i: number, color: string) { setOptions(prev => prev.map((o, idx) => idx === i ? { ...o, color } : o)) }

  function handleSave() {
    if (!name.trim()) { setError('Name required.'); return }
    startTransition(async () => {
      const result = await updateCustomField(field.id, {
        name: name.trim(),
        ...(needsOptions ? { options: options.filter(o => o.value.trim()) } : {}),
      })
      if (result.error) { setError(result.error); return }
      onDone({ name: name.trim(), options: needsOptions ? options : field.options })
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteCustomField(field.id)
      onDelete()
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[380px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Edit field</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Field name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>

          {needsOptions && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Options</label>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="relative">
                      <div className="h-5 w-5 shrink-0 rounded-full cursor-pointer border-2 border-white shadow-sm" style={{ background: opt.color ?? '#6366f1' }} />
                      <select value={opt.color ?? '#6366f1'} onChange={e => updateOptionColor(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer w-full">
                        {OPTION_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <input value={opt.value} onChange={e => updateOptionValue(i, e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                    <button onClick={() => removeOption(i)} className="text-muted-foreground/50 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <button onClick={addOption} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80">
                <Plus className="h-3.5 w-3.5" /> Add option
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleSave} disabled={isPending}
              className="btn-gradient flex-1">
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={handleDelete} disabled={isPending}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-800">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Main exported component ───────────────────────────────────────────────────

interface CustomColumnManagerProps {
  teamId: string
  fields: CustomField[]
  onFieldsChange: (fields: CustomField[]) => void
}

export function CustomColumnManager({ teamId, fields, onFieldsChange }: CustomColumnManagerProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [editField, setEditField] = useState<CustomField | null>(null)

  function handleAdded(field: CustomField) {
    onFieldsChange([...fields, field])
    setShowAdd(false)
  }

  function handleEdited(fieldId: string, updates: Partial<CustomField>) {
    onFieldsChange(fields.map(f => f.id === fieldId ? { ...f, ...updates } : f))
    setEditField(null)
  }

  function handleDeleted(fieldId: string) {
    onFieldsChange(fields.filter(f => f.id !== fieldId))
    setEditField(null)
  }

  return (
    <>
      {/* Manage existing columns (gear icon per column — rendered from table header) */}
      {editField && (
        <EditFieldModal
          field={editField}
          onDone={(updates) => handleEdited(editField.id, updates)}
          onDelete={() => handleDeleted(editField.id)}
          onClose={() => setEditField(null)}
        />
      )}

      {/* Add column button + modal */}
      <button
        onClick={() => setShowAdd(true)}
        title="Add custom column"
        className="flex items-center gap-1 rounded-lg border border-dashed border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add column
      </button>

      {showAdd && (
        <AddColumnModal teamId={teamId} onDone={handleAdded} onClose={() => setShowAdd(false)} />
      )}
    </>
  )
}

// Export so TaskTable can trigger edit from column header
export { EditFieldModal }
export type { CustomField }
