'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Trash2, MapPin, Users, Ticket, Clock, CheckCircle, X, Globe, Building2, BarChart3, List } from 'lucide-react'
import { createLocation, updateLocation, deleteLocation } from '@/lib/actions/admin/org'
import type { LocationStat } from './page'

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
]

type Tab = 'list' | 'analytics'

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-foreground">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
    </div>
  )
}

// ── Drawer form ───────────────────────────────────────────────────────────────

interface DrawerProps {
  initial?: LocationStat | null
  onClose: () => void
  onSaved: (loc: LocationStat) => void
}

function LocationDrawer({ initial, onClose, onSaved }: DrawerProps) {
  const isEdit = !!initial
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'UTC')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Location name is required.'); return }
    setError(null)
    startTransition(async () => {
      const fields = {
        name: name.trim(),
        code: code.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        timezone,
        is_active: isActive,
      }
      let result
      if (isEdit && initial) {
        result = await updateLocation(initial.id, fields)
      } else {
        result = await createLocation(fields)
      }
      if (result.error) { setError(result.error); return }
      onSaved({
        id: (result as any).data?.id ?? initial?.id ?? crypto.randomUUID(),
        name: fields.name,
        code: fields.code ?? null,
        city: fields.city ?? null,
        country: fields.country ?? null,
        timezone: fields.timezone,
        is_active: fields.is_active,
        created_at: initial?.created_at ?? new Date().toISOString(),
        user_count: initial?.user_count ?? 0,
        open_requests: initial?.open_requests ?? 0,
        total_requests: initial?.total_requests ?? 0,
        avg_resolution_hours: initial?.avg_resolution_hours ?? null,
      })
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      {/* Modal — centered */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl bg-card shadow-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {isEdit ? 'Edit Location' : 'Add Location'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isEdit ? `Updating ${initial?.name}` : 'Create a new site or office'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-4 px-5 py-5">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {/* Name + Code */}
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="text-destructive">*</span> Location Name
                </span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mumbai HQ" className={inputCls} required />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Code</span>
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="BOM" className={inputCls} />
              </label>
            </div>

            {/* City + Country */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">City</span>
                <input value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Country</span>
                <input value={country} onChange={e => setCountry(e.target.value)} placeholder="India" className={inputCls} />
              </label>
            </div>

            {/* Timezone */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timezone</span>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputCls}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>

            {/* Active toggle */}
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Inactive locations won't appear in user dropdowns</p>
              </div>
              <div
                onClick={() => setIsActive(v => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors ${isActive ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button type="button" onClick={onClose} className="btn-soft">
              Cancel
            </button>
            <button type="submit" disabled={isPending} className="btn-gradient">
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create Location'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Analytics tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ locations }: { locations: LocationStat[] }) {
  const active = locations.filter(l => l.is_active)
  const totalUsers = active.reduce((s, l) => s + l.user_count, 0)
  const totalRequests = active.reduce((s, l) => s + l.total_requests, 0)
  const totalOpen = active.reduce((s, l) => s + l.open_requests, 0)

  const sorted = [...active].sort((a, b) => b.total_requests - a.total_requests)
  const maxRequests = sorted[0]?.total_requests ?? 1

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Building2} label="Active Locations" value={active.length} color="bg-blue-50 text-blue-600" />
        <StatCard icon={Users} label="Users Across Sites" value={totalUsers} sub="with location assigned" color="bg-violet-50 text-violet-600" />
        <StatCard icon={Ticket} label="Total Requests" value={totalRequests} sub="from tagged locations" color="bg-amber-50 text-amber-600" />
        <StatCard icon={CheckCircle} label="Open Requests" value={totalOpen} sub="awaiting resolution" color="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Per-location breakdown */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3.5">
          <h3 className="text-sm font-semibold text-foreground">Location Breakdown</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Request volume and team distribution per site</p>
        </div>
        <div className="divide-y divide-border">
          {sorted.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No data yet — assign users and requests to locations to see analytics.</div>
          )}
          {sorted.map((loc) => (
            <div key={loc.id} className="flex items-center gap-4 px-5 py-4">
              {/* Icon + name */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground truncate">{loc.name}</span>
                  {loc.city && <span className="text-xs text-muted-foreground">· {loc.city}{loc.country ? `, ${loc.country}` : ''}</span>}
                  {loc.code && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">{loc.code}</span>}
                </div>
                {/* Bar */}
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(4, (loc.total_requests / maxRequests) * 100)}%` }}
                  />
                </div>
              </div>
              {/* Stats */}
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">{loc.user_count}</p>
                  <p className="text-[10px] text-muted-foreground">Users</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">{loc.total_requests}</p>
                  <p className="text-[10px] text-muted-foreground">Requests</p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-amber-600">{loc.open_requests}</p>
                  <p className="text-[10px] text-muted-foreground">Open</p>
                </div>
                <div className="text-center w-16">
                  <p className="text-xs font-semibold text-foreground">
                    {loc.avg_resolution_hours !== null ? `${loc.avg_resolution_hours}h` : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Avg resolve</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

export function LocationsClient({ locations: initial }: { locations: LocationStat[] }) {
  const [locations, setLocations] = useState<LocationStat[]>(initial)
  const [tab, setTab] = useState<Tab>('list')
  const [drawer, setDrawer] = useState<'add' | LocationStat | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.city?.toLowerCase().includes(search.toLowerCase()) ||
    l.country?.toLowerCase().includes(search.toLowerCase()) ||
    l.code?.toLowerCase().includes(search.toLowerCase())
  )

  function handleSaved(loc: LocationStat) {
    setLocations(prev => {
      const exists = prev.find(l => l.id === loc.id)
      return exists ? prev.map(l => l.id === loc.id ? loc : l) : [loc, ...prev]
    })
    setDrawer(null)
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteLocation(id)
      if (!result.error) {
        setLocations(prev => prev.filter(l => l.id !== id))
      }
      setConfirmDelete(null)
    })
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
          {([['list', List, 'Locations'], ['analytics', BarChart3, 'Analytics']] as const).map(([t, Icon, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setDrawer('add')} className="btn-gradient">
          <Plus className="h-3.5 w-3.5" />
          Add Location
        </button>
      </div>

      {tab === 'analytics' ? (
        <AnalyticsTab locations={locations} />
      ) : (
        <>
          {/* Search */}
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search locations…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_140px_100px_80px_80px_100px] gap-3 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Location</span>
              <span>Code</span>
              <span>Timezone</span>
              <span className="text-center">Users</span>
              <span className="text-center">Requests</span>
              <span>Status</span>
              <span />
            </div>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <MapPin className="h-8 w-8 opacity-30" />
                <p className="text-sm">{search ? 'No locations match your search.' : 'No locations yet. Add your first site.'}</p>
              </div>
            )}

            <div className="divide-y divide-border">
              {filtered.map((loc) => (
                <div
                  key={loc.id}
                  className="group grid grid-cols-[1fr_80px_140px_100px_80px_80px_100px] items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  {/* Name + city */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                      {(loc.city || loc.country) && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[loc.city, loc.country].filter(Boolean).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="font-mono text-xs text-muted-foreground">{loc.code ?? '—'}</span>

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">{loc.timezone}</span>
                  </div>

                  <div className="flex items-center justify-center gap-1 text-xs">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{loc.user_count}</span>
                  </div>

                  <div className="flex items-center justify-center gap-1 text-xs">
                    <Ticket className="h-3 w-3 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{loc.total_requests}</span>
                  </div>

                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    loc.is_active
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {loc.is_active ? 'Active' : 'Inactive'}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setDrawer(loc)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(loc.id)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Drawer */}
      {drawer !== null && (
        <LocationDrawer
          initial={drawer === 'add' ? null : drawer}
          onClose={() => setDrawer(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-foreground">Delete Location?</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Users assigned to this location will lose their location tag. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-soft">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={isPending}
                className="btn-danger"
              >
                {isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
