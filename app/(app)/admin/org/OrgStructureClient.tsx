'use client'

import { useState, useTransition, useMemo, useRef } from 'react'
import {
  createDepartment, updateDepartment, deleteDepartment, importDepartments,
  createLocation, updateLocation, deleteLocation, importLocations,
  createCostCenter, updateCostCenter, deleteCostCenter,
  createJobFunction, updateJobFunction, deleteJobFunction,
  createDesignation, updateDesignation, deleteDesignation,
  createStore, updateStore, deleteStore, importStores,
} from '@/lib/actions/admin/org'
import { createOem, updateOem, deleteOem } from '@/lib/actions/admin/oems'
import { ImportModal } from '@/components/ui/ImportModal'
import type { DepartmentRow, LocationRow, CostCenterRow, JobFunctionRow, DesignationRow, UserOption, OemRow, StoreRow } from './page'

type Tab = 'departments' | 'locations' | 'cost_centers' | 'job_functions' | 'designations' | 'oems' | 'stores'

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
]

// ─── Shared components ─────────────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
      active ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-50 border-slate-200'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function TableCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-sm text-foreground ${className}`}>{children}</div>
}

function FormInput({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}{required && ' *'}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}

function FormSelect({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{placeholder ?? '— None —'}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

interface LocationFormValues { name: string; code: string; city: string; country: string; timezone: string; is_active: boolean }

function LocationForm({ f, setF, onSubmit, onCancel, submitLabel, pending, tzOptions }: {
  f: LocationFormValues; setF: (v: LocationFormValues) => void; onSubmit: (e: React.FormEvent) => void; onCancel: () => void; submitLabel: string
  pending: boolean; tzOptions: { value: string; label: string }[]
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <FormInput label="Name" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="e.g. HQ New York" />
        <FormInput label="Code" value={f.code} onChange={v => setF({ ...f, code: v })} placeholder="e.g. NYC" />
        <FormInput label="City" value={f.city} onChange={v => setF({ ...f, city: v })} placeholder="e.g. New York" />
        <FormInput label="Country" value={f.country} onChange={v => setF({ ...f, country: v })} placeholder="e.g. USA" />
        <FormSelect label="Timezone" value={f.timezone} onChange={v => setF({ ...f, timezone: v })} options={tzOptions} placeholder="Select timezone" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} className="rounded" />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
      </div>
    </form>
  )
}

interface CostCenterFormValues { name: string; code: string; department_id: string; is_active: boolean }

function CCForm({ f, setF, onSubmit, onCancel, submitLabel, pending, deptOptions }: {
  f: CostCenterFormValues; setF: (v: CostCenterFormValues) => void; onSubmit: (e: React.FormEvent) => void; onCancel: () => void; submitLabel: string
  pending: boolean; deptOptions: { value: string; label: string }[]
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <FormInput label="Name" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="e.g. IT Operations" />
        <FormInput label="Code" value={f.code} onChange={v => setF({ ...f, code: v })} placeholder="e.g. CC-IT-001" />
        <FormSelect label="Department" value={f.department_id} onChange={v => setF({ ...f, department_id: v })} options={deptOptions} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} className="rounded" />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
      </div>
    </form>
  )
}

// ─── Departments Tab ───────────────────────────────────────────────────────────

interface DeptTabProps {
  departments: DepartmentRow[]
  allUsers: UserOption[]
}

