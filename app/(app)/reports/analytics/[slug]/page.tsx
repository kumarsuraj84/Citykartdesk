import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { loadAgeBucketReport } from '@/lib/queries/report-analytics'
import { canUseReportAnalytics, parseStatuses, reportTitleForGroup } from '@/lib/reporting/analytics/catalog'
import { AgeSummaryView } from '@/components/reports/analytics/AgeSummaryView'
import { AnalyticsFilters } from '@/components/reports/analytics/AnalyticsFilters'
import { STATUS_LABELS } from '@/lib/constants/requests'

type SP = { group?: string; service?: string | string[]; range?: string; from?: string; to?: string; status?: string | string[] }

const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')

export default async function AnalyticsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SP>
}) {
  const { slug } = await params
  const sp = await searchParams

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const statuses = parseStatuses(sp.status)
  const res = await loadAgeBucketReport(profile, slug, { group: sp.group, services: sp.service === undefined ? [] : Array.isArray(sp.service) ? sp.service : [sp.service], preset: sp.range, from: sp.from, to: sp.to, statuses })

  const back = (
    <Link href="/reports/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Report Analytics
    </Link>
  )

  if ('error' in res) {
    return (
      <div className="space-y-3">
        {back}
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{res.error}</p>
        </div>
      </div>
    )
  }

  const { def, team, groups, services, selectedServiceIds, range, day, summary, ticketCount, truncated } = res
  const allServices = selectedServiceIds.length >= services.length
  const servicesText = allServices ? 'All services' : services.filter((s) => selectedServiceIds.includes(s.id)).map((s) => s.name).join(', ')
  const title = reportTitleForGroup(def, team.name)
  const fromStr = ymd(range.from)
  const toStr = ymd(range.to)

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{def.description}</p>
        </div>
      </div>

      <AnalyticsFilters
        key={`${team.id}|${selectedServiceIds.join('.')}|${range.preset}|${fromStr}|${toStr}|${statuses.join(',')}`}
        groups={groups}
        groupId={team.id}
        services={services}
        selectedServiceIds={selectedServiceIds}
        preset={range.preset}
        from={fromStr}
        to={toStr}
        statuses={statuses}
        resetHref={`/reports/analytics/${def.slug}?group=${encodeURIComponent(team.id)}`}
      />

      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{team.name}</span> · {servicesText} · created {range.label} · {statuses.map((s) => STATUS_LABELS[s]).join(', ')} ·{' '}
        <span className="font-semibold text-foreground">{ticketCount}</span> ticket{ticketCount === 1 ? '' : 's'}
        {truncated && <span className="ml-2 font-semibold text-destructive">(very large result — showing the first part only)</span>}
      </p>

      <p className="text-[11px] text-muted-foreground">
        The last two columns count tickets created and resolved {day.word === 'today' ? 'today' : `on ${day.label} (the end of the chosen dates)`}, whatever their status filter.
      </p>

      <AgeSummaryView
        summary={summary}
        dayWord={day.word}
        exportProps={{ slug: def.slug, group: team.id, services: selectedServiceIds, preset: range.preset, from: fromStr, to: toStr, statuses }}
      />
    </div>
  )
}
