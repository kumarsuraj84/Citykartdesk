'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, Loader2, Send, UserSearch, X } from 'lucide-react'
import { FieldRenderer, isShortField } from './FieldRenderer'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { createRequest, searchOrgMembers } from '@/lib/actions/requests'
import { uploadAttachment, confirmRequiredFiles } from '@/lib/actions/attachments'
import { validateFields } from '@/lib/validation/formFields'
import { resolveServiceFormSections, filterFieldsForRequester, filterSectionsForCategory } from '@/lib/forms/sections'
import { useBusy } from '@/lib/ui/busy'
import { useUnsavedGuard } from '@/lib/ui/useUnsavedGuard'
import type { AllowedSubCategory, FormField, FormSection, ServiceWithRelations } from '@/types'

interface DynamicFormProps {
  service: ServiceWithRelations
  /** Agents/managers only — lets them raise this request for someone else. */
  canBookOnBehalf?: boolean
  /** Sub-categories this service is tagged to (grouped by category) — the
   *  requester picks one as a built-in field, separate from the template's
   *  own custom fields. Empty means this service has nothing tagged, so the
   *  picker is skipped entirely. */
  allowedSubCategories: AllowedSubCategory[]
  /** The signed-in user's own store address (from the store master), for
   *  display in any `store_address`-type field — null if they have no
   *  store_id (HO/Warehouse). The server re-derives and enforces this
   *  independently in createRequest(); this is only what's shown while
   *  filling the form. Not re-fetched per "requesting on behalf of"
   *  selection — the server's own value (based on whoever the final
   *  requester is) is always what actually gets saved. */
  currentUserStoreAddress?: string | null
  /** The Active AC numbers of the signed-in user's store (from the AC master sheet), for a dropdown whose options come from the sheet.
   *  undefined = the user has no store, so the typed list of the field is used as it always was. */
  acUnitOptions?: { value: string; label: string }[]
  /** For every category of an active machine program: the machines of the requester's store (empty = none listed). A category not listed has no machine box. Undefined = no store, the typed list is used. */
  programMachineOptions?: Record<string, { value: string; label: string }[]>
}

/** Imperative handle so an external "Recently Used"/"Frequent Issues"
 *  shortcut panel can drive the form's own Category/Sub Category selection —
 *  the exact same state the picker itself sets, not a second parallel one. */
export interface DynamicFormHandle {
  applyCategoryShortcut: (categoryId: string, subCategoryId: string) => void
}

type OrgMember = { id: string; full_name: string }

type UploadItem = { id: number; file: File; status: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string }

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
      try {
        const found = await searchOrgMembers(q)
        if (!cancelled) { setResults(found); setSearching(false) }
      } catch {
        if (!cancelled) { setResults([]); setSearching(false) }
      }
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

export type FieldValue = string | string[] | boolean | File[] | undefined

export function getDefaultValue(field: FormField): FieldValue {
  switch (field.type) {
    case 'multiselect':
    case 'file':        return []
    // Stage 7.1 (F-02): undefined, not false — a mandatory checkbox must
    // require an actual click before it satisfies validation. Returning
    // `false` here made every untouched checkbox indistinguishable from an
    // explicit "No" the instant isFieldValueEmpty() started treating `false`
    // as a real answer. FieldRenderer coerces this to an unchecked box
    // either way, so nothing changes visually.
    case 'checkbox':
    case 'toggle':       return undefined
    default:            return ''
  }
}

/** A dropdown marked "options from the AC sheet" lists the store's Active AC numbers; with no store it keeps its typed list. */
function withAcUnitOptions(sections: FormSection[], opts: { value: string; label: string }[] | undefined): FormSection[] {
  if (!opts) return sections
  return sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => f.options_source === 'ac_units'
      ? { ...f, options: opts, help_text: opts.length === 0 ? 'No active AC is listed for your store in the AC sheet. Please contact the admin team.' : f.help_text }
      : f),
  }))
}

