import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getInboxMessages, getIntakeChannels } from '@/lib/queries/intake'
import { InboxWorkspace } from './InboxWorkspace'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

interface PageProps {
  searchParams: Promise<{ folder?: string; channel?: string }>
}

export default async function InboxPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!INTAKE_ROLES.includes(profile.role)) redirect('/home')

  const sp = await searchParams

  // Fetch the full set (archived included) so the folder rail + search/sort run
  // instantly client-side. Folders reslice this one dataset.
  const [{ data }, channels] = await Promise.all([
    getInboxMessages({ page: 1, pageSize: 2000 }),
    getIntakeChannels(),
  ])

  return (
    <InboxWorkspace messages={data} channels={channels} initialFolder={sp.folder} initialChannel={sp.channel} profileId={profile.id} />
  )
}
