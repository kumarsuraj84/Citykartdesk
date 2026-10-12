import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { loadFixedReport } from '@/lib/queries/fixed-reports'
import { canUseReportAnalytics } from '@/lib/reporting/analytics/catalog'
import { REPORTS_NAME } from '@/lib/reporting/analytics/fixed-reports'
import { parseReportFilter } from '@/lib/reporting/analytics/report-filter'
import { ReportTableView } from '@/components/reports/analytics/ReportTableView'
import { ReportFilters } from '@/components/reports/analytics/ReportFilters'

// One fixed report, drawn like its Excel sheet. Only the ticket status and the technician can be chosen (for now); every value opens the tickets behind it.
export default async function FixedReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params
  const sp = await searchParams
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const back = (
    <Link href="/reports/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> {REPORTS_NAME}
    </Link>
  )
  const filter = parseReportFilter(sp)
  const res = await loadFixedReport(profile, slug, filter)
  if ('error' in res) {
    return (
      <div className="space-y-3">
        {back}
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center"><p className="text-sm font-medium text-foreground">{res.error}</p></div>
      </div>
    )
  }
  const choice = { status: typeof sp.status === 'string' ? sp.status : undefined, tech: typeof sp.tech === 'string' ? sp.tech : undefined }

  return (
    <div className="space-y-3">
      {back}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{res.def.title}</h1>
        <p className="text-xs text-muted-foreground">{res.def.about} {res.table.scopeText}</p>
      </div>
      <ReportFilters
        key={`${res.filters.selected.statuses.join(',')}|${res.filters.selected.techs.join('|')}`}
        combos={res.filters.combos} defaultStatuses={res.filters.defaultStatuses} selected={res.filters.selected}
      />
      <ReportTableView table={res.table} choice={choice} />
    </div>
  )
}
