'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { X, UserPlus, ChevronDown, Pencil, KeyRound, Send, MessageCircle } from 'lucide-react'
import {
  updateUserRole,
  toggleUserActive,
  updateUserProfile,
  inviteUser,
  setUserTeams,
  adminSendPasswordReset,
  adminSetPassword,
  addMobileNumber,
  removeMobileNumber,
  exportUsersCsv,
} from '@/lib/actions/admin/users'
import type { UserWithTeams, Department, Location, Store, CostCenter, JobFunction, Designation, ProfileMini, TeamOption } from './page'
import type { UserRole } from '@/types'
import { ROLE_LABELS, ROLE_BADGE_STYLES } from '@/lib/constants/roles'
import { BulkImportUsersDialog } from '@/components/admin/BulkImportUsersDialog'
import { BulkPasswordResetDialog } from '@/components/admin/BulkPasswordResetDialog'
import { ExportButton } from '@/components/requests/ExportButton'
import { normalizeMobileNumber } from '@/lib/users/mobile'

// Every role the DB/RLS actually recognizes (user_role enum) — the role select
// previously hardcoded just ['admin','manager','user'], silently omitting
// 'agent' and 'platform_owner' even though both are fully wired everywhere
// else (RLS policies, ROLE_BADGE_STYLES, the UserRole type itself).
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'user',           label: ROLE_LABELS.user },
  { value: 'agent',          label: ROLE_LABELS.agent },
  { value: 'manager',        label: ROLE_LABELS.manager },
  { value: 'admin',          label: ROLE_LABELS.admin },
  { value: 'platform_owner', label: ROLE_LABELS.platform_owner },
]

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ROLE_BADGE_STYLES[role] ?? 'text-slate-600 bg-slate-50 border-slate-200'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const colors = ['bg-violet-100 text-violet-700','bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700']
  const color = colors[(name.charCodeAt(0) || 0) % colors.length]
  const sz = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-xs'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sz} ${color}`}>
      {initials(name || '?')}
    </span>
  )
}

// ─── Password reset (admin-only) ───────────────────────────────────────────────

function PasswordSection({ userId, email }: { userId: string; email: string | null }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [showDirectSet, setShowDirectSet] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  function handleSendReset() {
    setMessage(null)
    startTransition(async () => {
      const result = await adminSendPasswordReset(email ?? '')
      setMessage(
        result.error
          ? { type: 'error', text: result.error }
          : { type: 'success', text: `Reset link sent to ${email}.` }
      )
    })
  }

  function handleSetPassword() {
    setMessage(null)
    startTransition(async () => {
      const result = await adminSetPassword(userId, newPassword)
      if (result.error) {
        setMessage({ type: 'error', text: result.error })
        return
      }
      setMessage({ type: 'success', text: 'Password updated.' })
      setNewPassword('')
      setShowDirectSet(false)
    })
  }

  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Password</h3>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSendReset}
          disabled={pending || !email}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
        >
          <Send className="h-3.5 w-3.5" />
          Send reset email
        </button>
        <button
          type="button"
          onClick={() => setShowDirectSet(s => !s)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Set password directly
        </button>
      </div>

      {showDirectSet && (
        <div className="flex gap-2">
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="input-field flex-1"
          />
          <button
            type="button"
            onClick={handleSetPassword}
            disabled={pending || newPassword.length < 8}
            className="btn-gradient disabled:opacity-40 shrink-0"
          >
            Set
          </button>
        </div>
      )}

      {message && (
        <p className={`text-xs rounded-lg px-3 py-2 border ${
          message.type === 'error'
            ? 'text-red-600 bg-red-50 border-red-100'
            : 'text-emerald-700 bg-emerald-50 border-emerald-100'
        }`}>
          {message.text}
        </p>
      )}
    </section>
  )
}

// ─── Edit Drawer ──────────────────────────────────────────────────────────────

interface EditDrawerProps {
  user: UserWithTeams & { email: string | null }
  departments: Department[]
  locations: Location[]
  stores: Store[]
  costCenters: CostCenter[]
  jobFunctions: JobFunction[]
  designations: Designation[]
  profiles: ProfileMini[]
  teams: TeamOption[]
  isAdmin: boolean
  currentUserId: string
  onClose: () => void
}

