'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, Archive, Calendar, User, Link2 } from 'lucide-react'
import { updateProject, archiveProject } from '@/lib/actions/projects'
import { computeProjectProgressPct } from '@/lib/projects/progress'
import { ProjectStatusBadge, PROJECT_STATUS_LABELS } from './ProjectStatusBadge'
import { PROJECT_PRIORITY_STYLES, PROJECT_PRIORITY_ORDER as PRIORITY_ORDER } from './ProjectPriorityBadge'
import { ProjectMembers } from './ProjectMembers'
import type { ProjectWithDetails, ProjectStatus, ProjectPriority, ProjectProgress, ProjectMemberWithProfile } from '@/types'

const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']
const badgeSelectCls = 'chip-3d appearance-none text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-ring'
const metaSelectCls = 'rounded border border-transparent bg-transparent text-xs text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'
const dateInputCls = 'rounded border border-transparent bg-transparent text-xs text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'

export function ProjectHeader({
  project,
  progress,
  members,
  allProfiles,
}: {
  project: ProjectWithDetails
  progress: ProjectProgress
  members: ProjectMemberWithProfile[]
  allProfiles: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [status, setStatus] = useState(project.status)
  const [openStatus, setOpenStatus] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isSaving, setIsSaving] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(project.name)
  const [editingDescription, setEditingDescription] = useState(false)
  const [description, setDescription] = useState(project.description ?? '')
  const [editingReferences, setEditingReferences] = useState(false)
  const [referenceNotes, setReferenceNotes] = useState(project.reference_notes ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openStatus) return
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpenStatus(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openStatus])

  function changeStatus(value: ProjectStatus) {
    setOpenStatus(false)
    if (value === status) return
    const prev = status
    setStatus(value)
    startTransition(async () => {
      const r = await updateProject(project.id, { status: value })
      if (r.error) setStatus(prev)
    })
  }

  function patch(data: Parameters<typeof updateProject>[1], revert?: () => void) {
    setIsSaving(true)
    startTransition(async () => {
      const r = await updateProject(project.id, data)
      if (r.error) {
        toast.error(r.error)
        revert?.()
        setIsSaving(false)
        return
      }
      router.refresh()
      setIsSaving(false)
    })
  }

  function saveName() {
    setEditingName(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name) { setName(project.name); return }
    patch({ name: trimmed }, () => setName(project.name))
  }

  function saveDescription() {
    setEditingDescription(false)
    if (description.trim() === (project.description ?? '')) return
    patch({ description: description.trim() }, () => setDescription(project.description ?? ''))
  }

  function saveReferenceNotes() {
    setEditingReferences(false)
    if (referenceNotes.trim() === (project.reference_notes ?? '')) return
    patch({ referenceNotes: referenceNotes.trim() }, () => setReferenceNotes(project.reference_notes ?? ''))
  }

  function handleArchive() {
    if (!confirm(`Archive "${project.name}"? Linked tasks and requests keep their status.`)) return
    startTransition(async () => {
      const r = await archiveProject(project.id)
      if (r.error) { toast.error(r.error); return }
      router.push('/projects')
    })
  }

  const pct = computeProjectProgressPct(status, progress)

  return (
    <div className={`space-y-2.5 rounded-lg border border-[#E8E8F0] bg-white p-3.5 dark:border-border dark:bg-card ${isSaving ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: title + meta */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            {editingName ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') { setName(project.name); setEditingName(false) }
                }}
                className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 text-base font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <h1
                onClick={() => setEditingName(true)}
                title="Click to rename"
                className="cursor-text rounded px-0.5 text-base font-bold text-foreground hover:bg-muted/50"
              >
                {project.name}
              </h1>
            )}
            <select
              value={project.priority}
              onChange={(e) => patch({ priority: e.target.value as ProjectPriority })}
              className={`${badgeSelectCls} ${PROJECT_PRIORITY_STYLES[project.priority]}`}
            >
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {editingDescription ? (
            <textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setDescription(project.description ?? ''); setEditingDescription(false) }
              }}
              placeholder="Add a description…"
              rows={2}
              className="w-full max-w-2xl rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <p
              onClick={() => setEditingDescription(true)}
              title="Click to edit"
              className="max-w-2xl cursor-text rounded px-0.5 text-xs text-muted-foreground hover:bg-muted/50"
            >
              {project.description || 'Add a description…'}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <select
                value={project.owner.id}
                onChange={(e) => patch({ ownerId: e.target.value })}
                className={metaSelectCls}
              >
                {allProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              <select
                value={project.functional_owner?.id ?? ''}
                onChange={(e) => patch({ functionalOwnerId: e.target.value || null })}
                className={metaSelectCls}
              >
                <option value="">No functional owner</option>
                {allProfiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <span className="text-muted-foreground/60">(functional)</span>
            </span>
            {project.team && <span>{project.team.name}</span>}
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Start
              <input
                type="date"
                value={project.start_date ?? ''}
                onChange={(e) => patch({ startDate: e.target.value || null })}
                className={dateInputCls}
              />
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Target
              <input
                type="date"
                value={project.target_date ?? ''}
                onChange={(e) => patch({ targetDate: e.target.value || null })}
                className={dateInputCls}
              />
            </span>
          </div>

          <div className="flex items-start gap-1 pt-0.5">
            <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            {editingReferences ? (
              <textarea
                autoFocus
                value={referenceNotes}
                onChange={(e) => setReferenceNotes(e.target.value)}
                onBlur={saveReferenceNotes}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setReferenceNotes(project.reference_notes ?? ''); setEditingReferences(false) }
                }}
                placeholder="Links, notes, or examples this project is based on…"
                rows={2}
                className="w-full max-w-2xl rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <p
                onClick={() => setEditingReferences(true)}
                title="Click to edit"
                className="max-w-2xl cursor-text rounded px-0.5 text-xs text-muted-foreground hover:bg-muted/50"
              >
                {project.reference_notes || 'Add references / inspiration…'}
              </p>
            )}
          </div>
        </div>

        {/* Right: status/archive + members, stacked so this column stays compact */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <div className="relative" ref={ref}>
              <button
                onClick={() => setOpenStatus((v) => !v)}
                disabled={isPending}
                className="inline-flex items-center gap-1"
              >
                <ProjectStatusBadge status={status} />
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {openStatus && (
                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-border bg-card shadow-lg py-1">
                  {STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      onClick={() => changeStatus(s)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 ${s === status ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                    >
                      {PROJECT_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleArchive}
              title="Archive project"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Archive className="h-4 w-4" />
            </button>
          </div>

          <ProjectMembers projectId={project.id} members={members} allProfiles={allProfiles} />
        </div>
      </div>

      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {progress.total === 0
            ? 'No linked work yet'
            : `${progress.done} done · ${progress.in_progress} in progress · ${progress.blocked} blocked · ${progress.not_started} not started · ${progress.cancelled} cancelled`}
        </p>
      </div>
    </div>
  )
}
