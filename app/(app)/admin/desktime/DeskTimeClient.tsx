'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { triggerDeskTimeSync } from '@/lib/actions/admin/desktime'
import type { AiApplication, DeskTimeAppLogRow, DeskTimeMemberProjectLog, DeskTimeProjectMapRow, DeskTimeSyncRun } from '@/lib/queries/desktime'
import { ApplicationHoursTab } from './ApplicationHoursTab'
import { ProjectHoursTab } from './ProjectHoursTab'
import { AiApplicationsTab } from './AiApplicationsTab'
import { ProjectMappingTab } from './ProjectMappingTab'
import { lastDaysRange, type DateRange } from './DateRangeControl'

type Tab = 'hours' | 'person' | 'ai' | 'map'

const TABS_LIST: Tab[] = ['hours', 'person', 'ai', 'map']

function isValidISODate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime())
}

interface DeskTimeClientProps {
  appLogs: DeskTimeAppLogRow[]
  memberProjectLogs: DeskTimeMemberProjectLog[]
  aiApplications: AiApplication[]
  projectMap: DeskTimeProjectMapRow[]
  allProjects: { id: string; name: string }[]
  lastSync: DeskTimeSyncRun | null
  isAdmin: boolean
}

function SyncPanel({ lastSync, isAdmin }: { lastSync: DeskTimeSyncRun | null; isAdmin: boolean }) {
  const [days, setDays] = useState(3)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleSync() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await triggerDeskTimeSync(days)
      if (result.error) { setError(result.error); return }
      if (result.data) {
        setMessage(`Synced ${result.data.days} day(s): ${result.data.rows} entries, ${result.data.matched} matched to projects.`)
      }
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">DeskTime sync</p>
          <p className="text-xs text-muted-foreground">Working hours are pulled from DeskTime and matched to projects by name.</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Days
              <input
                type="number"
                min={1}
                max={31}
                value={days}
                onChange={(e) => setDays(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <button onClick={handleSync} disabled={isPending} className="btn-gradient disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
              {isPending ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {lastSync
          ? `Last sync ${new Date(lastSync.ran_at).toLocaleString('en-US', { hour12: false })} · ${lastSync.status}${
              lastSync.status === 'success' ? ` · ${lastSync.rows_upserted} rows, ${lastSync.matched_projects} matched` : ''
            }${lastSync.message ? ` · ${lastSync.message}` : ''}`
          : 'No sync has run yet.'}
      </p>
      {message && <p className="text-xs text-emerald-600">{message}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function DeskTimeClient({ appLogs, memberProjectLogs, aiApplications, projectMap, allProjects, lastSync, isAdmin }: DeskTimeClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const rawTab = searchParams.get('tab')
  const tab: Tab = rawTab && TABS_LIST.includes(rawTab as Tab) ? (rawTab as Tab) : 'hours'

  const defaultRange = useMemo(() => lastDaysRange(7), [])
  const hasCustomRange = isValidISODate(searchParams.get('from')) && isValidISODate(searchParams.get('to'))
  const range: DateRange = hasCustomRange
    ? { from: searchParams.get('from')!, to: searchParams.get('to')! }
    : defaultRange

  function updateParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) params.set(k, v)
    startTransition(() => { router.replace(`/admin/desktime?${params.toString()}`) })
  }

  function setTab(t: Tab) {
    updateParams({ tab: t })
  }

  function setRange(r: DateRange) {
    updateParams({ from: r.from, to: r.to })
  }

  const aiPatterns = useMemo(
    () => aiApplications.filter((a) => a.is_active).map((a) => a.name.toLowerCase()),
    [aiApplications]
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'hours',  label: 'Application hours' },
    { key: 'person', label: 'Project hours by person' },
    { key: 'ai',     label: 'AI applications' },
    { key: 'map',    label: 'Project mapping' },
  ]

  return (
    <div className="space-y-4">
      <SyncPanel lastSync={lastSync} isAdmin={isAdmin} />

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'hours'  && <ApplicationHoursTab appLogs={appLogs} aiPatterns={aiPatterns} range={range} onRangeChange={setRange} />}
      {tab === 'person' && <ProjectHoursTab memberProjectLogs={memberProjectLogs} appLogs={appLogs} aiPatterns={aiPatterns} range={range} onRangeChange={setRange} />}
      {tab === 'ai'     && <AiApplicationsTab apps={aiApplications} isAdmin={isAdmin} />}
      {tab === 'map'    && <ProjectMappingTab mapRows={projectMap} allProjects={allProjects} isAdmin={isAdmin} />}
    </div>
  )
}
