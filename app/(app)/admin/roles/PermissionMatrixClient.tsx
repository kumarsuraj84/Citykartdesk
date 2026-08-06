'use client'

import { useState, useTransition } from 'react'
import { Check, Minus, Plus, X, ChevronDown, Trash2 } from 'lucide-react'
import { savePermissionOverrides, createCustomRole, deleteCustomRole } from '@/lib/actions/admin/permissions'

type Perm = boolean | 'partial'

type PermRow = {
  group:   string
  label:   string
  note?:   string
  user:    Perm
  agent:   Perm
  manager: Perm
  admin:   Perm
  owner:   Perm
}

type CustomRole = {
  id:          string
  name:        string
  description: string | null
  base_role:   string
}

interface Props {
  matrix:      PermRow[]
  overrides:   Record<string, Record<string, boolean>>
  customRoles: CustomRole[]
  canEdit:     boolean
}

const SYSTEM_ROLES = ['user', 'agent', 'manager', 'admin', 'platform_owner'] as const
type SystemRole = typeof SYSTEM_ROLES[number]

const ROLE_META: Record<string, { label: string; badge: string }> = {
  user:           { label: 'End User',       badge: 'bg-slate-50 text-slate-600 border border-slate-200'    },
  agent:          { label: 'Agent',          badge: 'bg-blue-50 text-blue-600 border border-blue-200'       },
  manager:        { label: 'Manager',        badge: 'bg-violet-50 text-violet-600 border border-violet-200' },
  admin:          { label: 'Administrator',  badge: 'bg-amber-50 text-amber-600 border border-amber-200'    },
  platform_owner: { label: 'Platform Owner', badge: 'bg-red-50 text-red-600 border border-red-200'          },
}

const ROW_ROLE_KEY: Record<SystemRole, keyof PermRow> = {
  user:           'user',
  agent:          'agent',
  manager:        'manager',
  admin:          'admin',
  platform_owner: 'owner',
}

const BASE_ROLE_OPTIONS = [
  { value: 'user',           label: 'End User'       },
  { value: 'agent',          label: 'Agent'          },
  { value: 'manager',        label: 'Manager'        },
  { value: 'admin',          label: 'Administrator'  },
  { value: 'platform_owner', label: 'Platform Owner' },
]

function actionKey(row: PermRow, roleKey: string) {
  return `${row.group}::${row.label}::${roleKey}`
}

function systemDefault(row: PermRow, role: SystemRole): boolean {
  const v = row[ROW_ROLE_KEY[role]] as Perm
  return v === true || v === 'partial'
}

function isPartial(row: PermRow, role: SystemRole) {
  return row[ROW_ROLE_KEY[role]] === 'partial'
}

// ── New Role Modal ─────────────────────────────────────────────────────────────

