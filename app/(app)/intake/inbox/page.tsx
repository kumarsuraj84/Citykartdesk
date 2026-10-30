import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getInboxPage, getIntakeChannels } from '@/lib/queries/intake'
import { INBOX_PAGE_SIZE, cleanInboxSearch, parseInboxFolder, parseInboxSort, parseInboxStage } from '@/lib/intake/inbox-filters'
import { InboxWorkspace } from './InboxWorkspace'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

interface PageProps {
  searchParams: Promise<{ folder?: string; channel?: string; stage?: string; q?: string; sort?: string; page?: string }>
}

export default async function InboxPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!INTAKE_ROLES.includes(profile.role)) redirect('/home')

  // Tasks is Admin/Owner-only for now (see components/layout/Sidebar.tsx) —
  // INTAKE_ROLES includes plain agents/managers, but /tasks/[id] would
  // redirect them to /home, so ReviewClient (via InboxWorkspace) needs to
  // know not to link there.
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  const sp = await searchParams
  const folder = parseInboxFolder(sp.folder)
  const sort = parseInboxSort(sp.sort)
  const stage = parseInboxStage(sp.stage)
  const q = cleanInboxSearch(sp.q)
  const channel = sp.channel && /^[0-9a-f-]{36}$/i.test(sp.channel) ? sp.channel : null
  const pageNo = Math.max(1, Math.floor(Number(sp.page) || 1))

  // One page at a time, filtered, searched and sorted by the database (not the newest 2000 sorted in the browser), with the real folder and mailbox counts.
  const channels = await getIntakeChannels()
  const inbox = await getInboxPage({ page: pageNo, pageSize: INBOX_PAGE_SIZE, folder, channel, stage, q, sort, channelIds: channels.map((c) => c.id) })

  return (
    <InboxWorkspace
      inbox={inbox}
      channels={channels}
      query={{ folder, channel, stage, q, sort }}
      profileId={profile.id}
      isAdmin={isAdmin}
    />
  )
}
