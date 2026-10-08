import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileBarChart, ArrowRight, Lock } from 'lucide-react'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { listReportsForViewer } from '@/lib/queries/report-analytics'
import { canUseReportAnalytics } from '@/lib/reporting/analytics/catalog'

// Report Analytics — ready-made reports that stay current with the data in Citykart Desk. Unlike
// Report Builder, nobody can redesign these; inside a report the viewer picks the technician group,
// the dates and the statuses (a technician or manager only gets their own groups; admins and owners
// get every group).
export default async function ReportAnalyticsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const reports = await listReportsForViewer(profile)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Report Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Ready-made reports, always up to date. Open a report, then choose the technician group, dates and statuses; the reports themselves are fixed.
          To build your own, use Report Builder.
        </p>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No reports available for you yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Reports are shown for the technician groups you belong to. Ask your administrator to add you to a group.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {reports.map((def) => (
            <Link
              key={def.slug}
              href={`/reports/analytics/${def.slug}`}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileBarChart className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-foreground">{def.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{def.description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Fixed report</span>
                <span className="inline-flex items-center gap-1 font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">Open <ArrowRight className="h-3 w-3" /></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
