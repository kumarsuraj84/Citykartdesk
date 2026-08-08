'use client'

import { useState, useTransition, useMemo, useRef, useEffect } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronRight, X, UserMinus, UserPlus, Search,
} from 'lucide-react'
import {
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
} from '@/lib/actions/admin/teams'
import type { TeamWithMembers, UserOption } from './page'

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  teamId,
  onRemoved,
}: {
  member: { id: string; full_name: string; is_lead: boolean }
  teamId: string
  onRemoved: (userId: string) => void
}) {
  const [isPending, start] = useTransition()

  function handleRemove() {
    start(async () => {
      const result = await removeTeamMember(teamId, member.id)
      if (!result.error) {
        onRemoved(member.id)
      }
    })
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-background px-3 py-2 group">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
        {member.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
      </div>
      <span className="flex-1 text-sm text-foreground">{member.full_name}</span>
      {member.is_lead && (
        <span className="rounded-full bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
          Lead
        </span>
      )}
      <button
        onClick={handleRemove}
        disabled={isPending}
        className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
        title="Remove from team"
      >
        <UserMinus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Add member dropdown ───────────────────────────────────────────────────────

function AddMemberDropdown({
  teamId,
  allUsers,
  existingMemberIds,
  onAdded,
}: {
  teamId: string
  allUsers: UserOption[]
  existingMemberIds: Set<string>
  onAdded: (user: UserOption) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isPending, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  const candidates = useMemo(
    () =>
      allUsers.filter(
        (u) =>
          !existingMemberIds.has(u.id) &&
          u.full_name.toLowerCase().includes(search.toLowerCase()),
      ),
    [allUsers, existingMemberIds, search],
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleAdd(user: UserOption) {
    start(async () => {
      const result = await addTeamMember(teamId, user.id)
      if (!result.error) {
        onAdded(user)
        setOpen(false)
        setSearch('')
      }
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Add member
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users…"
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No users found</p>
            ) : (
              candidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleAdd(u)}
                  disabled={isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {u.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  {u.full_name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Team card ─────────────────────────────────────────────────────────────────

function TeamCard({
  team,
  allUsers,
  onDeleted,
}: {
  team: TeamWithMembers
  allUsers: UserOption[]
  onDeleted: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [members, setMembers] = useState(team.members)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(team.name)
  const [error, setError] = useState<string | null>(null)
  const [isPending, start] = useTransition()

  const existingMemberIds = useMemo(() => new Set(members.map((m) => m.id)), [members])

  function handleRename() {
    if (!name.trim() || name === team.name) { setEditingName(false); return }
    start(async () => {
      const result = await updateTeam(team.id, name.trim())
      if (result.error) { setError(result.error); return }
      setEditingName(false)
      setError(null)
    })
  }

  function handleDelete() {
    if (!confirm(`Delete team "${name}"? This cannot be undone.`)) return
    start(async () => {
      const result = await deleteTeam(team.id)
      if (result.error) { setError(result.error); return }
      onDeleted(team.id)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') { setName(team.name); setEditingName(false) }
            }}
            className="flex-1 rounded-lg border border-ring bg-background px-2 py-1 text-sm font-semibold focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex-1 text-left text-sm font-semibold text-foreground hover:text-primary transition-colors"
          >
            {name}
          </button>
        )}

        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {members.length} member{members.length !== 1 ? 's' : ''}
        </span>

        {team.service_names.length > 0 && (
          <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">
            {team.service_names.length} service{team.service_names.length !== 1 ? 's' : ''}
          </span>
        )}

        <button
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
          title="Delete team"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          <X className="h-3.5 w-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="p-3 space-y-2">
          {/* Services list */}
          {team.service_names.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-2 border-b border-border/40">
              {team.service_names.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Members */}
          {members.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">No members yet.</p>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                teamId={team.id}
                onRemoved={(userId) => setMembers((prev) => prev.filter((x) => x.id !== userId))}
              />
            ))
          )}

          {/* Add member */}
          <AddMemberDropdown
            teamId={team.id}
            allUsers={allUsers}
            existingMemberIds={existingMemberIds}
            onAdded={(user) =>
              setMembers((prev) => [...prev, { id: user.id, full_name: user.full_name, is_lead: false }])
            }
          />
        </div>
      )}
    </div>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

export function TeamManagementClient({
  initialTeams,
  allUsers,
}: {
  initialTeams: TeamWithMembers[]
  allUsers: UserOption[]
}) {
  const [teams, setTeams] = useState<TeamWithMembers[]>(initialTeams)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, start] = useTransition()

  function handleCreate() {
    if (!newName.trim()) return
    start(async () => {
      const result = await createTeam(newName.trim())
      if (result.error) { setFormError(result.error); return }
      setTeams((prev) => [
        {
          id: result.data!.id,
          name: newName.trim(),
          slug: '',
          prefix: '',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          member_count: 0,
          members: [],
          service_names: [],
        },
        ...prev,
      ])
      setNewName('')
      setShowForm(false)
      setFormError(null)
    })
  }

  return (
    <div className="space-y-3">
      {/* Create form */}
      {showForm ? (
        <div className="rounded-xl border border-ring bg-card p-3 space-y-2">
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setShowForm(false); setNewName(''); setFormError(null) }
              }}
              placeholder="Team name (e.g. IT Support)"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleCreate}
              disabled={isPending || !newName.trim()}
              className="btn-gradient disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setNewName(''); setFormError(null) }}
              className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
          {formError && (
            <p className="text-xs text-red-600">{formError}</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
        >
          <Plus className="h-4 w-4" />
          New Team
        </button>
      )}

      {/* Team list */}
      {teams.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-border bg-card">
          <p className="text-sm font-medium text-muted-foreground">No teams yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a team to start assigning members and services.
          </p>
        </div>
      ) : (
        teams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            allUsers={allUsers}
            onDeleted={(id) => setTeams((prev) => prev.filter((x) => x.id !== id))}
          />
        ))
      )}
    </div>
  )
}
