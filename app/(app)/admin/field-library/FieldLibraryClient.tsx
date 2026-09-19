'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Link2 } from 'lucide-react'
import {
  createLibraryField,
  updateLibraryField,
  setLibraryFieldActive,
  deleteLibraryField,
  linkDuplicateFieldGroup,
} from '@/lib/actions/admin/field-library'
import { OptionTreeEditor, FIELD_LIBRARY } from '@/components/admin/SectionBuilder'
import { LIBRARY_FIELD_TYPES, isOptionType, type DuplicateGroup } from '@/lib/forms/library'
import type { LibraryFieldRow } from '@/lib/queries/field-library'
import type { FormFieldOption, FormFieldType } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  text: 'Short text', textarea: 'Long text', select: 'Dropdown', multiselect: 'Multi-select',
  number: 'Number', date: 'Date', email: 'Email', phone: 'Phone', file: 'File upload',
}

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60'

function newOptionId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ── Create / edit modal ──────────────────────────────────────────────────────

function FieldModal({ field, onClose }: { field: LibraryFieldRow | null; onClose: () => void }) {
  const isEdit = !!field
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<FormFieldType>(field?.type ?? 'text')
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '')
  const [helpText, setHelpText] = useState(field?.help_text ?? '')
  const [options, setOptions] = useState<FormFieldOption[]>(
    field?.options ?? [{ value: newOptionId(), label: 'Option 1' }, { value: newOptionId(), label: 'Option 2' }]
  )
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, startTransition] = useTransition()
  const typeLocked = isEdit && (field?.used_in.length ?? 0) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const data = { label, type, placeholder, help_text: helpText, options: isOptionType(type) ? options : undefined }
    startTransition(async () => {
      const result = isEdit ? await updateLibraryField(field!.id, data) : await createLibraryField(data)
      if (result.error) {
        setError(result.error)
        return
      }
      if ('updatedTemplates' in result && result.updatedTemplates) {
        setNotice(`Updated ${result.updatedTemplates} template${result.updatedTemplates === 1 ? '' : 's'}.`)
        setTimeout(onClose, 900)
      } else {
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">{isEdit ? 'Edit library field' : 'New library field'}</h2>
        </div>
        <form onSubmit={submit} className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="e.g. Contact Number" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Field type</label>
            <div className="grid grid-cols-3 gap-2">
              {FIELD_LIBRARY.filter((it) => LIBRARY_FIELD_TYPES.includes(it.type)).map((it) => {
                const active = it.type === type
                return (
                  <button
                    key={it.type}
                    type="button"
                    aria-pressed={active}
                    disabled={typeLocked && !active}
                    onClick={() => setType(it.type)}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border bg-muted/40 hover:border-primary/60 hover:bg-primary/5'
                    }`}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-background text-sm font-semibold text-primary shadow-sm">
                      {it.icon}
                    </span>
                    <span className="text-xs font-semibold text-foreground">{it.label}</span>
                    <span className="text-[10px] text-muted-foreground">{it.hint}</span>
                  </button>
                )
              })}
            </div>
            {typeLocked && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Locked — this field is already used in a template.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Placeholder</label>
            <input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} placeholder="Hint shown inside the field" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Help text</label>
            <input value={helpText} onChange={(e) => setHelpText(e.target.value)} placeholder="Extra guidance below the field" className={inputCls} />
          </div>
          {isOptionType(type) && <OptionTreeEditor options={options} onChange={(fn) => setOptions((prev) => fn(prev))} />}
          {isEdit && (field?.used_in.length ?? 0) > 0 && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-foreground">
              Saving updates this field in {field!.used_in.length} template{field!.used_in.length === 1 ? '' : 's'}: {field!.used_in.join(', ')}.
              Already-submitted requests are unaffected.
            </p>
          )}
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
          {notice && <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50">
              {pending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function FieldLibraryClient({
  fields,
  duplicates,
}: {
  fields: LibraryFieldRow[]
  duplicates: DuplicateGroup[]
}) {
  const [modal, setModal] = useState<{ field: LibraryFieldRow | null } | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ error?: string }>, okText?: string) {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setMessage({ kind: 'error', text: result.error })
      else if (okText) setMessage({ kind: 'ok', text: okText })
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button onClick={() => setModal({ field: null })} className="btn-gradient">
          <Plus className="h-4 w-4" />
          New field
        </button>
      </div>

      {message && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${message.kind === 'error' ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
          {message.text}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {fields.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No library fields yet. Create one (e.g. &quot;Contact Number&quot;), or link your existing duplicate fields below.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-semibold">Field</th>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Used in</th>
                <th className="w-32 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {f.label}
                    {!f.is_active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Archived</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABELS[f.type] ?? f.type}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {f.used_in.length === 0 ? '—' : `${f.used_in.length} template${f.used_in.length === 1 ? '' : 's'}: ${f.used_in.join(', ')}`}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1 text-muted-foreground">
                      <button title="Edit" onClick={() => setModal({ field: f })} className="rounded p-1.5 hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        title={f.is_active ? 'Archive (hide from the template picker)' : 'Restore'}
                        disabled={pending}
                        onClick={() => run(() => setLibraryFieldActive(f.id, !f.is_active))}
                        className="rounded p-1.5 hover:bg-muted"
                      >
                        {f.is_active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        title="Delete"
                        disabled={pending}
                        onClick={() => { if (confirm(`Delete "${f.label}" from the library?`)) run(() => deleteLibraryField(f.id)) }}
                        className="rounded p-1.5 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {duplicates.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Duplicate fields across templates</h2>
            <p className="text-xs text-muted-foreground">
              These fields share a name and type but were created separately, so reports show each as its own column. Linking
              keeps every existing answer exactly where it is — only the reports and future edits are unified.
            </p>
          </div>
          <ul className="space-y-2">
            {duplicates.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {g.label} <span className="text-xs font-normal text-muted-foreground">· {TYPE_LABELS[g.type] ?? g.type}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    In {[...new Set(g.instances.map((i) => i.templateName))].join(', ')}
                    {g.existingLibraryId ? ' · will link to the existing library field' : ''}
                  </p>
                  {!g.linkable && <p className="mt-1 text-xs text-amber-700">{g.reason}</p>}
                </div>
                <button
                  disabled={!g.linkable || pending}
                  onClick={() => run(async () => {
                    const r = await linkDuplicateFieldGroup(g.key)
                    return r
                  }, `Linked "${g.label}".`)}
                  className="btn-gradient px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Link to library
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {modal && <FieldModal field={modal.field} onClose={() => setModal(null)} />}
    </div>
  )
}
