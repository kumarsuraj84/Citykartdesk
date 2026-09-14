import { redirect } from 'next/navigation'
import { PivotBuilder } from '@/components/reports/PivotBuilder'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'

// DESK-QA-001 fix (Product Decision A): Report Builder was previously nested
// under app/(app)/admin/reports/pivot, so app/(app)/admin/layout.tsx's
// blanket admin/manager/platform_owner gate blocked every other role from
// ever reaching this page — even though the data layer underneath it
// (lib/reporting/access.ts's resolveReportAccess/authorizeReportAccess, used
// by every server action this page's PivotBuilder calls) has always scoped
// the `requests` entity per-role (own/agent/team/all) and already intended
// every role with the Requests module enabled to use it (see the comment on
// the sidebar's "Report Builder" entry). Moving the route out from under
// /admin lets it apply its own, narrower gate — authenticated + org-scoped +
// Requests module enabled — without weakening the rest of the admin-only
// route tree (Dashboards/DeskTime/Audit Logs stay under app/(app)/admin/reports
// et al., manager/admin/platform_owner-only, unchanged).
export default async function ReportBuilderPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')

  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes('requests')) redirect('/home')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">Report Builder</h1>
        <p className="text-sm text-muted-foreground">
          Excel-style pivot tables and dynamic column reports across Requests, Tasks, Projects, Milestones and Approvals.
        </p>
      </div>

      <PivotBuilder />
    </div>
  )
}
