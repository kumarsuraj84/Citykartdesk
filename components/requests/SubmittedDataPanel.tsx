'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2 } from 'lucide-react'
import { FieldGrid, SectionBlock, getDefaultValue } from '@/components/forms/DynamicForm'
import type { FieldValue } from '@/components/forms/DynamicForm'
import { validateFields } from '@/lib/validation/formFields'
import { updateRequestFormData } from '@/lib/actions/requests'
import type { FormField, FormSection } from '@/types'

// ── Read-only field display (unchanged from the original inline version) ──────

export function displayFieldValue(field: FormField, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '—'
  if (field.type === 'checkbox') return raw ? 'Yes' : 'No'
  if (field.type === 'multiselect' && Array.isArray(raw)) {
    const labels = (raw as string[]).map((v) => {
      const opt = field.options?.find((o) => o.value === v)
      return opt?.label ?? v
    })
    return labels.length > 0 ? labels.join(', ') : '—'
  }
  if (field.type === 'select' || field.type === 'radio') {
    const opt = field.options?.find((o) => o.value === String(raw))
    return opt?.label ?? String(raw)
  }
  return String(raw)
}

function FieldRow({ field, data }: { field: FormField; data: Record<string, unknown> }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{field.label}</dt>
      <dd className="text-right text-xs font-medium text-foreground whitespace-pre-wrap break-words">
        {displayFieldValue(field, data[field.id])}
      </dd>
    </div>
  )
}

interface SubmittedDataPanelProps {
  requestId: string
  sections: FormSection[]
  legacySchema: FormField[]
  data: Record<string, unknown>
  /** Agents/managers only — everyone else sees the read-only display with no Edit affordance. */
  canEdit: boolean
}

// ── SubmittedDataPanel: section-aware, backward-compatible, editable ──────────
// Read-only by default (same layout as before); an agent on this request's
// team can switch to an inline edit form pre-filled with the current values.
// File-type fields are excluded from editing — those live in
// request_attachments, not form_data, same exclusion the original submission
// form (DynamicForm) applies.

export function SubmittedDataPanel({ requestId, sections, legacySchema, data, canEdit }: SubmittedDataPanelProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const hasSections = sections.length > 0
  const allFields: FormField[] = hasSections
    ? [...sections].sort((a, b) => a.order - b.order).flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
    : [...legacySchema].sort((a, b) => a.order - b.order)
  const editableFields = allFields.filter((f) => f.type !== 'file')

  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(editableFields.map((f) => [f.id, (data[f.id] as FieldValue | undefined) ?? getDefaultValue(f)]))
  )

  if (!hasSections && legacySchema.length === 0) return null

  function handleChange(fieldId: string, val: FieldValue) {
    setValues((prev) => ({ ...prev, [fieldId]: val }))
    if (errors[fieldId]) setErrors((prev) => ({ ...prev, [fieldId]: '' }))
  }

  function startEdit() {
    setValues(Object.fromEntries(editableFields.map((f) => [f.id, (data[f.id] as FieldValue | undefined) ?? getDefaultValue(f)])))
    setErrors({})
    setServerError(null)
    setEditing(true)
  }

  function handleSave() {
    const newErrors = validateFields(editableFields, values)
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setServerError(null)
    startTransition(async () => {
      const result = await updateRequestFormData(requestId, JSON.stringify(values))
      if (result.error) {
        setServerError(result.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Submitted Information
        </h3>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      {serverError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {serverError}
        </div>
      )}

      {editing ? (
        <div className="space-y-6 rounded-lg border border-border p-4">
          {hasSections ? (
            [...sections]
              .sort((a, b) => a.order - b.order)
              .map((section) => (
                <SectionBlock
                  key={section.id}
                  section={{ ...section, fields: section.fields.filter((f) => f.type !== 'file') }}
                  values={values}
                  errors={errors}
                  onChange={handleChange}
                />
              ))
          ) : (
            <FieldGrid fields={editableFields} values={values} errors={errors} onChange={handleChange} />
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => { setEditing(false); setErrors({}); setServerError(null) }}
              disabled={isPending}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="btn-gradient flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {isPending ? (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>) : 'Save changes'}
            </button>
          </div>
        </div>
      ) : hasSections ? (
        // ── Section-grouped display ───────────────────────────────────────────
        <div className="space-y-3">
          {[...sections]
            .sort((a, b) => a.order - b.order)
            .filter((s) => s.fields.length > 0)
            .map((section) => (
              <div key={section.id} className="rounded-lg border border-border">
                <div className="border-b border-border bg-muted/30 px-4 py-2">
                  <p className="text-xs font-semibold text-foreground">{section.title}</p>
                  {section.description && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {section.description}
                    </p>
                  )}
                </div>
                <dl className="divide-y divide-border">
                  {[...section.fields]
                    .sort((a, b) => a.order - b.order)
                    .map((field) => (
                      <FieldRow key={field.id} field={field} data={data} />
                    ))}
                </dl>
              </div>
            ))}
        </div>
      ) : (
        // ── Legacy flat display ───────────────────────────────────────────────
        <dl className="rounded-lg border border-border divide-y divide-border">
          {[...legacySchema]
            .sort((a, b) => a.order - b.order)
            .map((field) => (
              <FieldRow key={field.id} field={field} data={data} />
            ))}
        </dl>
      )}
    </div>
  )
}