function NewRoleModal({ onClose, onCreated }: {
  onClose:   () => void
  onCreated: (role: CustomRole) => void
}) {
  const [pending, start] = useTransition()
  const [name, setName]  = useState('')
  const [desc, setDesc]  = useState('')
  const [base, setBase]  = useState('user')
  const [err,  setErr]   = useState('')

  function submit() {
    if (!name.trim()) { setErr('Role name is required'); return }
    setErr('')
    start(async () => {
      const res = await createCustomRole({ name, description: desc, base_role: base })
      if (res.error) { setErr(res.error); return }
      onCreated({ id: res.id!, name: name.trim(), description: desc, base_role: base })
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Add Custom Role</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Role Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. IT Support Lead"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="What does this role do?"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Inherits permissions from</label>
            <div className="relative">
              <select
                value={base}
                onChange={e => setBase(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {BASE_ROLE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">New role inherits the base role's defaults. You can edit after creating.</p>
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-glossy-light btn-glossy-light-hover text-xs">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="btn-gradient text-xs disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PermissionMatrixClient({ matrix, overrides, customRoles: initialCustom, canEdit }: Props) {
  const [pending, startTransition] = useTransition()
  const [dirty, setDirty]          = useState(false)
  const [saved, setSaved]          = useState(false)
  const [showModal, setShowModal]  = useState(false)
  const [customRoles, setCustomRoles] = useState<CustomRole[]>(initialCustom)
  const [delPending, startDel]     = useTransition()

  // All role keys in order: system first, then custom
  const allRoles = [
    ...SYSTEM_ROLES,
    ...customRoles.map(r => r.name),
  ]

  const [perms, setPerms] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const row of matrix) {
      // system roles
      for (const role of SYSTEM_ROLES) {
        const k = actionKey(row, role)
        init[k] = overrides[role]?.[k] !== undefined ? overrides[role][k] : systemDefault(row, role)
      }
      // custom roles
      for (const cr of initialCustom) {
        const k = actionKey(row, cr.name)
        init[k] = overrides[cr.name]?.[k] !== undefined
          ? overrides[cr.name][k]
          : systemDefault(row, cr.base_role as SystemRole)
      }
    }
    return init
  })

  function toggle(row: PermRow, roleKey: string) {
    if (!canEdit) return
    if (SYSTEM_ROLES.includes(roleKey as SystemRole) && isPartial(row, roleKey as SystemRole)) return
    const k = actionKey(row, roleKey)
    setPerms(prev => ({ ...prev, [k]: !prev[k] }))
    setDirty(true)
    setSaved(false)
  }

  function handleSave() {
    const rows = Object.entries(perms).map(([key, allowed]) => {
      const parts = key.split('::')
      return { role_key: parts[2], action_key: key, allowed }
    })
    startTransition(async () => {
      const res = await savePermissionOverrides(rows)
      if (!res.error) { setDirty(false); setSaved(true) }
    })
  }

  function handleRoleCreated(role: CustomRole) {
    setCustomRoles(prev => [...prev, role])
    // Init permissions for new role from its base role's current state
    setPerms(prev => {
      const next = { ...prev }
      for (const row of matrix) {
        const k    = actionKey(row, role.name)
        const base = actionKey(row, role.base_role)
        next[k] = prev[base] ?? systemDefault(row, role.base_role as SystemRole)
      }
      return next
    })
    setDirty(true)
    setSaved(false)
  }

  function handleDeleteRole(id: string, name: string) {
    startDel(async () => {
      await deleteCustomRole(id)
      setCustomRoles(prev => prev.filter(r => r.id !== id))
      setPerms(prev => {
        const next = { ...prev }
        for (const row of matrix) delete next[actionKey(row, name)]
        return next
      })
    })
  }

  // Dynamic grid — 1fr for label, 80px per role column
  const colCount  = allRoles.length
  const gridStyle = { gridTemplateColumns: `1fr ${Array(colCount).fill('80px').join(' ')}` }

  const groups = Object.values(
    matrix.reduce<Record<string, { group: string; rows: PermRow[] }>>((acc, row) => {
      if (!acc[row.group]) acc[row.group] = { group: row.group, rows: [] }
      acc[row.group].rows.push(row)
      return acc
    }, {})
  )

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {canEdit ? 'Click any cell to toggle access. Save when done.' : 'Permissions are enforced via RLS and server-side role checks.'}
        </p>
        {canEdit && (
          <div className="flex items-center gap-2">
            {saved && !dirty && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="btn-glossy-light btn-glossy-light-hover flex items-center gap-1.5 text-xs"
            >
              <Plus className="h-3 w-3" /> Add Role
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || pending}
              className="btn-gradient text-xs disabled:opacity-40"
            >
              {pending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Matrix */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm overflow-x-auto">
        {/* Header */}
        <div className="grid border-b border-border bg-muted/30 px-4 py-2.5 sticky top-0 z-10" style={gridStyle}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Screen / Action</span>
          {allRoles.map(roleKey => {
            const meta   = ROLE_META[roleKey]
            const custom = customRoles.find(r => r.name === roleKey)
            const label  = meta ? meta.label.split(' ')[0] : roleKey.slice(0, 8)
            const badge  = meta ? meta.badge : 'bg-muted text-foreground border border-border'
            return (
              <div key={roleKey} className="text-center flex flex-col items-center gap-0.5">
                <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${badge}`}>
                  {label}
                </span>
                {custom && canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRole(custom.id, custom.name)}
                    disabled={delPending}
                    className="text-muted-foreground/30 hover:text-red-500 transition-colors mt-0.5"
                    title={`Remove ${custom.name}`}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Groups + rows */}
        {groups.map(({ group, rows }) => (
          <div key={group}>
            <div className="grid px-4 py-1.5 bg-muted/20 border-b border-border/50" style={gridStyle}>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground col-span-1">{group}</span>
            </div>
            {rows.map(row => (
              <div
                key={row.label}
                className="grid items-center border-b border-border/40 last:border-0 px-4 hover:bg-muted/20 transition-colors"
                style={gridStyle}
              >
                <div className="py-2.5">
                  <span className="text-sm text-foreground">{row.label}</span>
                  {row.note && <p className="text-[10px] text-muted-foreground mt-0.5">{row.note}</p>}
                </div>
                {allRoles.map(roleKey => {
                  const k   = actionKey(row, roleKey)
                  const val = perms[k] ?? false

                  if (!canEdit) {
                    return (
                      <div key={roleKey} className="flex justify-center py-2.5">
                        {val ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Minus className="h-3 w-3 text-muted-foreground/30" />}
                      </div>
                    )
                  }

                  return (
                    <button
                      key={roleKey}
                      type="button"
                      onClick={() => toggle(row, roleKey)}
                      className="flex justify-center py-2.5 w-full rounded transition-colors hover:bg-muted/60 group"
                      title={val ? 'Click to deny access' : 'Click to grant access'}
                    >
                      {val
                        ? <Check className="h-3.5 w-3.5 text-emerald-600 group-hover:text-red-400 transition-colors" />
                        : <Minus className="h-3 w-3 text-muted-foreground/30 group-hover:text-emerald-500 transition-colors" />
                      }
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" /> Full access</div>
        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-sm bg-amber-400" /> Partial — see note</div>
        <div className="flex items-center gap-1.5"><Minus className="h-3 w-3 text-muted-foreground/30" /> No access</div>
        {canEdit && <div className="flex items-center gap-1.5 text-primary/70">Click any cell to toggle</div>}
      </div>

      {showModal && (
        <NewRoleModal onClose={() => setShowModal(false)} onCreated={handleRoleCreated} />
      )}
    </div>
  )
}
