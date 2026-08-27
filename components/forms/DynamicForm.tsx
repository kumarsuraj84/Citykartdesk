'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Send, UserSearch, X } from 'lucide-react'
import { FieldRenderer, isShortField } from './FieldRenderer'
import { createRequest, searchOrgMembers } from '@/lib/actions/requests'
import { uploadAttachment } from '@/lib/actions/attachments'
import { validateFields } from '@/lib/validation/formFields'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import type { FormField, FormSection, ServiceWithRelations } from '@/types'

interface DynamicFormProps {
  service: ServiceWithRelations
  /** Agents/managers only — lets them raise this request for someone else. */
  canBookOnBehalf?: boolean
}

type OrgMember = { id: string; full_name: string }

// ── "Book on behalf of" picker ─────────────────────────────────────────────────
// Same debounced-search-then-pick pattern as RequestSidebarPanel's Collaborators
// picker (searchOrgMembers is shared with that feature).
function RequesterOnBehalfPicker({ value, onChange }: { value: OrgMember | null; onChange: (m: OrgMember | null) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OrgMember[]>([])
  const [searching, setSearching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  useEffect(() => {
    const q = query.trim()
    let cancelled = false
    const t = setTimeout(async () => {
      if (!q) { setResults([]); setSearching(false); return }
      setSearching(true)
      const found = await searchOrgMembers(q)
      if (!cancelled) { setResults(found); setSearching(false) }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="mb-1.5 text-xs font-medium text-foreground">Requesting on behalf of</p>
      {value ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-1.5">
          <span className="text-sm text-foreground">{value.full_name}</span>
          <button type="button" onClick={() => onChange(null)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:border-ring/50 hover:text-foreground"
          >
            <UserSearch className="h-3.5 w-3.5" />
            Search a person… (leave empty to request for yourself)
          </button>
          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg">
              <div className="border-b border-border px-2 py-1.5">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {!query.trim() ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Type a name to search</p>
                ) : searching ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
                ) : (
                  results.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { onChange(m); setOpen(false); setQuery('') }}
                      className="flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-muted transition-colors"
                    >
                      {m.full_name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export type FieldValue = string | string[] | boolean | File[]

export function getDefaultValue(field: FormField): FieldValue {
  switch (field.type) {
    case 'multiselect':
    case 'file':        return []
    case 'checkbox':    return false
    default:            return ''
  }
}

function flattenSections(sections: FormSection[]): FormField[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => [...s.fields].sort((a, b) => a.order - b.order))
}

// ── Smart field row renderer ──────────────────────────────────────────────────
// Pairs adjacent short fields (text/date/select/number) into 2-column rows.
// Full-width fields (textarea, multiselect, radio, checkbox) always get their own row.

interface FieldGridProps {
  fields: FormField[]
  values: Record<string, FieldValue>
  errors: Record<string, string>
  onChange: (fieldId: string, val: FieldValue) => void
}

export function FieldGrid({ fields, values, errors, onChange }: FieldGridProps) {
  // Build rows by pairing consecutive short fields
  const rows: FormField[][] = []
  let i = 0
  while (i < fields.length) {
    const f = fields[i]
    if (isShortField(f.type) && i + 1 < fields.length && isShortField(fields[i + 1].type)) {
      rows.push([f, fields[i + 1]])
      i += 2
    } else {
      rows.push([f])
      i++
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((row, ri) => (
        <div
          key={ri}
          className={row.length === 2 ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-1'}
        >
          {row.map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={values[field.id] ?? getDefaultValue(field)}
              onChange={(val) => onChange(field.id, val)}
              error={errors[field.id]}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Section block ─────────────────────────────────────────────────────────────

interface SectionBlockProps {
  section: FormSection
  values: Record<string, FieldValue>
  errors: Record<string, string>
  onChange: (fieldId: string, val: FieldValue) => void
}

export function SectionBlock({ section, values, errors, onChange }: SectionBlockProps) {
  const fields = [...section.fields].sort((a, b) => a.order - b.order)
  if (fields.length === 0) return null

  return (
    <div>
      {section.title && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {section.title}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      {section.description && (
        <p className="mb-4 text-xs text-muted-foreground">{section.description}</p>
      )}
      <FieldGrid fields={fields} values={values} errors={errors} onChange={onChange} />
    </div>
  )
}

// ── DynamicForm ───────────────────────────────────────────────────────────────

export function DynamicForm({ service, canBookOnBehalf }: DynamicFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [attachmentWarning, setAttachmentWarning] = useState<string | null>(null)
  const [createdRequestId, setCreatedRequestId] = useState<string | null>(null)
  const [onBehalfOf, setOnBehalfOf] = useState<OrgMember | null>(null)

  // A tagged template is always section-based (it never has a legacy flat
  // shape) — an untagged/legacy service keeps rendering flat, header-less
  // fields exactly as before if it never migrated to sections either.
  const hasSections = service.template
    ? true
    : Array.isArray(service.form_sections) && service.form_sections.length > 0

  const sections = resolveServiceFormSections(service)
  const allFields: FormField[] = flattenSections(sections)

  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(allFields.map((f) => [f.id, getDefaultValue(f)]))
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleChange(fieldId: string, val: FieldValue) {
    setValues((prev) => ({ ...prev, [fieldId]: val }))
    if (errors[fieldId]) setErrors((prev) => ({ ...prev, [fieldId]: '' }))
  }

  function validate(): boolean {
    const newErrors = validateFields(allFields, values)
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setServerError(null)
    setAttachmentWarning(null)

    // File-type field values are File[] — they can't be JSON-serialized into
    // form_data, and request_attachments.request_id is a NOT NULL FK, so files
    // can only be uploaded once the request row exists. Strip them out here and
    // upload them in a follow-up step after createRequest returns a real id.
    const fileFields = allFields.filter((f) => f.type === 'file')
    const submittableValues: Record<string, FieldValue> = { ...values }
    for (const f of fileFields) delete submittableValues[f.id]

    const formData = new FormData()
    formData.set('service_id', service.id)
    formData.set('form_data', JSON.stringify(submittableValues))
    if (onBehalfOf) formData.set('requester_id', onBehalfOf.id)

    startTransition(async () => {
      const result = await createRequest(formData)
      if (result.error) {
        setServerError(result.error)
        return
      }
      if (!result.requestId) return

      const pendingFiles = fileFields.flatMap((f) => (values[f.id] as File[] | undefined) ?? [])
      if (pendingFiles.length === 0) {
        router.push(`/requests/${result.requestId}`)
        return
      }

      const failures: string[] = []
      for (const file of pendingFiles) {
        const fd = new FormData()
        fd.append('file', file)
        const uploadResult = await uploadAttachment(result.requestId, fd)
        if (uploadResult.error) failures.push(`${file.name}: ${uploadResult.error}`)
      }

      if (failures.length > 0) {
        setCreatedRequestId(result.requestId)
        setAttachmentWarning(
          `Request created, but ${failures.length} attachment${failures.length === 1 ? '' : 's'} failed to upload — ${failures.join('; ')}. You can retry from the request page.`
        )
      } else {
        router.push(`/requests/${result.requestId}`)
      }
    })
  }

  const isEmpty = allFields.length === 0

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {serverError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <span className="shrink-0">⚠</span>
          {serverError}
        </div>
      )}

      {attachmentWarning && createdRequestId && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          <div className="flex items-start gap-2">
            <span className="shrink-0">⚠</span>
            {attachmentWarning}
          </div>
          <Link
            href={`/requests/${createdRequestId}`}
            className="self-start text-xs font-semibold underline underline-offset-2"
          >
            Continue to request →
          </Link>
        </div>
      )}

      {canBookOnBehalf && (
        <RequesterOnBehalfPicker value={onBehalfOf} onChange={setOnBehalfOf} />
      )}

      {isEmpty ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No additional information required for this service.
        </p>
      ) : hasSections ? (
        <div className="space-y-8">
          {[...sections]
            .sort((a, b) => a.order - b.order)
            .map((section) => (
              <SectionBlock
                key={section.id}
                section={section}
                values={values}
                errors={errors}
                onChange={handleChange}
              />
            ))}
        </div>
      ) : (
        <FieldGrid
          fields={[...allFields].sort((a, b) => a.order - b.order)}
          values={values}
          errors={errors}
          onChange={handleChange}
        />
      )}

      {/* Submit row */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> Required fields
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="btn-gradient flex items-center gap-2 disabled:opacity-50"
        >
          {isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…</>
            : <><Send className="h-3.5 w-3.5" /> Submit Request</>
          }
        </button>
      </div>
    </form>
  )
}
