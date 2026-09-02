import { redirect } from 'next/navigation'
import { PivotBuilder } from '@/components/reports/PivotBuilder'
import { getCurrentProfile } from '@/lib/queries/profiles'

export default async function ReportBuilderPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')

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
