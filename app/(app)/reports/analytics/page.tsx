import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileBarChart, ChevronRight, Folder } from 'lucide-react'
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
      <details open className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 bg-muted/40 px-4 py-2.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{REPORTS_FOLDER}</span>
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{FIXED_REPORTS.length}</span>
        </summary>
        <ul className="divide-y divide-border border-t border-border">
          {FIXED_REPORTS.map((def) => (
            <li key={def.slug}>
              <Link href={`/reports/analytics/${def.slug}`} className="flex items-center gap-3 py-2.5 pl-12 pr-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50">
                <FileBarChart className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{def.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
