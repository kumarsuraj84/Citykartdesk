import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { MasterDataClient } from './MasterDataClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export const metadata = { title: 'Master Data — CognixDesk Admin' }

export default async function MasterDataPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient() as unknown as AnyClient
  const orgId = profile.org_id ?? ''

  const [tagsRes, prioritiesRes] = await Promise.all([
    // tags are org-scoped; request_priorities are global reference data
    admin.from('tags').select('*').eq('org_id', orgId).order('name'),
    admin.from('request_priorities').select('*').order('display_order'),
  ])

  return (
    <MasterDataClient
      tags={tagsRes.data ?? []}
      requestPriorities={prioritiesRes.data ?? []}
    />
  )
}
