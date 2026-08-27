'use client'

import { useState, useTransition, useCallback, useEffect, useMemo } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { filterActiveOptions } from '@/lib/forms/options'
import type { FormField, FormFieldType, FormFieldOption, FormSection } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SectionBuilderProps {
  /** Display name of the service/template this form belongs to (shown in the empty state). */
  entityName: string
  initialSections: FormSection[]
  /** Persists the edited sections — e.g. `(s) => saveFormSections(serviceId, s)` or
   *  `(s) => saveTemplateSections(templateId, s)`. This component doesn't know or
   *  care which entity it's editing a form for. */
  onSave: (sections: FormSection[]) => Promise<{ error?: string }>
  /** Field ids that have Field SLA Matrix entries configured — deleting one of these
   *  orphans that SLA data (never destroyed, just unreachable), so deletion needs a
   *  warning first instead of disappearing silently. */
  fieldIdsWithSla?: string[]
}

type Selected = { s: string; f: string } | null

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_LIBRARY: { type: FormFieldType; label: string; hint: string; icon: string }[] = [
  { type: 'text',        label: 'Short text',   hint: 'Single line',  icon: 'T'  },
  { type: 'textarea',    label: 'Long text',    hint: 'Paragraph',    icon: '¶'  },
  { type: 'select',      label: 'Dropdown',     hint: 'Pick one',     icon: '▾'  },
  { type: 'multiselect', label: 'Multi-select', hint: 'Pick many',    icon: '☰'  },
  { type: 'number',      label: 'Number',       hint: 'Numeric',      icon: '#'  },
  { type: 'date',        label: 'Date',         hint: 'Calendar',     icon: '◷'  },
  { type: 'email',       label: 'Email',        hint: 'Validated',    icon: '@'  },
  { type: 'phone',       label: 'Phone',        hint: 'Validated',    icon: '☎'  },
  { type: 'file',        label: 'File upload',  hint: 'Attachments',  icon: '⇪'  },
  { type: 'toggle',      label: 'Yes / No',     hint: 'Boolean',      icon: '◐'  },
]

function getLibEntry(type: FormFieldType) {
  return FIELD_LIBRARY.find((x) => x.type === type)
}

// ── ID generator ──────────────────────────────────────────────────────────────

let _seq = 0
function uid() {
  return `${Date.now().toString(36)}_${(++_seq).toString(36)}`
}

function newField(type: FormFieldType): FormField {
  const labels: Partial<Record<FormFieldType, string>> = {
    text:        'Untitled short text',
    textarea:    'Untitled long text',
    select:      'Untitled dropdown',
    multiselect: 'Untitled multi-select',
    number:      'Untitled number',
    date:        'Untitled date',
    email:       'Email address',
    phone:       'Phone number',
    file:        'Attachments',
    toggle:      'Yes or no?',
    checkbox:    'Untitled checkbox',
    radio:       'Untitled radio',
  }
  const needsOptions = type === 'select' || type === 'multiselect'
  return {
    id: uid(),
    type,
    label: labels[type] ?? 'Untitled field',
    required: false,
    order: 0,
    options: needsOptions
      ? [
          { value: uid(), label: 'Option 1' },
          { value: uid(), label: 'Option 2' },
        ]
      : undefined,
  }
}

// ── Option tree helpers ───────────────────────────────────────────────────────

type Path = number[]
type OptTree = FormFieldOption[]

function flattenOpts(
  tree: OptTree,
  depth = 0,
): { node: FormFieldOption; path: Path; depth: number }[] {
  const out: { node: FormFieldOption; path: Path; depth: number }[] = []
  tree.forEach((n, i) => {
    out.push({ node: n, path: [i], depth })
    if (n.children?.length) {
      flattenOpts(n.children, depth + 1).forEach((c) =>
        out.push({ node: c.node, path: [i, ...c.path], depth: c.depth }),
      )
    }
  })
  return out
}

function countLeaves(tree: OptTree): number {
  let n = 0
  for (const node of tree) {
    if (!node.children?.length) n += node.label.trim() ? 1 : 0
    else n += countLeaves(node.children)
  }
  return n
}

