'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowUpDown, Search } from 'lucide-react'
import { updateProject } from '@/lib/actions/projects'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from './ProjectStatusBadge'
import { PROJECT_PRIORITY_STYLES, PROJECT_PRIORITY_ORDER as PRIORITY_ORDER } from './ProjectPriorityBadge'
import type { ProjectWithDetails, ProjectProgress, ProjectStatus, ProjectPriority } from '@/types'

type SortKey = 'name' | 'owner' | 'status' | 'progress' | 'target_date' | 'days_since_update'

interface LatestUpdate {
  updateDate: string
  updateText: string
}

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const d = Math.floor((Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86_400_000)
  return d < 0 ? 0 : d
}

const TD = 'border-r border-border/60 last:border-r-0'
const STATUS_ORDER: ProjectStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled']
const selectCls = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer truncate'
const dateCls = 'w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs text-muted-foreground hover:border-border focus:border-border focus:outline-none focus:ring-1 focus:ring-ring'

function Th({ label, sortBy, className, onSort }: {
  label: string; sortBy?: SortKey; className?: string; onSort?: (key: SortKey) => void
}) {
  return (
    <th
      className={`px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/85 border-r border-white/15 last:border-r-0 ${sortBy ? 'cursor-pointer select-none hover:text-primary-foreground' : ''} ${className ?? ''}`}
      onClick={sortBy && onSort ? () => onSort(sortBy) : undefined}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy && <ArrowUpDown className="h-3 w-3 opacity-50" />}
      </span>
    </th>
  )
}

