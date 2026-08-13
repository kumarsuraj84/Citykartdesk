'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { FieldRenderer } from '@/components/forms/FieldRenderer'
import { getDefaultValue } from '@/components/forms/DynamicForm'
import type { FieldValue } from '@/components/forms/DynamicForm'
import { validateFieldValue } from '@/lib/validation/formFields'
import { updateRequestFormData } from '@/lib/actions/requests'
import { displayFieldValue } from './SubmittedDataPanel'
import type { FormField } from '@/types'

interface SubmittedFieldRowProps {
  requestId: string
  field: FormField
  value: unknown
  canEdit: boolean
}

// A single submitted-form field, editable in place — same popover pattern as
// the sidebar's Service row (click the value, edit in an overlay, Save/Cancel)
// rather than the Details tab's whole-form editor, so correcting one field
// (e.g. Mobile Number) doesn't require opening every other field at once.

export function SubmittedFieldRow({ requestId, field, value, canEdit }: SubmittedFieldRowProps) {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(value)
  const [draft, setDraft] = useState<FieldValue>((cur as FieldValue | undefined) ?? getDefaultValue(field))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Select/multiselect fields render their option list via a Base UI portal
    // appended to <body>, outside this popover's own DOM subtree — a click on
    // an option is technically "outside" `ref.current`, so without this
    // exclusion every option click would close the popover before the
    // selection could register.
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-base-ui-portal]')) return
      if (ref.current && !ref.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function openEditor() {
    setDraft((cur as FieldValue | undefined) ?? getDefaultValue(field))
    setError(null)
    setOpen(true)
  }

  function handleSave() {
    const err = validateFieldValue(field, draft)
    if (err) { setError(err); return }
    setError(null)
    startTransition(async () => {
      const result = await updateRequestFormData(requestId, JSON.stringify({ [field.id]: draft }))
      if (result.error) { setError(result.error); return }
      setCur(draft)
      setOpen(false)
    })
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="shrink-0 text-[11px] text-muted-foreground w-20">{field.label}</span>
      <div ref={ref} className="relative min-w-0">
        <button
          type="button"
          onClick={() => canEdit && (open ? setOpen(false) : openEditor())}
          className={`flex items-center gap-1 ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
          title={error ?? undefined}
        >
          <span className={`text-xs text-right ${error ? 'text-destructive' : 'text-foreground'}`}>
            {displayFieldValue(field, cur)}
          </span>
          {canEdit && !isPending && <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {isPending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-xl">
            <FieldRenderer
              field={field}
              value={draft}
              onChange={(val) => { setDraft(val); if (error) setError(null) }}
              error={error ?? undefined}
            />
            <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="btn-gradient px-2.5 py-1 text-[11px] disabled:opacity-50"
              >
                {isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