function countActiveLeaves(tree: OptTree): number {
  let n = 0
  for (const node of tree) {
    if (node.is_active === false) continue
    if (!node.children?.length) n += node.label.trim() ? 1 : 0
    else n += countActiveLeaves(node.children)
  }
  return n
}

function mapOptTree(
  tree: OptTree,
  path: Path,
  fn: (arr: OptTree) => OptTree,
): OptTree {
  if (path.length === 0) return fn(tree)
  const [head, ...rest] = path
  return tree.map((n, i) =>
    i === head ? { ...n, children: mapOptTree(n.children ?? [], rest, fn) } : n,
  )
}

function updateOptNode(tree: OptTree, path: Path, patch: Partial<FormFieldOption>): OptTree {
  if (!path.length) return tree
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  return mapOptTree(tree, parentPath, (arr) =>
    arr.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
  )
}

function insertOptAfter(tree: OptTree, path: Path, node: FormFieldOption): OptTree {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  return mapOptTree(tree, parentPath, (arr) => {
    const copy = [...arr]
    copy.splice(idx + 1, 0, node)
    return copy
  })
}

function appendOptChild(tree: OptTree, path: Path, node: FormFieldOption): OptTree {
  return mapOptTree(tree, path, (arr) => [...arr, node])
}

function moveOptSibling(tree: OptTree, path: Path, dir: -1 | 1): OptTree {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  return mapOptTree(tree, parentPath, (arr) => {
    const j = idx + dir
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
    return copy
  })
}

function indentOptNode(tree: OptTree, path: Path): OptTree {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  if (idx === 0) return tree
  return mapOptTree(tree, parentPath, (arr) => {
    const node = arr[idx]
    const prev = arr[idx - 1]
    const updatedPrev = { ...prev, children: [...(prev.children ?? []), node] }
    const copy = [...arr]
    copy.splice(idx, 1)
    copy[idx - 1] = updatedPrev
    return copy
  })
}

function outdentOptNode(tree: OptTree, path: Path): OptTree {
  if (path.length < 2) return tree
  const grandparentPath = path.slice(0, -2)
  const parentIdx = path[path.length - 2]
  const idx = path[path.length - 1]
  return mapOptTree(tree, grandparentPath, (arr) => {
    const parent = arr[parentIdx]
    const node = parent.children?.[idx]
    if (!node) return arr
    const newChildren = (parent.children ?? []).filter((_, i) => i !== idx)
    const updatedParent = { ...parent, children: newChildren.length ? newChildren : undefined }
    const copy = [...arr]
    copy[parentIdx] = updatedParent
    copy.splice(parentIdx + 1, 0, node)
    return copy
  })
}

// ── Validation ────────────────────────────────────────────────────────────────

function getValidationErrors(sections: FormSection[]): string[] {
  const errors: string[] = []
  sections.forEach((s) => {
    if (!s.title.trim()) errors.push('A section is missing a title')
    s.fields.forEach((f) => {
      if (!f.label.trim()) errors.push('A field is missing a label')
      if (f.type === 'select' || f.type === 'multiselect') {
        const activeLeaves = countActiveLeaves(f.options ?? [])
        if (activeLeaves < 2)
          errors.push(`"${f.label || 'Field'}" needs at least 2 active (non-archived) selectable options`)
      }
    })
  })
  return Array.from(new Set(errors))
}