function EditDrawer({ user, departments, locations, stores, costCenters, jobFunctions, designations, profiles, teams, isAdmin, currentUserId, onClose }: EditDrawerProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const orgUser = user as UserWithTeams & {
    email: string | null
    department_id?: string | null
    location_id?: string | null
    store_id?: string | null
    cost_center_id?: string | null
    function_id?: string | null
    designation_id?: string | null
    employee_id?: string | null
    job_title?: string | null
    manager_id?: string | null
    mobile_numbers?: string[]
    whatsapp_enabled?: boolean
  }

  const initialTeamIds = user.team_members.map(tm => tm.team_id)

  const [form, setForm] = useState({
    full_name:     user.full_name ?? '',
    job_title:     orgUser.job_title ?? '',
    employee_id:   orgUser.employee_id ?? '',
    department_id: orgUser.department_id ?? '',
    location_id:   orgUser.location_id ?? '',
    store_id:      orgUser.store_id ?? '',
    cost_center_id:orgUser.cost_center_id ?? '',
    function_id:   orgUser.function_id ?? '',
    designation_id:orgUser.designation_id ?? '',
    manager_id:    orgUser.manager_id ?? '',
    role:          user.role as UserRole,
  })
  const [whatsappEnabled, setWhatsappEnabled] = useState(orgUser.whatsapp_enabled ?? true)
  const [selectedTeams, setSelectedTeams] = useState<string[]>(initialTeamIds)

  // Mobile numbers (many:1 — a shared "store" login can have several
  // phones) are added/removed one at a time via their own server actions,
  // independent of handleSave()'s batched field-save below — see
  // keen-mapping-adleman.md.
  const [mobileNumbers, setMobileNumbers] = useState<string[]>(orgUser.mobile_numbers ?? [])
  const [newMobileInput, setNewMobileInput] = useState('')
  const [mobileError, setMobileError] = useState<string | null>(null)
  const [mobilePending, startMobileTransition] = useTransition()

  const isSelf = user.id === currentUserId

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    setSuccess(false)
  }

  function toggleTeam(id: string) {
    setSelectedTeams(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
    setSuccess(false)
  }

  function handleAddMobile() {
    setMobileError(null)
    const check = normalizeMobileNumber(newMobileInput)
    if (!check.ok) { setMobileError(check.error); return }
    startMobileTransition(async () => {
      const result = await addMobileNumber(user.id, newMobileInput)
      if (result.error) { setMobileError(result.error); return }
      setMobileNumbers(prev => [...prev, check.normalized])
      setNewMobileInput('')
      router.refresh()
    })
  }

  function handleRemoveMobile(number: string) {
    setMobileError(null)
    startMobileTransition(async () => {
      const result = await removeMobileNumber(user.id, number)
      if (result.error) { setMobileError(result.error); return }
      setMobileNumbers(prev => prev.filter(n => n !== number))
      router.refresh()
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const [r1, r2, r3] = await Promise.all([
        updateUserProfile(user.id, {
          full_name:     form.full_name,
          job_title:     form.job_title || null,
          employee_id:   form.employee_id || null,
          department_id: form.department_id || null,
          location_id:   form.location_id || null,
          store_id:      form.store_id || null,
          cost_center_id:form.cost_center_id || null,
          function_id:   form.function_id || null,
          designation_id:form.designation_id || null,
          manager_id:    form.manager_id || null,
          whatsapp_enabled: whatsappEnabled,
        }),
        isAdmin && !isSelf && form.role !== user.role
          ? updateUserRole(user.id, form.role)
          : Promise.resolve<{ error?: string }>({}),
        setUserTeams(user.id, selectedTeams),
      ])
      const err = r1.error ?? r2.error ?? r3.error
      if (err) { setError(err); return }
      setSuccess(true)
      router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Modal */}
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl bg-background shadow-2xl border border-border max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <Avatar name={form.full_name || user.email || '?'} />
            <div>
              <p className="text-sm font-semibold text-foreground">{form.full_name || 'User'}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Identity */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Identity</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full Name">
                <input value={form.full_name} onChange={e => set('full_name', e.target.value)} className="input-field" placeholder="Jane Smith" />
              </Field>
              <Field label="Employee ID">
                <input value={form.employee_id} onChange={e => set('employee_id', e.target.value)} className="input-field" placeholder="EMP-0042" />
              </Field>
            </div>
            <Field label="Job Title">
              <input value={form.job_title} onChange={e => set('job_title', e.target.value)} className="input-field" placeholder="e.g. IT Support Engineer" />
            </Field>
          </section>

          {/* WhatsApp identity (Stage 2, many-numbers-per-user as of the
              profile_mobile_numbers migration) */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">WhatsApp</h3>
            <Field label="Mobile Numbers">
              {mobileNumbers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {mobileNumbers.map(number => (
                    <span key={number} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground">
                      {number}
                      <button
                        type="button"
                        onClick={() => handleRemoveMobile(number)}
                        disabled={mobilePending}
                        className="text-muted-foreground hover:text-red-600 disabled:opacity-50"
                        aria-label={`Remove ${number}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newMobileInput}
                  onChange={e => { setNewMobileInput(e.target.value); setMobileError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMobile() } }}
                  className="input-field flex-1"
                  placeholder="9876543210"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={handleAddMobile}
                  disabled={mobilePending || !newMobileInput.trim()}
                  className="shrink-0 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  + Add
                </button>
              </div>
              {mobileError && <p className="mt-1 text-[11px] text-red-600">{mobileError}</p>}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Add every phone that should be able to text WhatsApp for this account — e.g. every cashier&apos;s phone for a shared store login. Every ticket created from any of these numbers is attributed to this one user.
              </p>
            </Field>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={e => { setWhatsappEnabled(e.target.checked); setSuccess(false) }}
                className="h-3.5 w-3.5"
              />
              WhatsApp ticketing enabled
            </label>
          </section>

          {/* Role */}
          {isAdmin && !isSelf && (
            <section className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Role</h3>
              <Field label="System Role">
                <select value={form.role} onChange={e => set('role', e.target.value)} className="input-field">
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
            </section>
          )}

          {/* Password */}
          {isAdmin && !isSelf && <PasswordSection userId={user.id} email={user.email} />}

          {/* Teams */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Teams</h3>
            <div className="flex flex-wrap gap-2">
              {teams.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTeam(t.id)}
                  className={[
                    'rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors',
                    selectedTeams.includes(t.id)
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground/40',
                  ].join(' ')}
                >
                  {t.name}
                </button>
              ))}
              {teams.length === 0 && <p className="text-xs text-muted-foreground">No teams configured.</p>}
            </div>
          </section>

          {/* Org Structure */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Organisation</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Manager">
                <SelectField value={form.manager_id} onChange={v => set('manager_id', v)} options={profiles.filter(p => p.id !== user.id).map(p => ({ value: p.id, label: p.full_name }))} placeholder="No manager" />
              </Field>
              <Field label="Department">
                <SelectField value={form.department_id} onChange={v => set('department_id', v)} options={departments.map(d => ({ value: d.id, label: d.name }))} placeholder="No department" />
              </Field>
              <Field label="Location">
                <SelectField value={form.location_id} onChange={v => set('location_id', v)} options={locations.map(l => ({ value: l.id, label: [l.name, l.city].filter(Boolean).join(', ') }))} placeholder="No location" />
              </Field>
              <Field label="Store">
                <SelectField value={form.store_id} onChange={v => set('store_id', v)} options={stores.map(s => ({ value: s.id, label: `${s.code} — ${s.name}` }))} placeholder="No store" />
              </Field>
              <Field label="Cost Center">
                <SelectField value={form.cost_center_id} onChange={v => set('cost_center_id', v)} options={costCenters.map(c => ({ value: c.id, label: c.name }))} placeholder="No cost center" />
              </Field>
              <Field label="Function">
                <SelectField value={form.function_id} onChange={v => set('function_id', v)} options={jobFunctions.map(f => ({ value: f.id, label: f.name }))} placeholder="No function" />
              </Field>
              <Field label="Designation">
                <SelectField value={form.designation_id} onChange={v => set('designation_id', v)} options={designations.map(d => ({ value: d.id, label: d.name }))} placeholder="No designation" />
              </Field>
            </div>
          </section>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          {success && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">Changes saved.</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 shrink-0">
          {isAdmin && !isSelf && <ToggleActiveButton user={user} />}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
              Cancel
            </button>
            <button onClick={handleSave} disabled={pending} className="btn-gradient disabled:opacity-40">
              {pending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleActiveButton({ user }: { user: UserWithTeams }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function handleToggle() {
    if (user.is_active && !confirm(`Deactivate ${user.full_name}? They will no longer be able to log in.`)) return
    setError(null)
    startTransition(async () => {
      const result = await toggleUserActive(user.id, !user.is_active)
      if (result.error) { setError(result.error); return }
      router.refresh()
    })
  }
  return (
    <div>
      <button
        onClick={handleToggle}
        disabled={pending}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
          user.is_active
            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        }`}
      >
        {user.is_active ? 'Deactivate' : 'Reactivate'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  departments: Department[]
  locations: Location[]
  stores: Store[]
  profiles: ProfileMini[]
  teams: TeamOption[]
  onClose: () => void
}

function InviteModal({ departments, locations, stores, profiles, teams, onClose }: InviteModalProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    role: 'user' as UserRole,
    job_title: '',
    department_id: '',
    location_id: '',
    store_id: '',
    manager_id: '',
    team_id: '',
    mobile_number: '',
  })
  const [whatsappEnabled, setWhatsappEnabled] = useState(true)

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleInvite() {
    setError(null)
    if (form.mobile_number.trim() && !normalizeMobileNumber(form.mobile_number).ok) {
      setError('Enter a valid 10-digit Indian mobile number, or leave it blank.')
      return
    }
    startTransition(async () => {
      const result = await inviteUser({
        email: form.email,
        full_name: form.full_name,
        role: form.role,
        job_title: form.job_title || null,
        department_id: form.department_id || null,
        location_id: form.location_id || null,
        store_id: form.store_id || null,
        manager_id: form.manager_id || null,
        team_id: form.team_id || null,
        mobile_number: form.mobile_number || null,
        whatsapp_enabled: whatsappEnabled,
      })
      if (result.error) { setError(result.error); return }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-background shadow-2xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Invite New User</h2>
            <p className="text-xs text-muted-foreground">A new account will be created immediately.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          <Field label="Email *">
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              className="input-field"
              placeholder="jane@company.com"
              autoFocus
            />
          </Field>
          <Field label="Full Name *">
            <input
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              className="input-field"
              placeholder="Jane Smith"
            />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={e => set('role', e.target.value)} className="input-field">
              {ROLE_OPTIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Job Title">
            <input
              value={form.job_title}
              onChange={e => set('job_title', e.target.value)}
              className="input-field"
              placeholder="e.g. Support Engineer"
            />
          </Field>
          <Field label="Mobile Number">
            <input
              value={form.mobile_number}
              onChange={e => set('mobile_number', e.target.value)}
              className="input-field"
              placeholder="9876543210"
              inputMode="numeric"
            />
            {form.mobile_number.trim() && !normalizeMobileNumber(form.mobile_number).ok && (
              <p className="mt-1 text-[11px] text-red-600">
                {(normalizeMobileNumber(form.mobile_number) as { ok: false; error: string }).error}
              </p>
            )}
          </Field>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={whatsappEnabled}
              onChange={e => setWhatsappEnabled(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            WhatsApp ticketing enabled
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <SelectField
                value={form.department_id}
                onChange={v => set('department_id', v)}
                options={departments.map(d => ({ value: d.id, label: d.name }))}
                placeholder="None"
              />
            </Field>
            <Field label="Location">
              <SelectField
                value={form.location_id}
                onChange={v => set('location_id', v)}
                options={locations.map(l => ({ value: l.id, label: l.name }))}
                placeholder="None"
              />
            </Field>
            <Field label="Store">
              <SelectField
                value={form.store_id}
                onChange={v => set('store_id', v)}
                options={stores.map(s => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
                placeholder="None"
              />
            </Field>
            <Field label="Manager">
              <SelectField
                value={form.manager_id}
                onChange={v => set('manager_id', v)}
                options={profiles.map(p => ({ value: p.id, label: p.full_name }))}
                placeholder="None"
              />
            </Field>
            <Field label="Team">
              <SelectField
                value={form.team_id}
                onChange={v => set('team_id', v)}
                options={teams.map(t => ({ value: t.id, label: t.name }))}
                placeholder="No team"
              />
            </Field>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleInvite}
            disabled={pending || !form.email || !form.full_name}
            className="btn-gradient disabled:opacity-40 flex items-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {pending ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function SelectField({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-field appearance-none pr-7"
      >
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}

// ─── User Row ─────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: UserWithTeams
  profiles: ProfileMini[]
  departments: Department[]
  locations: Location[]
  costCenters: CostCenter[]
  currentUserId: string
  isAdmin: boolean
  onEdit: () => void
}

function UserRow({ user, profiles, departments, onEdit, currentUserId, isAdmin }: UserRowProps) {
  const isSelf = user.id === currentUserId
  const teams  = user.team_members.map(tm => tm.team?.name).filter(Boolean)
  const orgUser = user as UserWithTeams & {
    department_id?: string | null
    manager_id?: string | null
    job_title?: string | null
    employee_id?: string | null
    mobile_numbers?: string[]
    whatsapp_enabled?: boolean
  }
  const deptName = departments.find(d => d.id === orgUser.department_id)?.name
  const managerName = profiles.find(p => p.id === orgUser.manager_id)?.full_name
  const whatsappReady = (orgUser.mobile_numbers?.length ?? 0) > 0 && orgUser.whatsapp_enabled !== false

  return (
    <div className="grid grid-cols-[auto_1fr_140px_120px_100px_100px] items-center gap-x-3 border-b border-[#EEF2F8] last:border-0 px-4 py-2.5 hover:bg-[#FAFBFF] transition-colors group">
      {/* Avatar */}
      <Avatar name={user.full_name || user.email || '?'} size="sm" />

      {/* Name + email + meta */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[12px] font-semibold text-[#1A1F36]">
            {user.full_name || <span className="text-[#A0AEC0] italic">No name</span>}
          </p>
          {isSelf && (
            <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 shrink-0">You</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-[11px] text-[#7B8DB0]">{user.email ?? '—'}</span>
          {orgUser.job_title && <span className="text-[10px] text-muted-foreground/70">· {orgUser.job_title}</span>}
          {deptName && <span className="text-[10px] text-violet-600/80 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">{deptName}</span>}
          {managerName && <span className="text-[10px] text-blue-600/80 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">↑ {managerName}</span>}
          {whatsappReady && (
            <span title={`WhatsApp: ${orgUser.mobile_numbers!.join(', ')}`} className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600/80 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
              <MessageCircle className="h-2.5 w-2.5" /> WhatsApp{orgUser.mobile_numbers!.length > 1 ? ` (${orgUser.mobile_numbers!.length})` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Role */}
      <div><RoleBadge role={user.role as UserRole} /></div>

      {/* Teams */}
      <div className="flex flex-wrap gap-1 min-w-0">
        {teams.length > 0 ? teams.slice(0, 2).map(name => (
          <span key={name} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground truncate max-w-[100px]">{name}</span>
        )) : <span className="text-xs text-muted-foreground">—</span>}
        {teams.length > 2 && <span className="text-[10px] text-muted-foreground">+{teams.length - 2}</span>}
      </div>

      {/* Status */}
      <div>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${user.is_active ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-50 border-slate-200'}`}>
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Edit button */}
      <div className="flex justify-end">
        {(isAdmin || !isSelf) && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Client ──────────────────────────────────────────────────────────────

interface Props {
  initialUsers: UserWithTeams[]
  currentUserId: string
  isAdmin: boolean
  departments: Department[]
  locations: Location[]
  stores: Store[]
  costCenters: CostCenter[]
  jobFunctions: JobFunction[]
  designations: Designation[]
  profiles: ProfileMini[]
  teams: TeamOption[]
}

export function UserManagementClient({ initialUsers, currentUserId, isAdmin, departments, locations, stores, costCenters, jobFunctions, designations, profiles, teams }: Props) {
  const [search, setSearch] = useState('')
  const [editUser, setEditUser] = useState<UserWithTeams | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return initialUsers
    return initialUsers.filter(u =>
      u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    )
  }, [initialUsers, search])

  return (
    <section className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[#E2E8F4] bg-white py-1.5 pl-8 pr-3 text-[13px] text-[#1A1F36] placeholder:text-[#A0AEC0] focus:outline-none focus:ring-2 focus:ring-[#1B2559]/20"
          />
        </div>
        <p className="text-sm text-muted-foreground flex-1">
          {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
        </p>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <ExportButton action={exportUsersCsv} filename={`users-${new Date().toISOString().slice(0, 10)}`} label="Export" />
            <BulkImportUsersDialog />
            <BulkPasswordResetDialog />
            <button
              onClick={() => setShowInvite(true)}
              className="btn-gradient flex items-center gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Invite User
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E2E8F4] bg-white overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[auto_1fr_140px_120px_100px_100px] gap-x-3 border-b border-[#E2E8F4] bg-[#F8FAFD] px-4 py-2.5">
          <div className="w-7" />
          {['User', 'Role', 'Teams', 'Status', ''].map(h => (
            <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-[#7B8DB0]">{h}</span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? 'No users match your search.' : 'No users found.'}
          </div>
        ) : (
          filtered.map(user => (
            <UserRow
              key={user.id}
              user={user}
              profiles={profiles}
              departments={departments}
              locations={locations}
              costCenters={costCenters}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onEdit={() => setEditUser(user)}
            />
          ))
        )}
      </div>

      {/* Edit Modal */}
      {editUser && (
        <EditDrawer
          user={editUser}
          departments={departments}
          locations={locations}
          stores={stores}
          costCenters={costCenters}
          jobFunctions={jobFunctions}
          designations={designations}
          profiles={profiles}
          teams={teams}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setEditUser(null)}
        />
      )}

      {/* Invite Modal */}
      {showInvite && (
        <InviteModal
          departments={departments}
          locations={locations}
          stores={stores}
          profiles={profiles}
          teams={teams}
          onClose={() => setShowInvite(false)}
        />
      )}
    </section>
  )
}
