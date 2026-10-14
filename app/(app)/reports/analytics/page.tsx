import { redirect } from 'next/navigation'
import { ReportSearchList } from '@/components/reports/analytics/ReportSearchList'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { canUseReportAnalytics } from '@/lib/reporting/analytics/catalog'
import { FIXED_REPORTS, REPORTS_FOLDER, REPORTS_NAME } from '@/lib/reporting/analytics/fixed-reports'

// The predefined reports: kept in one folder, named exactly like the sheets of the Excel report they replace. Nothing is chosen on this page; a viewer only
// ever gets the tickets of the technician groups they may see (admins and owners see every group).
export default async function PredefinedReportsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold tracking-tight text-foreground">{REPORTS_NAME}</h1>
      <ReportSearchList folder={REPORTS_FOLDER} reports={FIXED_REPORTS.map((d) => ({ slug: d.slug, title: d.title }))} />
    </div>
  )
}
