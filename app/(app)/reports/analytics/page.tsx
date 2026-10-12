import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileBarChart, ChevronRight } from 'lucide-react'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import { canUseReportAnalytics } from '@/lib/reporting/analytics/catalog'
import { FIXED_REPORTS, REPORTS_NAME } from '@/lib/reporting/analytics/fixed-reports'

// The fixed predefined reports: a plain list, named exactly like the sheets of the Excel report they replace. Nothing is chosen on this page or inside a
// report; a viewer only ever gets the tickets of the technician groups they may see (admins and owners see every group).
export default async function FixedReportsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold tracking-tight text-foreground">{REPORTS_NAME}</h1>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {FIXED_REPORTS.map((def) => (
          <li key={def.slug}>
            <Link href={`/reports/analytics/${def.slug}`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50">
              <FileBarChart className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{def.title}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
