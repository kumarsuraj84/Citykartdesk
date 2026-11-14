import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { ZohoNav } from './_components/ZohoNav'

/**
 * The Zoho Data tab. Everything under /zoho reads the ZOHO holding database and nothing else: no CK Desk ticket, store or person is
 * read here, and nothing is written anywhere. Open to administrators and managers only (the owner's decision).
 */
export default async function ZohoLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ZohoNav />
      {children}
    </div>
  )
}
