'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Archive, Calendar, User } from 'lucide-react'
import { updateProject, archiveProject } from '@/lib/actions/projects'
import { ProjectStatusBadge, PROJECT_STATUS_LABELS } from './ProjectStatusBadge'
import { ProjectPriorityBadge } from './ProjectPriorityBadge'
import { ProjectMembers } from './ProjectMembers'
import type { ProjectWithDetails, ProjectStatus, ProjectProgress, ProjectMemberWithProfile } from '@/types'

const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']

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

  function handleArchive() {
    if (!confirm(`Archive "${project.name}"? Linked tasks and requests keep their status.`)) return
    startTransition(async () => {
      await archiveProject(project.id)
      router.push('/projects')
    })
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-2.5 rounded-lg border border-[#E8E8F0] bg-white p-3.5 dark:border-border dark:bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: title + meta */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-foreground">{project.name}</h1>
            <ProjectPriorityBadge priority={project.priority} size="sm" />
          </div>
          {project.description && (
            <p className="max-w-2xl text-xs text-muted-foreground">{project.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {project.owner.full_name}
            </span>
            {project.functional_owner && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {project.functional_owner.full_name} <span className="text-muted-foreground/60">(functional)</span>
              </span>
            )}
            {project.team && <span>{project.team.name}</span>}
            {project.target_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Target {new Date(project.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
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
