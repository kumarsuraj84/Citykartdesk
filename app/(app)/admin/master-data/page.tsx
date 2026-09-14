import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { MasterDataClient } from './MasterDataClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const metadata = { title: 'Master Data' }

export default async function MasterDataPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient() as unknown as AnyClient

  const { data: priorities } = await admin.from('request_priorities').select('*').order('display_order')

  return (
    <MasterDataClient
      requestPriorities={priorities ?? []}
    />
  )
}
