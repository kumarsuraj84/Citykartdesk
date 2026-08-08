'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Calendar } from 'lucide-react'
import { updateProject } from '@/lib/actions/projects'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from './ProjectStatusBadge'
import { PROJECT_PRIORITY_STYLES, PROJECT_PRIORITY_ORDER as PRIORITY_ORDER } from './ProjectPriorityBadge'
import type { ProjectWithDetails, ProjectProgress, ProjectStatus, ProjectPriority } from '@/types'

const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']
const badgeSelectCls = 'appearance-none rounded px-2 py-0.5 text-[11px] font-semibold hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
      {initials}
    </span>
  )
}

export function ProjectCard({ project, progress, profiles = [] }: {
  project: ProjectWithDetails
  progress: ProjectProgress
  profiles?: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [isSaving, setIsSaving] = useState(false)
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  function patch(data: Parameters<typeof updateProject>[1]) {
    setIsSaving(true)
    startTransition(async () => {
      const r = await updateProject(project.id, data)
      if (r.error) { toast.error(r.error); setIsSaving(false); return }
      router.refresh()
      setIsSaving(false)
    })
  }

  // Interactive fields stop propagation so they don't trigger the card's own navigation link.
  function stop(e: React.SyntheticEvent) { e.preventDefault(); e.stopPropagation() }

  return (
    <Link
      href={`/projects/${project.id}`}
      className={`flex flex-col gap-3 rounded-lg border border-[#E8E8F0] bg-white p-4 transition-colors hover:border-primary/40 dark:border-border dark:bg-card ${isSaving ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{project.name}</h3>
        <div className="flex shrink-0 items-center gap-1.5" onClick={stop}>
          <select
            value={project.priority}
            onChange={(e) => patch({ priority: e.target.value as ProjectPriority })}
            className={`chip-3d appearance-none text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-ring ${PROJECT_PRIORITY_STYLES[project.priority]}`}
          >
            {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={project.status}
            onChange={(e) => patch({ status: e.target.value as ProjectStatus })}
            className={`${badgeSelectCls} ${PROJECT_STATUS_STYLES[project.status]}`}
          >
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>

      {project.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
      )}

      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {progress.total === 0 ? 'No linked work yet' : `${progress.done}/${progress.total} done`}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-1.5" onClick={stop}>
          <AvatarInitial name={project.owner.full_name} />
          <select
            value={project.owner.id}
            onChange={(e) => patch({ ownerId: e.target.value })}
            className="min-w-0 max-w-[140px] cursor-pointer truncate rounded border border-transparent bg-transparent text-xs text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        {project.target_date && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {new Date(project.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </Link>
  )
}
