'use client'

import { SearchableSelect } from '@/components/ui/searchable-select'
import { PendingFileField } from '@/components/forms/PendingFileField'
import type { FormField } from '@/types'

interface FieldRendererProps {
  field: FormField
  value: string | string[] | boolean | File[]
  onChange: (value: string | string[] | boolean | File[]) => void
  error?: string
  /** Visible but not editable — used when a requester can view a field but
   *  requester_can_set is false. */
  disabled?: boolean
}

// Which field types are "compact" — can sit side-by-side
export function isShortField(type: FormField['type']): boolean {
  return ['text', 'number', 'date', 'select', 'email', 'phone'].includes(type)
}

export function FieldRenderer({ field, value, onChange, error, disabled }: FieldRendererProps) {
  const inputCls = [
    'w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground',
    'placeholder:text-muted-foreground/50',
    'transition-colors',
    error
      ? 'border-destructive focus-visible:ring-destructive/20'
      : 'border-border hover:border-ring/50 focus-visible:border-ring',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20',
    disabled && 'opacity-50 cursor-not-allowed hover:border-border',
  ].join(' ')

  const renderInput = () => {
    switch (field.type) {
      case 'text':
      case 'number':
        return (
          <input
            type={field.type}
            id={field.id}
            placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}…`}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
            min={field.validation?.min}
            max={field.validation?.max}
            disabled={disabled}
          />
        )

      case 'email':
        return (
          <input
            type="email"
            id={field.id}
            placeholder={field.placeholder ?? 'name@company.com'}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
            disabled={disabled}
          />
        )

      case 'phone':
        return (
          <input
            type="tel"
            inputMode="numeric"
            id={field.id}
            placeholder={field.placeholder ?? '9876543210'}
            value={value as string}
            // Digits only, no country code, capped at 10 — matches PHONE_REGEX
            // in lib/validation/formFields.ts. Filtered on keystroke rather
            // than left to submit-time validation so invalid characters and
            // over-length input are never enterable in the first place.
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
            maxLength={10}
            className={inputCls}
            disabled={disabled}
          />
        )

      case 'textarea':
        return (
          <textarea
            id={field.id}
            placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}…`}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className={`${inputCls} resize-none leading-relaxed`}
            disabled={disabled}
          />
        )

      case 'date':
        return (
          <input
            type="date"
            id={field.id}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
            disabled={disabled}
          />
        )

      case 'select':
        return (
          <SearchableSelect
            id={field.id}
            options={field.options ?? []}
            value={value as string}
            onChange={onChange}
            placeholder={field.placeholder ?? `Search ${field.label.toLowerCase()}…`}
            className={error ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
            disabled={disabled}
          />
        )

      case 'multiselect':
        return (
          <SearchableSelect
            id={field.id}
            multiple
            options={field.options ?? []}
            value={value as string[]}
            onChange={onChange}
            placeholder={field.placeholder ?? `Search ${field.label.toLowerCase()}…`}
            className={error ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
            disabled={disabled}
          />
        )

      case 'checkbox':
        return (
          <label className={[
            'inline-flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors select-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            (value as boolean)
              ? 'border-ring bg-ring/5 text-foreground font-medium'
              : 'border-border hover:border-ring/50 text-muted-foreground hover:text-foreground',
          ].join(' ')}>
            <input
              type="checkbox"
              id={field.id}
              checked={value as boolean}
              onChange={(e) => onChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-primary shrink-0"
              disabled={disabled}
            />
            {field.placeholder ?? field.label}
          </label>
        )

      case 'radio':
        return (
          <div className="grid grid-cols-2 gap-2">
            {field.options?.map((opt) => {
              const checked = (value as string) === opt.value
              return (
                <label
                  key={opt.value}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors select-none',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    checked
                      ? 'border-ring bg-ring/5 text-foreground font-medium'
                      : 'border-border hover:border-ring/50 text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name={field.id}
                    value={opt.value}
                    checked={checked}
                    onChange={() => onChange(opt.value)}
                    className="h-3.5 w-3.5 accent-primary shrink-0"
                    disabled={disabled}
                  />
                  {opt.label}
                </label>
              )
            })}
          </div>
        )

      case 'file':
        return (
          <PendingFileField
            id={field.id}
            value={(value as File[] | undefined) ?? []}
            onChange={onChange}
            disabled={disabled}
          />
        )

      default:
        return null
    }
  }

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1">
        {renderInput()}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={field.id} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {/* Suppressed when disabled (requester viewing a read-only-to-them
         *  field) — required-but-disabled means it's the technician's
         *  responsibility, not something this viewer can act on. */}
        {field.required && !disabled && <span className="mr-0.5 text-destructive">*</span>}
        {field.label}
      </label>
      {renderInput()}
      {field.help_text && !error && (
        <p className="text-[11px] text-muted-foreground">{field.help_text}</p>
      )}
      {error && <p className="text-[11px] text-destructive font-medium">{error}</p>}
    </div>
  )
}