// ── Sub-components ────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary placeholder:text-muted-foreground'

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded text-xs disabled:opacity-30 ${
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

// ── OptionTreeEditor ──────────────────────────────────────────────────────────

function OptionTreeEditor({
  options,
  onChange,
}: {
  options: FormFieldOption[]
  onChange: (fn: (tree: OptTree) => OptTree) => void
}) {
  const flat = flattenOpts(options)
  const newOpt = (): FormFieldOption => ({ value: uid(), label: 'New option' })

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Options · hierarchy
        </span>
        <button
          type="button"
          onClick={() =>
            onChange((t) => [
              ...t,
              { value: uid(), label: `Option ${t.length + 1}` },
            ])
          }
          className="text-xs font-medium text-primary hover:underline"
        >
          + Top-level
        </button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Indent an option to make it a child. Parents act as groups; only leaves are selectable.
      </p>
      <ul className="space-y-1">
        {flat.map(({ node, path, depth }) => {
          const hasChildren = !!node.children?.length
          const idx = path[path.length - 1]
          const canIndent = idx > 0
          const canOutdent = path.length > 1
          const archived = node.is_active === false
          return (
            <li
              key={node.value}
              className={`flex items-center gap-1.5 ${archived ? 'opacity-50' : ''}`}
              style={{ paddingLeft: depth * 16 }}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-bold ${
                  hasChildren
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
                title={hasChildren ? 'Group' : 'Selectable option'}
              >
                {hasChildren ? '▾' : '•'}
              </span>
              <input
                value={node.label}
                onChange={(e) =>
                  onChange((t) => updateOptNode(t, path, { label: e.target.value }))
                }
                className={`min-w-0 flex-1 rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:bg-background ${archived ? 'line-through' : ''}`}
                placeholder={hasChildren ? 'Group label' : 'Option label'}
              />
              {archived && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Archived
                </span>
              )}
              <div className="flex items-center gap-0.5 text-muted-foreground">
                <IconBtn title="Move up" onClick={() => onChange((t) => moveOptSibling(t, path, -1))}>↑</IconBtn>
                <IconBtn title="Move down" onClick={() => onChange((t) => moveOptSibling(t, path, 1))}>↓</IconBtn>
                <IconBtn title="Outdent" disabled={!canOutdent} onClick={() => onChange((t) => outdentOptNode(t, path))}>⇤</IconBtn>
                <IconBtn title="Indent" disabled={!canIndent} onClick={() => onChange((t) => indentOptNode(t, path))}>⇥</IconBtn>
                <IconBtn title="Add child" onClick={() => onChange((t) => appendOptChild(t, path, newOpt()))}>+</IconBtn>
                <IconBtn title="Add sibling" onClick={() => onChange((t) => insertOptAfter(t, path, newOpt()))}>↵</IconBtn>
                {archived ? (
                  <IconBtn title="Restore" onClick={() => onChange((t) => updateOptNode(t, path, { is_active: true }))}>↺</IconBtn>
                ) : (
                  <IconBtn title="Archive (cannot be deleted — historical requests may reference it)" danger onClick={() => onChange((t) => updateOptNode(t, path, { is_active: false }))}>⊘</IconBtn>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── PreviewField ──────────────────────────────────────────────────────────────

function renderSelectOptions(tree: OptTree, depth = 0): React.ReactNode[] {
  const out: React.ReactNode[] = []
  tree.forEach((n) => {
    const prefix = depth === 0 ? '' : `${'  '.repeat(depth)}↳ `
    if (n.children?.length) {
      out.push(
        <option key={n.value} disabled className="font-semibold">
          {prefix}{n.label}
        </option>,
      )
      out.push(...renderSelectOptions(n.children, depth + 1))
    } else {
      out.push(
        <option key={n.value} value={n.value}>
          {prefix}{n.label}
        </option>,
      )
    }
  })
  return out
}

function MultiSelectTree({ tree, depth = 0 }: { tree: OptTree; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'mt-1 space-y-1 border-l border-border pl-3'}>
      {tree.map((n) => (
        <li key={n.value}>
          {n.children?.length ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {n.label}
              </div>
              <MultiSelectTree tree={n.children} depth={depth + 1} />
            </>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-3.5 w-3.5" />
              {n.label}
            </label>
          )}
        </li>
      ))}
    </ul>
  )
}

function PreviewField({ field }: { field: FormField }) {
  const base =
    'w-full rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary focus:bg-background'
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium">
        {field.label || 'Untitled'}
        {field.required && <span className="text-destructive">*</span>}
      </span>
      {field.type === 'textarea' && (
        <textarea rows={3} placeholder={field.placeholder} className={base} />
      )}
      {field.type === 'text' && <input placeholder={field.placeholder} className={base} />}
      {field.type === 'email' && (
        <input type="email" placeholder={field.placeholder ?? 'name@company.com'} className={base} />
      )}
      {field.type === 'phone' && (
        <input type="tel" placeholder={field.placeholder ?? '+1 555 123 4567'} className={base} />
      )}
      {field.type === 'number' && (
        <input type="number" placeholder={field.placeholder} className={base} />
      )}
      {field.type === 'date' && <input type="date" className={base} />}
      {field.type === 'file' && (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Drop a file or click to upload
        </div>
      )}
      {field.type === 'toggle' && (
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs">
            Yes
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs">
            No
          </button>
        </div>
      )}
      {field.type === 'checkbox' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" />
          {field.placeholder || field.label}
        </label>
      )}
      {field.type === 'radio' && (
        <div className="space-y-1">
          {(field.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name={field.id} className="h-4 w-4" />
              {opt.label}
            </label>
          ))}
        </div>
      )}
      {field.type === 'select' && (
        <select className={base} defaultValue="">
          <option value="" disabled>
            {field.placeholder ?? 'Select an option'}
          </option>
          {renderSelectOptions(filterActiveOptions(field.options))}
        </select>
      )}
      {field.type === 'multiselect' && (
        <div className="rounded-md border border-border bg-muted p-2.5">
          <MultiSelectTree tree={filterActiveOptions(field.options)} />
        </div>
      )}
      {field.help_text && (
        <span className="mt-1 block text-[11px] text-muted-foreground">{field.help_text}</span>
      )}
    </label>
  )
}

// ── SectionBuilder ────────────────────────────────────────────────────────────

export function SectionBuilder({
  entityName,
  initialSections,
  onSave,
  fieldIdsWithSla = [],
}: SectionBuilderProps) {
  const slaFieldIds = useMemo(() => new Set(fieldIdsWithSla), [fieldIdsWithSla])
  const [sections, setSections] = useState<FormSection[]>(initialSections)
  const [selected, setSelected] = useState<Selected>(null)
  const [isPending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<
    { type: 'idle' } | { type: 'success' } | { type: 'error'; message: string }
  >({ type: 'idle' })
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialSections))
  const isDirty = JSON.stringify(sections) !== savedSnapshot

  const errors = useMemo(() => getValidationErrors(sections), [sections])

  const totalFields = useMemo(
    () => sections.reduce((n, s) => n + s.fields.length, 0),
    [sections],
  )

  const selectedSection = useMemo(
    () => (selected ? sections.find((s) => s.id === selected.s) ?? null : null),
    [selected, sections],
  )

  const selectedField = useMemo(() => {
    if (!selected || !selectedSection) return null
    return selectedSection.fields.find((f) => f.id === selected.f) ?? null
  }, [selected, selectedSection])

  // Warn on unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateSection = useCallback((sid: string, patch: Partial<FormSection>) => {
    setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)))
  }, [])

  const deleteSection = useCallback(
    (sid: string) => {
      setSections((prev) => prev.filter((s) => s.id !== sid))
      if (selected?.s === sid) setSelected(null)
    },
    [selected],
  )

  const addSection = useCallback(() => {
    const s: FormSection = { id: uid(), title: 'New section', order: 0, fields: [] }
    setSections((prev) => [...prev, s])
    setSelected({ s: s.id, f: '' })
  }, [])

  const updateField = useCallback(
    (sid: string, fid: string, patch: Partial<FormField>) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : { ...s, fields: s.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) },
        ),
      )
    },
    [],
  )

  const updateOptions = useCallback(
    (sid: string, fid: string, fn: (tree: OptTree) => OptTree) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : {
                ...s,
                fields: s.fields.map((f) =>
                  f.id === fid ? { ...f, options: fn(f.options ?? []) } : f,
                ),
              },
        ),
      )
    },
    [],
  )

  const addField = useCallback(
    (sid: string, type: FormFieldType) => {
      const f = newField(type)
      setSections((prev) =>
        prev.map((s) => (s.id === sid ? { ...s, fields: [...s.fields, f] } : s)),
      )
      setSelected({ s: sid, f: f.id })
    },
    [],
  )

  const deleteField = useCallback(
    (sid: string, fid: string) => {
      setSections((prev) =>
        prev.map((s) =>
          s.id !== sid ? s : { ...s, fields: s.fields.filter((f) => f.id !== fid) },
        ),
      )
      if (selected?.f === fid) setSelected(null)
    },
    [selected],
  )

  const moveField = useCallback((sid: string, fid: string, dir: -1 | 1) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s
        const i = s.fields.findIndex((f) => f.id === fid)
        const j = i + dir
        if (i < 0 || j < 0 || j >= s.fields.length) return s
        const arr = [...s.fields]
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
        return { ...s, fields: arr }
      }),
    )
  }, [])

  function handleSave() {
    if (errors.length > 0) {
      setSaveState({ type: 'error', message: `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} before saving.` })
      return
    }
    setSaveState({ type: 'idle' })
    startTransition(async () => {
      const result = await onSave(sections)
      if (result.error) {
        setSaveState({ type: 'error', message: result.error })
      } else {
        setSaveState({ type: 'success' })
        setSavedSnapshot(JSON.stringify(sections))
        setTimeout(() => setSaveState({ type: 'idle' }), 3000)
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* 3-column grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)_380px]">

        {/* ── LEFT: Field library + Validation ─────────────────────────────── */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          {/* Field library */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Add a field</h3>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Click to add</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_LIBRARY.map((it) => (
                <button
                  key={it.type}
                  type="button"
                  onClick={() => {
                    const sid = selected?.s ?? sections[sections.length - 1]?.id
                    if (sid) addField(sid, it.type)
                  }}
                  className="flex flex-col items-start gap-1 rounded-lg border border-border bg-muted/40 p-2.5 text-left transition hover:border-primary/60 hover:bg-primary/5"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-background text-sm font-semibold text-primary shadow-sm">
                    {it.icon}
                  </span>
                  <span className="text-xs font-semibold text-foreground">{it.label}</span>
                  <span className="text-[10px] text-muted-foreground">{it.hint}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={addSection}
              className="mt-3 w-full rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              + New section
            </button>
          </div>

          {/* Validation panel */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Validation</h3>
            {errors.length === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
                  ✓
                </span>
                Ready to save
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-destructive">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-destructive text-[9px] font-bold text-white">
                      !
                    </span>
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── CENTER: Canvas ────────────────────────────────────────────────── */}
        <section className="min-w-0 space-y-4">
          {sections.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-border py-16 text-center">
              <p className="text-sm font-medium text-foreground">No sections yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a section to start building the form for {entityName}.
              </p>
            </div>
          )}

          {sections.map((section) => (
            <div
              key={section.id}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              {/* Section header */}
              <header className="mb-1 flex items-start gap-3">
                <input
                  value={section.title}
                  onChange={(e) => updateSection(section.id, { title: e.target.value })}
                  className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold text-foreground outline-none focus:ring-0"
                  placeholder="Section title"
                />
                <button
                  type="button"
                  onClick={() => deleteSection(section.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Delete section"
                >
                  ✕
                </button>
              </header>
              <input
                value={section.description ?? ''}
                onChange={(e) =>
                  updateSection(section.id, { description: e.target.value || undefined })
                }
                placeholder="Optional description shown to the requester"
                className="mb-4 w-full border-0 bg-transparent text-sm text-muted-foreground outline-none focus:ring-0"
              />

              {/* Field list */}
              <ul className="space-y-2">
                {section.fields.map((f, fi) => {
                  const isSel = selected?.f === f.id
                  const lib = getLibEntry(f.type)
                  const leafCount = f.options ? countLeaves(f.options) : 0
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ s: section.id, f: f.id })}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                          isSel
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-muted/30 hover:border-border'
                        }`}
                      >
                        <span className="cursor-grab text-muted-foreground select-none">⋮⋮</span>
                        <span className="grid h-7 w-7 place-items-center rounded-md bg-background text-xs font-semibold text-primary shadow-sm">
                          {lib?.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {f.label || (
                              <em className="text-muted-foreground">Untitled field</em>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {lib?.label}
                            {f.required ? ' · Required' : ''}
                            {f.options
                              ? ` · ${leafCount} choice${leafCount === 1 ? '' : 's'}`
                              : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              moveField(section.id, f.id, -1)
                            }}
                            className={`grid h-6 w-6 place-items-center rounded hover:bg-muted ${fi === 0 ? 'opacity-30 pointer-events-none' : ''}`}
                          >
                            ↑
                          </span>
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              moveField(section.id, f.id, 1)
                            }}
                            className={`grid h-6 w-6 place-items-center rounded hover:bg-muted ${fi === section.fields.length - 1 ? 'opacity-30 pointer-events-none' : ''}`}
                          >
                            ↓
                          </span>
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (
                                slaFieldIds.has(f.id) &&
                                !confirm(
                                  `"${f.label}" has Field SLA Matrix entries configured. Deleting this field won't remove that data from the database, but you won't be able to see or edit it anymore once the field is gone. Delete anyway?`
                                )
                              ) {
                                return
                              }
                              deleteField(section.id, f.id)
                            }}
                            className="grid h-6 w-6 place-items-center rounded hover:bg-destructive/10 hover:text-destructive"
                          >
                            ✕
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <button
                type="button"
                onClick={() => {
                  addField(section.id, 'text')
                }}
                className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                + Add field to this section
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addSection}
            className="w-full rounded-2xl border border-dashed border-border py-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            + Add another section
          </button>
        </section>

        {/* ── RIGHT: Inspector + Live preview ──────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Field inspector */}
          {selectedField && selectedSection ? (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Field settings</h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {getLibEntry(selectedField.type)?.label}
                </span>
              </div>

              <Labeled label="Label">
                <input
                  value={selectedField.label}
                  onChange={(e) =>
                    updateField(selectedSection.id, selectedField.id, { label: e.target.value })
                  }
                  className={inputCls}
                />
              </Labeled>

              <Labeled label="Placeholder">
                <input
                  value={selectedField.placeholder ?? ''}
                  onChange={(e) =>
                    updateField(selectedSection.id, selectedField.id, {
                      placeholder: e.target.value || undefined,
                    })
                  }
                  placeholder="Hint shown inside the field"
                  className={inputCls}
                />
              </Labeled>

              <Labeled label="Help text">
                <input
                  value={selectedField.help_text ?? ''}
                  onChange={(e) =>
                    updateField(selectedSection.id, selectedField.id, {
                      help_text: e.target.value || undefined,
                    })
                  }
                  placeholder="Extra guidance below the field"
                  className={inputCls}
                />
              </Labeled>

              <label className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-sm font-medium text-foreground">Required field</span>
                <div
                  role="checkbox"
                  aria-checked={selectedField.required}
                  tabIndex={0}
                  onClick={() =>
                    updateField(selectedSection.id, selectedField.id, {
                      required: !selectedField.required,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === ' ')
                      updateField(selectedSection.id, selectedField.id, {
                        required: !selectedField.required,
                      })
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedField.required ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      selectedField.required ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </label>

              {(selectedField.type === 'select' || selectedField.type === 'multiselect') && (
                <OptionTreeEditor
                  options={selectedField.options ?? []}
                  onChange={(fn) =>
                    updateOptions(selectedSection.id, selectedField.id, fn)
                  }
                />
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Select a field to edit its settings.
            </div>
          )}

          {/* Live preview */}
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">Live preview</h3>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                What requesters see
              </span>
            </div>
            <div className="space-y-5 p-4">
              {sections.map((s) => (
                <div key={s.id}>
                  <h4 className="text-sm font-semibold text-foreground">
                    {s.title || 'Untitled section'}
                  </h4>
                  {s.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                  )}
                  <div className="mt-3 space-y-3">
                    {s.fields.map((f) => (
                      <PreviewField key={f.id} field={f} />
                    ))}
                    {s.fields.length === 0 && (
                      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No fields yet.
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn-gradient w-full"
              >
                Submit request
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Sticky save bar ──────────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-10">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-3.5 shadow-lg">
          <div className="min-w-0">
            {saveState.type === 'success' && (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="font-medium">Saved successfully</span>
              </div>
            )}
            {saveState.type === 'error' && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="truncate">{saveState.message}</span>
              </div>
            )}
            {saveState.type === 'idle' && (
              <p className="text-xs text-muted-foreground">
                {sections.length} section{sections.length !== 1 ? 's' : ''} · {totalFields} field
                {totalFields !== 1 ? 's' : ''}
                {isDirty && (
                  <span className="ml-2 font-medium text-amber-600">· Unsaved changes</span>
                )}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="btn-gradient disabled:opacity-60"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save form'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
