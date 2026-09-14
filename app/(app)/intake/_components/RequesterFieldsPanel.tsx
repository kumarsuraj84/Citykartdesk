'use client'

// Renders exactly the requester-mandatory fields Email Intake's entity
// autofill couldn't resolve (or resolved to an invalid value) for the
// currently-selected service — driven entirely by
// validateRequesterFormCompletion()'s own missingFields/invalidFields output
// (lib/requests/validate-requester-form-completion.ts), the same function
// createRequestCore() uses as its authoritative gate. This is deliberately a
// small, intake-scoped renderer (not a reuse of components/forms/
// FieldRenderer.tsx, which is tightly coupled to the web DynamicForm's own
// state/upload flow) — but the field TYPES, LABELS, and REQUIRED-NESS it
// renders always come from the service's real form definition
// (resolveServiceFormSections()), never a parallel Email-Intake-specific
// field list.
import type { FormField } from '@/types'

type Issue = { key: string; label: string; message?: string }

const inputCls = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none transition focus:border-indigo-300'

export function RequesterFieldsPanel({
  fields,
  issues,
  values,
  onChange,
}: {
  /** The service's full requester-visible field list (used to look up type/
   *  options/label for each issue below). */
  fields: FormField[]
  /** Which of those fields are currently missing or invalid. */
  issues: Issue[]
  values: Record<string, unknown>
  onChange: (fieldId: string, value: unknown) => void
}) {
  if (issues.length === 0) return null

  return (
    <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        Required Request Details
      </p>
      <p className="text-[11px] text-amber-700">
        This service requires the information below before a ticket can be created — the email didn&apos;t provide it.
      </p>
      {issues.map((issue) => {
        const field = fields.find((f) => f.id === issue.key)
        if (!field) return null
        return (
          <div key={field.id}>
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              {field.label} <span className="text-rose-500">*</span>
            </label>
            <FieldInput field={field} value={values[field.id]} onChange={(v) => onChange(field.id, v)} />
            {issue.message && <p className="mt-0.5 text-[10px] text-rose-600">{issue.message}</p>}
          </div>
        )
      })}
    </div>
  )
}

function FieldInput({
  field, value, onChange,
}: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={field.placeholder}
          className={`${inputCls} resize-none`}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={field.placeholder}
          className={inputCls}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )
    case 'email':
      return (
        <input
          type="email"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? 'name@example.com'}
          className={inputCls}
        />
      )
    case 'phone':
      return (
        <input
          type="tel"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? '10-digit number'}
          className={inputCls}
        />
      )
    case 'select':
    case 'radio':
      return (
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">Select…</option>
          {(field.options ?? []).filter((o) => o.is_active !== false).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).filter((o) => o.is_active !== false).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={`rounded-full border px-2 py-1 text-[11px] font-medium transition ${
                selected.includes(o.value)
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )
    }
    case 'checkbox':
    case 'toggle':
      return (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {field.placeholder ?? field.help_text ?? 'Yes'}
        </label>
      )
    // 'text' and any unrecognized type fall through to a plain text input.
    // 'store_address' never reaches here (validateRequesterFormCompletion()
    // exempts it — always system-populated) and 'file' required-ness stays
    // client-side-only per Stage 1 (see that function's own doc comment), so
    // neither type is ever present in `issues`.
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={inputCls}
        />
      )
  }
}
