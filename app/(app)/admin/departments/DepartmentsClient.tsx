'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, Pencil, Trash2, X } from 'lucide-react'
import { createDepartment, updateDepartment, deleteDepartment } from '@/lib/actions/admin/org'

interface Department {
  id: string
  name: string
  code?: string | null
  created_at: string
  teams: { id: string; name: string; slug: string }[]
}

interface DepartmentsClientProps {
  departments: Department[]
}

function DepartmentForm({
  initial,
  onClose,
}: {
  initial?: Department
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(initial?.code ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    if (!name.trim()) {
      setError('Department name is required.')
      return
    }
    setError(null)
    startTransition(async () => {
      const fields = { name: name.trim(), code: code.trim() || undefined }
      const result = initial
        ? await updateDepartment(initial.id, fields)
        : await createDepartment(fields)
      if (result.error) {
        setError(result.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{initial ? 'Edit Department' : 'New Department'}</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Code</label>
            <input
              value={code ?? ''}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ENG"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-soft">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="btn-gradient"
          >
            {isPending ? 'Saving…' : initial ? 'Save changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DepartmentsClient({ departments }: DepartmentsClientProps) {
  const router = useRouter()
  const [editing, setEditing] = useState<'new' | Department | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Department | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete(dept: Department) {
    setError(null)
    startTransition(async () => {
      const result = await deleteDepartment(dept.id)
      if (result.error) {
        setError(result.error)
        return
      }
      setConfirmDelete(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing('new')}
          className="btn-gradient"
        >
          <Plus className="h-3.5 w-3.5" />
          New Department
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No departments yet</p>
          <p className="text-xs text-muted-foreground/70">Create your first department to organize teams.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Department</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Teams</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {departments.map((dept) => (
                <tr key={dept.id} className="group transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="font-medium text-ink">{dept.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {dept.teams.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No teams assigned</span>
                      ) : (
                        dept.teams.map((team) => (
                          <span key={team.id} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                            {team.name}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(dept.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setEditing(dept)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-ink"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(dept)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DepartmentForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-foreground">Delete Department?</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Delete <span className="font-semibold text-foreground">{confirmDelete.name}</span>? This cannot be undone.
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
        </div>
      )}
    </div>
  )
}