/** A dropdown marked "machines of a Vendor Program": for a category of such a program it lists the store's machines (compulsory when there are some); for any other category it is not shown. */
export function withProgramMachineOptions(sections: FormSection[], byCategory: Record<string, { value: string; label: string }[]> | undefined, categoryId: string | null | undefined): FormSection[] {
  if (!byCategory) return sections
  const opts = categoryId ? byCategory[categoryId] : undefined
  return sections.map((s) => ({
    ...s,
    fields: s.fields.flatMap((f) => {
      if (f.options_source !== 'program_machines') return [f]
      if (!opts) return []
      return [{ ...f, options: opts, required: opts.length > 0, help_text: opts.length === 0 ? 'No machine is listed for your store in the sheet of this service line. Please contact the admin team.' : f.help_text }]
    }),
  }))
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
  /** Set when rendering the requester's own create/view form — disables
   *  fields the requester can see but not set (requester_can_set === false).
   *  Left unset for the technician-editing surfaces (SubmittedDataPanel),
   *  where every visible field stays editable regardless of this flag. */
  requesterContext?: boolean
}

export function FieldGrid({ fields, values, errors, onChange, requesterContext }: FieldGridProps) {
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
          className={row.length === 2 ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'grid grid-cols-1'}
        >
          {row.map((field) => (
            <FieldRenderer
              key={field.id}
              field={field}
              value={values[field.id] ?? getDefaultValue(field)}
              onChange={(val) => onChange(field.id, val)}
              error={errors[field.id]}
              disabled={requesterContext && field.requester_can_set === false}
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
  requesterContext?: boolean
}

export function SectionBlock({ section, values, errors, onChange, requesterContext }: SectionBlockProps) {
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
      <FieldGrid fields={fields} values={values} errors={errors} onChange={onChange} requesterContext={requesterContext} />
    </div>
  )
}

// ── DynamicForm ───────────────────────────────────────────────────────────────

export const DynamicForm = forwardRef<DynamicFormHandle, DynamicFormProps>(function DynamicForm(
  { service, canBookOnBehalf, allowedSubCategories, currentUserStoreAddress, acUnitOptions, programMachineOptions },
  ref
) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  // Set the moment the ticket exists. From then on the form is replaced by a "Request created" screen, so the same
  // request can never be sent a second time from here; it only offers to (re)try the files.
  const [created, setCreated] = useState<{ id: string; no?: string } | null>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  // Labels of required file fields that still have no file on the ticket (B-16: the server cannot check this while the ticket is made, so it is checked after the files were sent)
  const [missingFiles, setMissingFiles] = useState<string[]>([])
  const [onBehalfOf, setOnBehalfOf] = useState<OrgMember | null>(null)

  // Built-in Category / Sub-category — a submission-time field, not inherited
  // from the service, so it lives in its own state separate from `values`
  // (the template's custom fields). Skipped entirely if nothing is tagged.
  const categories = Array.from(
    new Map(allowedSubCategories.map((sc) => [sc.category_id, sc.category_name])).entries()
  ).map(([id, name]) => ({ id, name }))
  const [categoryId, setCategoryId] = useState('')
  const [subCategoryId, setSubCategoryId] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const subCategoriesInCategory = categoryId
    ? allowedSubCategories.filter((sc) => sc.category_id === categoryId)
    : []

  useImperativeHandle(ref, () => ({
    applyCategoryShortcut(nextCategoryId: string, nextSubCategoryId: string) {
      setCategoryId(nextCategoryId)
      setSubCategoryId(nextSubCategoryId)
      setCategoryError(null)
    },
  }), [])

  // A tagged template is always section-based (it never has a legacy flat
  // shape) — an untagged/legacy service keeps rendering flat, header-less
  // fields exactly as before if it never migrated to sections either.
  const hasSections = service.template
    ? true
    : Array.isArray(service.form_sections) && service.form_sections.length > 0

  // Technician-only fields (requester_can_view === false) never reach the
  // requester's create-request form at all — filtered here so they're absent
  // from values/validation/rendering all at once.
  const sectionsForAnyCategory = filterFieldsForRequester(resolveServiceFormSections(service))
  // A field limited to certain categories (for example Qty for fixtures) appears only after one of them is chosen, and is then checked like any other field.
  const sections = withProgramMachineOptions(withAcUnitOptions(filterSectionsForCategory(sectionsForAnyCategory, categoryId), acUnitOptions), programMachineOptions, categoryId)
  const allFields: FormField[] = flattenSections(sections)
  const everyField: FormField[] = flattenSections(sectionsForAnyCategory)

  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(everyField.map((f) =>
      [f.id, f.type === 'store_address' ? (currentUserStoreAddress ?? '') : getDefaultValue(f)]
    ))
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Files are still going up: leaving the page now (closing the tab, clicking a menu link, Back) would leave the ticket without them.
  useUnsavedGuard(uploading, 'Your files are still uploading. If you leave now, they may not be added to the request. Leave anyway?')
  useBusy(uploading)

  function patchUpload(id: number, patch: Partial<UploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }

  // Sends the files one after the other. A file that fails (network drop, too big, server restarted) is marked failed
  // and the rest carry on; nothing thrown here is allowed to escape.
  async function runUploads(requestId: string, items: UploadItem[]) {
    setUploading(true)
    let failedCount = 0
    for (const item of items) {
      patchUpload(item.id, { status: 'uploading', error: undefined })
      try {
        const fd = new FormData()
        fd.append('file', item.file)
        const res = await uploadAttachment(requestId, fd)
        if (res.error) { failedCount++; patchUpload(item.id, { status: 'failed', error: res.error }) }
        else patchUpload(item.id, { status: 'done' })
      } catch {
        failedCount++
        patchUpload(item.id, { status: 'failed', error: 'Could not upload. Check your internet and try again.' })
      }
    }
    // Once the files are sent, ask the server whether a required file is still missing; it leaves a staff-only note and the answer is shown below.
    let missing: string[] = []
    try { missing = (await confirmRequiredFiles(requestId)).missing } catch { /* the check is a safety net: failing to run it must not trap the person on this screen */ }
    setMissingFiles(missing)
    setUploading(false)
    if (failedCount === 0 && missing.length === 0) router.push(`/requests/${requestId}`)
  }

  function retryFailedUploads() {
    if (!created || uploading) return
    const items = uploads.filter((u) => u.status === 'failed')
    if (items.length > 0) void runUploads(created.id, items)
  }

  function handleChange(fieldId: string, val: FieldValue) {
    setValues((prev) => ({ ...prev, [fieldId]: val }))
    if (errors[fieldId]) setErrors((prev) => ({ ...prev, [fieldId]: '' }))
  }

  function validate(): boolean {
    const newErrors = validateFields(allFields, values, 'requester')
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldsValid = validate()
    const categoryValid = allowedSubCategories.length === 0 || Boolean(subCategoryId)
    setCategoryError(categoryValid ? null : 'Category is required.')
    if (!fieldsValid || !categoryValid) return
    setServerError(null)

    // File-type field values are File[] — they can't be JSON-serialized into
    // form_data, and request_attachments.request_id is a NOT NULL FK, so files
    // can only be uploaded once the request row exists. Strip them out here and
    // upload them in a follow-up step after createRequest returns a real id.
    const fileFields = allFields.filter((f) => f.type === 'file')
    const submittableValues: Record<string, FieldValue> = { ...values }
    for (const f of fileFields) delete submittableValues[f.id]
    // answers of fields that do not apply to the chosen category (it may have been changed after typing them) are not sent
    const shown = new Set(allFields.map((f) => f.id))
    for (const f of everyField) if (!shown.has(f.id)) delete submittableValues[f.id]

    const formData = new FormData()
    formData.set('service_id', service.id)
    formData.set('form_data', JSON.stringify(submittableValues))
    if (subCategoryId) formData.set('sub_category_id', subCategoryId)
    if (onBehalfOf) formData.set('requester_id', onBehalfOf.id)

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createRequest>>
      try {
        result = await createRequest(formData)
      } catch {
        // The answer never came back (internet dropped, the server restarted after an update). The ticket may or may not exist,
        // so do not tell the person to just send it again.
        setServerError('We could not confirm that your request was sent. Please look in My Requests before sending it again, so it is not created twice.')
        return
      }
      if (result.error) {
        setServerError(result.error)
        return
      }
      if (!result.requestId) {
        setServerError('We could not confirm that your request was created. Please look in My Requests before sending it again.')
        return
      }

      const pendingFiles = fileFields.flatMap((f) => (values[f.id] as File[] | undefined) ?? [])
      if (pendingFiles.length === 0) {
        // no file was chosen: when the form asked for one anyway (the browser check was bypassed), say so on the "Request created" screen instead of moving on silently
        let missing: string[] = []
        try { missing = (await confirmRequiredFiles(result.requestId)).missing } catch { /* see runUploads */ }
        if (missing.length === 0) {
          router.push(`/requests/${result.requestId}`)
          return
        }
        setMissingFiles(missing)
        setCreated({ id: result.requestId, no: result.requestNo })
        return
      }

      // the ticket exists: switch to the "Request created" screen and send the files from there
      const items: UploadItem[] = pendingFiles.map((file, i) => ({ id: i, file, status: 'waiting' }))
      setCreated({ id: result.requestId, no: result.requestNo })
      setUploads(items)
      void runUploads(result.requestId, items)
    })
  }

  const isEmpty = allFields.length === 0

  if (created) {
    const failed = uploads.filter((u) => u.status === 'failed')
    const doneCount = uploads.filter((u) => u.status === 'done').length
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Request created{created.no ? ` (${created.no})` : ''}</p>
            <p className="text-xs">
              {uploading
                ? `Adding your files (${doneCount} of ${uploads.length} done). Please keep this page open.`
                : failed.length > 0
                  ? `${failed.length} file${failed.length === 1 ? '' : 's'} could not be added. You can try again, or add them later on the request page.`
                  : uploads.length > 0 ? 'Your files were added.' : null}
            </p>
            {!uploading && missingFiles.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                A required file is still missing ({missingFiles.join(', ')}). The team has been told. Please add it on the request page.
              </p>
            )}
          </div>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{u.file.name}</span>
              <span className={`shrink-0 text-xs ${u.status === 'failed' ? 'text-destructive' : u.status === 'done' ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {u.status === 'waiting' && 'Waiting'}
                {u.status === 'uploading' && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</span>}
                {u.status === 'done' && 'Added'}
                {u.status === 'failed' && (u.error ?? 'Failed')}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          {failed.length > 0 && !uploading && (
            <button type="button" onClick={retryFailedUploads} className="btn-gradient">Try the failed files again</button>
          )}
          <Link
            href={`/requests/${created.id}`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {failed.length > 0 && !uploading ? 'Continue without them' : 'Open the request'}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {serverError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <span className="shrink-0">⚠</span>
          {serverError}
        </div>
      )}

      {canBookOnBehalf && (
        <RequesterOnBehalfPicker value={onBehalfOf} onChange={setOnBehalfOf} />
      )}

      {categories.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="mr-0.5 text-destructive">*</span>
              Category
            </label>
            <SearchableSelect
              value={categoryId}
              onChange={(v) => { setCategoryId(v as string); setSubCategoryId(''); if (categoryError) setCategoryError(null) }}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Search category…"
              className={categoryError ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="mr-0.5 text-destructive">*</span>
              Sub Category
            </label>
            <SearchableSelect
              value={subCategoryId}
              onChange={(v) => { setSubCategoryId(v as string); if (categoryError) setCategoryError(null) }}
              options={subCategoriesInCategory.map((sc) => ({ value: sc.id, label: sc.name }))}
              placeholder={categoryId ? 'Search sub category…' : 'Pick a category first'}
              disabled={!categoryId}
              className={categoryError ? 'border-destructive focus-visible:ring-destructive/20' : undefined}
            />
            {categoryError && <p className="text-[11px] font-medium text-destructive">{categoryError}</p>}
          </div>
        </div>
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
                requesterContext
              />
            ))}
        </div>
      ) : (
        <FieldGrid
          fields={[...allFields].sort((a, b) => a.order - b.order)}
          values={values}
          errors={errors}
          onChange={handleChange}
          requesterContext
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
})