// Search/status/priority/owner filter the FULL project list server-side (see
// getProjects() in lib/queries/projects.ts) — this component only sorts the
// current page's rows, which is safe since sorting never hides data.
export function ProjectsTable({
  projects,
  progressByProject,
  latestUpdateByProject,
  profiles,
}: {
  projects: ProjectWithDetails[]
  progressByProject: Record<string, ProjectProgress>
  latestUpdateByProject: Record<string, LatestUpdate>
  profiles: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [savingId, setSavingId] = useState<string | null>(null)

  const urlSearch = searchParams.get('search') ?? ''
  const statusFilter = (searchParams.get('status') as ProjectStatus | null) ?? null
  const priorityFilter = (searchParams.get('priority') as ProjectPriority | null) ?? null
  const ownerFilter = searchParams.get('owner') ?? ''

  const [searchInput, setSearchInput] = useState(urlSearch)
  const [syncedUrlSearch, setSyncedUrlSearch] = useState(urlSearch)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the input in sync if the URL changes from elsewhere (e.g. Clear button,
  // back/forward) — adjusted during render rather than in an effect.
  if (urlSearch !== syncedUrlSearch) {
    setSyncedUrlSearch(urlSearch)
    setSearchInput(urlSearch)
  }

  const [sortKey, setSortKey] = useState<SortKey>('days_since_update')
  const [sortAsc, setSortAsc] = useState(false)

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    params.delete('page') // any filter change resets to page 1
    startTransition(() => { router.replace(`/projects?${params.toString()}`) })
  }

  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => updateParams({ search: value || null }), 350)
  }

  function patch(id: string, data: Parameters<typeof updateProject>[1]) {
    setSavingId(id)
    startTransition(async () => {
      const r = await updateProject(id, data)
      if (r.error) { toast.error(r.error); setSavingId((cur) => (cur === id ? null : cur)); return }
      router.refresh()
      setSavingId((cur) => (cur === id ? null : cur))
    })
  }

  const rows = useMemo(() => {
    const dir = sortAsc ? 1 : -1
    return [...projects].sort((a, b) => {
      if (sortKey === 'progress') {
        const pa = progressByProject[a.id]
        const pb = progressByProject[b.id]
        const va = pa && pa.total > 0 ? pa.done / pa.total : -1
        const vb = pb && pb.total > 0 ? pb.done / pb.total : -1
        return (va - vb) * dir
      }
      if (sortKey === 'days_since_update') {
        const da = daysSince(latestUpdateByProject[a.id]?.updateDate) ?? 9999
        const db = daysSince(latestUpdateByProject[b.id]?.updateDate) ?? 9999
        return (da - db) * dir
      }
      if (sortKey === 'target_date') {
        return (String(a.target_date ?? '').localeCompare(String(b.target_date ?? ''))) * dir
      }
      if (sortKey === 'owner') {
        return a.owner.full_name.localeCompare(b.owner.full_name) * dir
      }
      return String(a[sortKey as 'name' | 'status'] ?? '').localeCompare(String(b[sortKey as 'name' | 'status'] ?? '')) * dir
    })
  }, [projects, sortKey, sortAsc, progressByProject, latestUpdateByProject])

  // Same raised glossy pill as the Export/Upload buttons — the bg-* half of `styles`
  // is invisible under the chip's own gradient background, only its text-* colors the
  // label and dot; "active" adds a colored ring instead of swapping fills.
  const chipCls = (active: boolean, styles: string) =>
    `chip-3d ${styles} ${active ? 'ring-2 ring-offset-1 ring-current' : ''}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search all projects, owners…"
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-[12px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={ownerFilter}
          onChange={(e) => updateParams({ owner: e.target.value || null })}
          className="rounded-lg border border-border bg-card py-1.5 pl-2.5 pr-3 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All owners</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={chipCls(statusFilter === s, PROJECT_STATUS_STYLES[s])}
              onClick={() => updateParams({ status: statusFilter === s ? null : s })}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {PROJECT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_ORDER.map((p) => (
            <button
              key={p}
              className={chipCls(priorityFilter === p, PROJECT_PRIORITY_STYLES[p])}
              onClick={() => updateParams({ priority: priorityFilter === p ? null : p })}
            >
              {p}
            </button>
          ))}
        </div>
        {(statusFilter || priorityFilter || urlSearch || ownerFilter) && (
          <button
            onClick={() => { setSearchInput(''); updateParams({ status: null, priority: null, search: null, owner: null }) }}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{rows.length} on this page</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[940px] border-collapse text-sm table-fixed">
          <thead className="bg-primary">
            <tr>
              <Th label="#" className="w-8" />
              <Th label="Name" sortBy="name" onSort={toggleSort} className="w-[220px]" />
              <Th label="Tech Owner" sortBy="owner" className="w-28" onSort={toggleSort} />
              <Th label="Functional" className="w-28" />
              <Th label="Priority" className="w-20" />
              <Th label="Status" sortBy="status" className="w-28" onSort={toggleSort} />
              <Th label="Progress" sortBy="progress" className="w-32" onSort={toggleSort} />
              <Th label="Start" className="w-24" />
              <Th label="Target" sortBy="target_date" className="w-24" onSort={toggleSort} />
              <Th label="Last update" className="w-40" />
              <Th label="Days" sortBy="days_since_update" className="w-12" onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No projects match your filters.
                </td>
              </tr>
            ) : (
              rows.map((p, i) => {
                const progress = progressByProject[p.id]
                const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
                const latest = latestUpdateByProject[p.id]
                const d = daysSince(latest?.updateDate)
                const isSaving = savingId === p.id
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-border transition-colors hover:bg-primary/10 ${i % 2 === 1 ? 'bg-slate-100 dark:bg-white/5' : 'bg-card'} ${isSaving ? 'opacity-60' : ''}`}
                  >
                    <td className={`${TD} px-2 py-2 align-top text-xs text-muted-foreground/60`}>{i + 1}</td>
                    <td className={`${TD} px-2 py-2 align-top`}>
                      <Link href={`/projects/${p.id}`} className="line-clamp-2 font-medium text-foreground hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <select
                        value={p.owner.id}
                        onChange={(e) => patch(p.id, { ownerId: e.target.value })}
                        className={selectCls}
                      >
                        {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.full_name}</option>)}
                      </select>
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <select
                        value={p.functional_owner?.id ?? ''}
                        onChange={(e) => patch(p.id, { functionalOwnerId: e.target.value || null })}
                        className={selectCls}
                      >
                        <option value="">—</option>
                        {profiles.map((pr) => <option key={pr.id} value={pr.id}>{pr.full_name}</option>)}
                      </select>
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <select
                        value={p.priority}
                        onChange={(e) => patch(p.id, { priority: e.target.value as ProjectPriority })}
                        className={`chip-3d w-full appearance-none text-xs focus:outline-none focus:ring-1 focus:ring-ring ${PROJECT_PRIORITY_STYLES[p.priority]}`}
                      >
                        {PRIORITY_ORDER.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                      </select>
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <select
                        value={p.status}
                        onChange={(e) => patch(p.id, { status: e.target.value as ProjectStatus })}
                        className={`${selectCls} ${PROJECT_STATUS_STYLES[p.status]}`}
                      >
                        {STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td className={`${TD} px-2 py-2 align-top`}>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <input
                        type="date"
                        value={p.start_date ?? ''}
                        onChange={(e) => patch(p.id, { startDate: e.target.value || null })}
                        className={dateCls}
                      />
                    </td>
                    <td className={`${TD} py-1 align-top`}>
                      <input
                        type="date"
                        value={p.target_date ?? ''}
                        onChange={(e) => patch(p.id, { targetDate: e.target.value || null })}
                        className={dateCls}
                      />
                    </td>
                    <td className={`${TD} px-2 py-2 align-top`}>
                      {latest ? (
                        <p className="truncate text-xs text-muted-foreground" title={latest.updateText}>{latest.updateText}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">No updates</span>
                      )}
                    </td>
                    <td className={`${TD} px-2 py-2 align-top`}>
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                          d === null || d > 5 ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400'
                          : d > 2 ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'text-muted-foreground'
                        }`}
                      >
                        {d === null ? '—' : d}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