function DepartmentsTab({ departments, allUsers }: DeptTabProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [treeView, setTreeView] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  // Add form state
  const [addName, setAddName] = useState('')
  const [addCode, setAddCode] = useState('')
  const [addParent, setAddParent] = useState('')
  const [addHead, setAddHead] = useState('')
  const [addActive, setAddActive] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editParent, setEditParent] = useState('')
  const [editHead, setEditHead] = useState('')
  const [editActive, setEditActive] = useState(true)

  function startEdit(d: DepartmentRow) {
    setEditId(d.id)
    setEditName(d.name)
    setEditCode(d.code ?? '')
    setEditParent(d.parent_id ?? '')
    setEditHead(d.head_user_id ?? '')
    setEditActive(d.is_active)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createDepartment({ name: addName, code: addCode, parent_id: addParent || null, head_user_id: addHead || null, is_active: addActive })
      if (res.error) { setError(res.error); return }
      setAddName(''); setAddCode(''); setAddParent(''); setAddHead(''); setAddActive(true); setShowAdd(false)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await updateDepartment(editId, { name: editName, code: editCode, parent_id: editParent || null, head_user_id: editHead || null, is_active: editActive })
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await deleteDepartment(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  const deptOptions = departments.map(d => ({ value: d.id, label: d.name }))
  const userOptions = allUsers.map(u => ({ value: u.id, label: u.full_name }))

  // Build tree
  const treeRows = useMemo(() => {
    if (!treeView) return departments.map(d => ({ ...d, depth: 0 }))
    const childrenMap: Record<string, DepartmentRow[]> = {}
    const roots: DepartmentRow[] = []
    for (const d of departments) {
      if (d.parent_id) {
        if (!childrenMap[d.parent_id]) childrenMap[d.parent_id] = []
        childrenMap[d.parent_id].push(d)
      } else {
        roots.push(d)
      }
    }
    const result: (DepartmentRow & { depth: number })[] = []
    function walk(depts: DepartmentRow[], depth: number) {
      for (const d of depts) {
        result.push({ ...d, depth })
        if (childrenMap[d.id]) walk(childrenMap[d.id], depth + 1)
      }
    }
    walk(roots, 0)
    return result
  }, [departments, treeView])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTreeView(v => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${treeView ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-border bg-background text-muted-foreground hover:bg-muted/40'}`}
          >
            {treeView ? 'Tree View' : 'Flat View'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
          >
            Import
          </button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
          >
            + Add Department
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showImport && (
        <ImportModal
          title="Departments"
          sampleFilename="departments-sample.csv"
          sampleColumns={[
            { key: 'name', label: 'name' },
            { key: 'code', label: 'code' },
            { key: 'parent_department', label: 'parent_department' },
            { key: 'active', label: 'active' },
          ]}
          sampleRows={[
            { name: 'Retail Operations', code: 'OPS', parent_department: '', active: 'true' },
            { name: 'Store Support', code: 'STORE', parent_department: 'Retail Operations', active: 'true' },
          ]}
          onImport={(rows) => importDepartments(rows as never)}
          onClose={() => setShowImport(false)}
          onDone={() => {}}
        />
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
          <p className="text-sm font-semibold text-foreground">New Department</p>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Name" value={addName} onChange={setAddName} required placeholder="e.g. Engineering" />
            <FormInput label="Code" value={addCode} onChange={setAddCode} placeholder="e.g. ENG" />
            <FormSelect label="Parent Department" value={addParent} onChange={setAddParent} options={deptOptions} />
            <FormSelect label="Head (User)" value={addHead} onChange={setAddHead} options={userOptions} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="add-active" checked={addActive} onChange={e => setAddActive(e.target.checked)} className="rounded" />
            <label htmlFor="add-active" className="text-xs text-muted-foreground">Active</label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">
              Create
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_80px_160px_140px_80px_120px] gap-x-4 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Name', 'Code', 'Head', 'Parent', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {treeRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No departments yet.</div>
        ) : treeRows.map(d => (
          <div key={d.id}>
            {editId === d.id ? (
              <form onSubmit={handleEdit} className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormInput label="Name" value={editName} onChange={setEditName} required />
                  <FormInput label="Code" value={editCode} onChange={setEditCode} />
                  <FormSelect label="Parent" value={editParent} onChange={setEditParent} options={deptOptions.filter(o => o.value !== d.id)} />
                  <FormSelect label="Head" value={editHead} onChange={setEditHead} options={userOptions} />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="rounded" />
                  <span className="text-xs text-muted-foreground">Active</span>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-[1fr_80px_160px_140px_80px_120px] items-center gap-x-4 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell>
                  <span style={{ paddingLeft: `${d.depth * 20}px` }} className="flex items-center gap-1">
                    {d.depth > 0 && <span className="text-muted-foreground">↳</span>}
                    {d.name}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{d.code ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{d.head_name ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {d.parent_id ? (departments.find(p => p.id === d.parent_id)?.name ?? '—') : '—'}
                </TableCell>
                <div><ActiveBadge active={d.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(d)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  {confirmDelete === d.id ? (
                    <>
                      <button onClick={() => handleDelete(d.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(d.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── Locations Tab ─────────────────────────────────────────────────────────────

function LocationsTab({ locations }: { locations: LocationRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const blank = { name: '', code: '', city: '', country: '', timezone: 'UTC', is_active: true }
  const [addF, setAddF] = useState(blank)
  const [editF, setEditF] = useState(blank)

  function startEdit(l: LocationRow) {
    setEditId(l.id)
    setEditF({ name: l.name, code: l.code ?? '', city: l.city ?? '', country: l.country ?? '', timezone: l.timezone ?? 'UTC', is_active: l.is_active })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createLocation({ name: addF.name, code: addF.code, city: addF.city, country: addF.country, timezone: addF.timezone, is_active: addF.is_active })
      if (res.error) { setError(res.error); return }
      setAddF(blank); setShowAdd(false)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await updateLocation(editId, editF)
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await deleteLocation(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  const tzOptions = TIMEZONES.map(tz => ({ value: tz, label: tz }))

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button onClick={() => setShowImport(true)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors">
          Import
        </button>
        <button onClick={() => setShowAdd(v => !v)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
          + Add Location
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showImport && (
        <ImportModal
          title="Locations"
          sampleFilename="locations-sample.csv"
          sampleColumns={[
            { key: 'name', label: 'name' },
            { key: 'code', label: 'code' },
            { key: 'city', label: 'city' },
            { key: 'country', label: 'country' },
            { key: 'timezone', label: 'timezone' },
            { key: 'active', label: 'active' },
          ]}
          sampleRows={[
            { name: 'Head Office', code: 'HO', city: 'Gurugram', country: 'India', timezone: 'Asia/Kolkata', active: 'true' },
            { name: 'Mumbai Store', code: 'MUM', city: 'Mumbai', country: 'India', timezone: 'Asia/Kolkata', active: 'true' },
          ]}
          onImport={(rows) => importLocations(rows as never)}
          onClose={() => setShowImport(false)}
          onDone={() => {}}
        />
      )}

      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">New Location</p>
          <LocationForm f={addF} setF={setAddF} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Create" pending={pending} tzOptions={tzOptions} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_70px_110px_60px_80px_90px_100px_70px_120px] gap-x-3 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Name', 'Code', 'City', 'Tz', 'Users', 'Open', 'Avg. Res.', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {locations.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No locations yet.</div>
        ) : locations.map(l => (
          <div key={l.id}>
            {editId === l.id ? (
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <LocationForm f={editF} setF={setEditF} onSubmit={handleEdit} onCancel={() => setEditId(null)} submitLabel="Save" pending={pending} tzOptions={tzOptions} />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_70px_110px_60px_80px_90px_100px_70px_120px] items-center gap-x-3 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-muted-foreground">{l.code ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.city ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{l.timezone}</TableCell>
                <TableCell className="text-muted-foreground">{l.user_count}</TableCell>
                <TableCell className="text-muted-foreground">{l.open_requests}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{l.avg_resolution_hours != null ? `${l.avg_resolution_hours}h` : '—'}</TableCell>
                <div><ActiveBadge active={l.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(l)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  {confirmDelete === l.id ? (
                    <>
                      <button onClick={() => handleDelete(l.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(l.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── Cost Centers Tab ──────────────────────────────────────────────────────────

function CostCentersTab({ costCenters, departments }: { costCenters: CostCenterRow[]; departments: DepartmentRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const blank = { name: '', code: '', department_id: '', is_active: true }
  const [addF, setAddF] = useState(blank)
  const [editF, setEditF] = useState(blank)

  const deptOptions = departments.map(d => ({ value: d.id, label: d.name }))

  function startEdit(c: CostCenterRow) {
    setEditId(c.id)
    setEditF({ name: c.name, code: c.code ?? '', department_id: c.department_id ?? '', is_active: c.is_active })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createCostCenter({ name: addF.name, code: addF.code, department_id: addF.department_id || null, is_active: addF.is_active })
      if (res.error) { setError(res.error); return }
      setAddF(blank); setShowAdd(false)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await updateCostCenter(editId, { name: editF.name, code: editF.code, department_id: editF.department_id || null, is_active: editF.is_active })
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await deleteCostCenter(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(v => !v)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
          + Add Cost Center
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">New Cost Center</p>
          <CCForm f={addF} setF={setAddF} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Create" pending={pending} deptOptions={deptOptions} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_120px_200px_80px_120px] gap-x-4 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Name', 'Code', 'Department', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {costCenters.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No cost centers yet.</div>
        ) : costCenters.map(c => (
          <div key={c.id}>
            {editId === c.id ? (
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <CCForm f={editF} setF={setEditF} onSubmit={handleEdit} onCancel={() => setEditId(null)} submitLabel="Save" pending={pending} deptOptions={deptOptions} />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_120px_200px_80px_120px] items-center gap-x-4 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell>{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.code ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{c.department_name ?? '—'}</TableCell>
                <div><ActiveBadge active={c.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(c)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  {confirmDelete === c.id ? (
                    <>
                      <button onClick={() => handleDelete(c.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(c.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── Simple master-data tab (Job Functions / Designations) ────────────────────
// Both are flat name+code+active lists with identical CRUD shape — one
// generic tab body parameterized by the three server actions and copy.

interface SimpleMasterRow {
  id: string
  name: string
  code: string | null
  is_active: boolean
}

interface SimpleMasterFormValues { name: string; code: string; is_active: boolean }

function SimpleMasterForm({ f, setF, onSubmit, onCancel, submitLabel, pending }: {
  f: SimpleMasterFormValues; setF: (v: SimpleMasterFormValues) => void; onSubmit: (e: React.FormEvent) => void; onCancel: () => void; submitLabel: string
  pending: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Name" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="e.g. Retail Operations" />
        <FormInput label="Code" value={f.code} onChange={v => setF({ ...f, code: v })} placeholder="e.g. RETAIL" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} className="rounded" />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
      </div>
    </form>
  )
}

function SimpleMasterTab({ rows, noun, actions }: {
  rows: SimpleMasterRow[]
  noun: string
  actions: {
    create: (fields: { name: string; code?: string; is_active?: boolean }) => Promise<{ error?: string }>
    update: (id: string, fields: { name?: string; code?: string | null; is_active?: boolean }) => Promise<{ error?: string }>
    remove: (id: string) => Promise<{ error?: string }>
  }
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const blank: SimpleMasterFormValues = { name: '', code: '', is_active: true }
  const [addF, setAddF] = useState(blank)
  const [editF, setEditF] = useState(blank)

  function startEdit(r: SimpleMasterRow) {
    setEditId(r.id)
    setEditF({ name: r.name, code: r.code ?? '', is_active: r.is_active })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await actions.create({ name: addF.name, code: addF.code, is_active: addF.is_active })
      if (res.error) { setError(res.error); return }
      setAddF(blank); setShowAdd(false)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await actions.update(editId, editF)
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await actions.remove(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(v => !v)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
          + Add {noun}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">New {noun}</p>
          <SimpleMasterForm f={addF} setF={setAddF} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Create" pending={pending} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_140px_80px_120px] gap-x-4 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Name', 'Code', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No {noun.toLowerCase()}s yet.</div>
        ) : rows.map(r => (
          <div key={r.id}>
            {editId === r.id ? (
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <SimpleMasterForm f={editF} setF={setEditF} onSubmit={handleEdit} onCancel={() => setEditId(null)} submitLabel="Save" pending={pending} />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_140px_80px_120px] items-center gap-x-4 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.code ?? '—'}</TableCell>
                <div><ActiveBadge active={r.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(r)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  {confirmDelete === r.id ? (
                    <>
                      <button onClick={() => handleDelete(r.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(r.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── OEMs Tab ──────────────────────────────────────────────────────────────────
// OEM = the vendor an AC Issues ticket gets auto-emailed to once the
// requester's store (see StoresTab below) is assigned to them and the
// service has auto_oem_routing enabled — see runOemAutoRouting() in
// lib/actions/requests.ts.

function FormTextarea({ label, value, onChange, placeholder, rows = 3, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; hint?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
      />
      {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

const OEM_TEMPLATE_PLACEHOLDERS =
  '{{ticket_no}}, {{subject}}, {{description}}, {{requester_name}}, {{requester_email}}, {{requester_phone}}, {{store_address}}'

interface OemFormValues { name: string; emails: string; email_subject_template: string; email_body_template: string; is_active: boolean }

function OemForm({ f, setF, onSubmit, onCancel, submitLabel, pending }: {
  f: OemFormValues; setF: (v: OemFormValues) => void; onSubmit: (e: React.FormEvent) => void; onCancel: () => void; submitLabel: string
  pending: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FormInput label="OEM Name" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="e.g. Voltas AC Service" />
      <FormTextarea
        label="Notification Emails"
        value={f.emails}
        onChange={v => setF({ ...f, emails: v })}
        placeholder={'one address per line, e.g.\nservice@voltas.com\nescalation@voltas.com'}
        hint="One email per line (or comma-separated). All of these get CC'd every time a ticket routes to this OEM."
      />
      <FormInput label="Email Subject Template" value={f.email_subject_template} onChange={v => setF({ ...f, email_subject_template: v })} placeholder={`New AC Issue — {{ticket_no}}`} />
      <FormTextarea
        label="Email Body Template"
        value={f.email_body_template}
        onChange={v => setF({ ...f, email_body_template: v })}
        rows={5}
        placeholder={'A new AC issue ticket has been raised.\n\nTicket: {{ticket_no}}\nSubject: {{subject}}\nDescription: {{description}}\n\nRequester: {{requester_name}} ({{requester_email}}, {{requester_phone}})\nStore Address: {{store_address}}'}
        hint={`Available placeholders: ${OEM_TEMPLATE_PLACEHOLDERS}`}
      />
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} className="rounded" />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
      </div>
    </form>
  )
}

function parseEmails(raw: string): string[] {
  return raw.split(/[\n,]/).map(e => e.trim()).filter(Boolean)
}

function OemsTab({ oems }: { oems: OemRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null)
  const addPanelRef = useRef<HTMLDivElement>(null)

  const blank: OemFormValues = { name: '', emails: '', email_subject_template: '', email_body_template: '', is_active: true }
  const [addF, setAddF] = useState(blank)
  const [editF, setEditF] = useState(blank)

  function startEdit(o: OemRow) {
    setEditId(o.id)
    setEditF({
      name: o.name,
      emails: o.emails.join('\n'),
      email_subject_template: o.email_subject_template ?? '',
      email_body_template: o.email_body_template ?? '',
      is_active: o.is_active,
    })
  }

  // Opens the Add form pre-filled from an existing OEM (name suffixed "(Copy)") so an
  // admin only renames and tweaks it. Stores mapped to the original are not copied.
  function startDuplicate(o: OemRow) {
    setError(null)
    setEditId(null)
    setDuplicateOf(o.name)
    setAddF({
      name: `${o.name} (Copy)`,
      emails: o.emails.join('\n'),
      email_subject_template: o.email_subject_template ?? '',
      email_body_template: o.email_body_template ?? '',
      is_active: o.is_active,
    })
    setShowAdd(true)
    requestAnimationFrame(() => addPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createOem({
        name: addF.name,
        emails: parseEmails(addF.emails),
        email_subject_template: addF.email_subject_template || null,
        email_body_template: addF.email_body_template || null,
        is_active: addF.is_active,
      })
      if (res.error) { setError(res.error); return }
      setAddF(blank); setShowAdd(false); setDuplicateOf(null)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await updateOem(editId, {
        name: editF.name,
        emails: parseEmails(editF.emails),
        email_subject_template: editF.email_subject_template || null,
        email_body_template: editF.email_body_template || null,
        is_active: editF.is_active,
      })
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await deleteOem(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setDuplicateOf(null); setAddF(blank); setShowAdd(v => !v) }} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
          + Add OEM
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showAdd && (
        <div ref={addPanelRef} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">{duplicateOf ? `Duplicate "${duplicateOf}"` : 'New OEM'}</p>
          <OemForm f={addF} setF={setAddF} onSubmit={handleAdd} onCancel={() => { setShowAdd(false); setDuplicateOf(null) }} submitLabel={duplicateOf ? 'Create Duplicate' : 'Create'} pending={pending} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_1.4fr_80px_190px] gap-x-4 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Name', 'Emails', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {oems.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No OEMs yet.</div>
        ) : oems.map(o => (
          <div key={o.id}>
            {editId === o.id ? (
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <OemForm f={editF} setF={setEditF} onSubmit={handleEdit} onCancel={() => setEditId(null)} submitLabel="Save" pending={pending} />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_1.4fr_80px_190px] items-center gap-x-4 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell>{o.name}</TableCell>
                <TableCell className="text-muted-foreground text-xs truncate">{o.emails.length > 0 ? o.emails.join(', ') : '—'}</TableCell>
                <div><ActiveBadge active={o.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(o)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  <button onClick={() => startDuplicate(o)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Duplicate</button>
                  {confirmDelete === o.id ? (
                    <>
                      <button onClick={() => handleDelete(o.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(o.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── Stores Tab (Store Master) ────────────────────────────────────────────────
// One row per physical store — its address is what auto-fills the
// `store_address` field on AC Issues-style tickets, and its OEM assignment is
// what decides where the auto-routing email goes. Distinct from the
// Locations tab above (HO/Stores/Warehouse — a coarse visibility category).

interface StoreFormValues { code: string; name: string; address: string; city: string; state: string; pincode: string; oem_id: string; is_active: boolean }

function StoreForm({ f, setF, onSubmit, onCancel, submitLabel, pending, oemOptions }: {
  f: StoreFormValues; setF: (v: StoreFormValues) => void; onSubmit: (e: React.FormEvent) => void; onCancel: () => void; submitLabel: string
  pending: boolean; oemOptions: { value: string; label: string }[]
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <FormInput label="Store Code" value={f.code} onChange={v => setF({ ...f, code: v })} required placeholder="e.g. ALC" />
        <FormInput label="Store Name" value={f.name} onChange={v => setF({ ...f, name: v })} required placeholder="e.g. Alwar City" />
        <FormSelect label="OEM (for AC issue routing)" value={f.oem_id} onChange={v => setF({ ...f, oem_id: v })} options={oemOptions} placeholder="Not mapped" />
      </div>
      <FormInput label="Address" value={f.address} onChange={v => setF({ ...f, address: v })} placeholder="Full store address — auto-fills requester tickets" />
      <div className="grid grid-cols-3 gap-3">
        <FormInput label="City" value={f.city} onChange={v => setF({ ...f, city: v })} placeholder="e.g. Alwar" />
        <FormInput label="State" value={f.state} onChange={v => setF({ ...f, state: v })} placeholder="e.g. Rajasthan" />
        <FormInput label="Pincode" value={f.pincode} onChange={v => setF({ ...f, pincode: v })} placeholder="e.g. 301001" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} className="rounded" />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
      </div>
    </form>
  )
}

function StoresTab({ stores, oems }: { stores: StoreRow[]; oems: OemRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const blank: StoreFormValues = { code: '', name: '', address: '', city: '', state: '', pincode: '', oem_id: '', is_active: true }
  const [addF, setAddF] = useState(blank)
  const [editF, setEditF] = useState(blank)

  const oemOptions = oems.map(o => ({ value: o.id, label: o.name }))

  function startEdit(s: StoreRow) {
    setEditId(s.id)
    setEditF({
      code: s.code, name: s.name, address: s.address ?? '', city: s.city ?? '',
      state: s.state ?? '', pincode: s.pincode ?? '', oem_id: s.oem_id ?? '', is_active: s.is_active,
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createStore({
        code: addF.code, name: addF.name, address: addF.address, city: addF.city,
        state: addF.state, pincode: addF.pincode, oem_id: addF.oem_id || null, is_active: addF.is_active,
      })
      if (res.error) { setError(res.error); return }
      setAddF(blank); setShowAdd(false)
    })
  }

  function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    setError(null)
    startTransition(async () => {
      const res = await updateStore(editId, {
        code: editF.code, name: editF.name, address: editF.address, city: editF.city,
        state: editF.state, pincode: editF.pincode, oem_id: editF.oem_id || null, is_active: editF.is_active,
      })
      if (res.error) { setError(res.error); return }
      setEditId(null)
    })
  }

  function handleDelete(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await deleteStore(id)
      if (res.error) { setError(res.error); return }
      setConfirmDelete(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button onClick={() => setShowImport(true)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors">
          Import
        </button>
        <button onClick={() => setShowAdd(v => !v)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
          + Add Store
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {showImport && (
        <ImportModal
          title="Stores"
          sampleFilename="stores-sample.csv"
          sampleColumns={[
            { key: 'code', label: 'code' },
            { key: 'name', label: 'name' },
            { key: 'address', label: 'address' },
            { key: 'city', label: 'city' },
            { key: 'state', label: 'state' },
            { key: 'pincode', label: 'pincode' },
            { key: 'oem', label: 'oem' },
            { key: 'active', label: 'active' },
          ]}
          sampleRows={[
            { code: 'ALC', name: 'Alwar City', address: 'Main Road, Alwar', city: 'Alwar', state: 'Rajasthan', pincode: '301001', oem: 'Voltas AC Service', active: 'true' },
            { code: 'JPR', name: 'Jaipur Central', address: 'MI Road, Jaipur', city: 'Jaipur', state: 'Rajasthan', pincode: '302001', oem: '', active: 'true' },
          ]}
          onImport={(rows) => importStores(rows as never)}
          onClose={() => setShowImport(false)}
          onDone={() => {}}
        />
      )}

      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <p className="text-sm font-semibold text-foreground">New Store</p>
          <StoreForm f={addF} setF={setAddF} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Create" pending={pending} oemOptions={oemOptions} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[80px_1fr_1.4fr_140px_80px_120px] gap-x-4 border-b border-border bg-muted/30 px-4 py-2.5">
          {['Code', 'Name', 'Address', 'OEM', 'Active', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</span>
          ))}
        </div>

        {stores.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No stores yet.</div>
        ) : stores.map(s => (
          <div key={s.id}>
            {editId === s.id ? (
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20 space-y-3">
                <StoreForm f={editF} setF={setEditF} onSubmit={handleEdit} onCancel={() => setEditId(null)} submitLabel="Save" pending={pending} oemOptions={oemOptions} />
              </div>
            ) : (
              <div className="grid grid-cols-[80px_1fr_1.4fr_140px_80px_120px] items-center gap-x-4 border-b border-border/50 last:border-0 px-4 py-3">
                <TableCell className="font-mono text-xs">{s.code}</TableCell>
                <TableCell>{s.name}</TableCell>
                <TableCell className="text-muted-foreground text-xs truncate">{s.address ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.oem_name ?? <span className="italic">Unmapped</span>}</TableCell>
                <div><ActiveBadge active={s.is_active} /></div>
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(s)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Edit</button>
                  {confirmDelete === s.id ? (
                    <>
                      <button onClick={() => handleDelete(s.id)} disabled={pending} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Confirm</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(s.id)} className="rounded border border-border px-2 py-1 text-xs text-red-600/70 hover:bg-red-50 hover:border-red-200 hover:text-red-600">Delete</button>
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

// ─── Main Client ───────────────────────────────────────────────────────────────

interface Props {
  departments: DepartmentRow[]
  locations: LocationRow[]
  costCenters: CostCenterRow[]
  jobFunctions: JobFunctionRow[]
  designations: DesignationRow[]
  allUsers: UserOption[]
  oems: OemRow[]
  stores: StoreRow[]
}

export function OrgStructureClient({ departments, locations, costCenters, jobFunctions, designations, allUsers, oems, stores }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('departments')

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'departments', label: 'Departments', count: departments.length },
    { id: 'locations', label: 'Locations', count: locations.length },
    { id: 'cost_centers', label: 'Cost Centers', count: costCenters.length },
    { id: 'job_functions', label: 'Functions', count: jobFunctions.length },
    { id: 'designations', label: 'Designations', count: designations.length },
    { id: 'stores', label: 'Stores', count: stores.length },
    { id: 'oems', label: 'OEMs', count: oems.length },
  ]

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <div className="flex border-b border-border gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
              activeTab === tab.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'departments' && <DepartmentsTab departments={departments} allUsers={allUsers} />}
      {activeTab === 'locations' && <LocationsTab locations={locations} />}
      {activeTab === 'cost_centers' && <CostCentersTab costCenters={costCenters} departments={departments} />}
      {activeTab === 'job_functions' && (
        <SimpleMasterTab
          rows={jobFunctions}
          noun="Function"
          actions={{ create: createJobFunction, update: updateJobFunction, remove: deleteJobFunction }}
        />
      )}
      {activeTab === 'designations' && (
        <SimpleMasterTab
          rows={designations}
          noun="Designation"
          actions={{ create: createDesignation, update: updateDesignation, remove: deleteDesignation }}
        />
      )}
      {activeTab === 'stores' && <StoresTab stores={stores} oems={oems} />}
      {activeTab === 'oems' && <OemsTab oems={oems} />}
    </div>
  )
}
