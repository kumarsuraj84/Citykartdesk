import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { listPrograms } from '@/lib/programs/admin-data'
import { ProgramsClient } from './ProgramsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendor Programs' }

export default async function VendorProgramsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')
  const programs = await listPrograms(profile.org_id)
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Vendor Programs"
        description="One program for each service line where a vendor or OEM looks after the tickets (for example RO water purifier). Choose its categories, point it at its Google Sheet, write the mail, and switch it on. AC and Genset keep working as they do today."
      />
      <ProgramsClient programs={programs} />
    </div>
  )
}
