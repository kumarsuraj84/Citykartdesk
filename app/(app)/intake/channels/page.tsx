import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getIntakeChannels } from '@/lib/queries/intake'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { ChannelsClient } from './ChannelsClient'

const ADMIN_ROLES = ['admin', 'platform_owner']

export default async function IntakeChannelsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!ADMIN_ROLES.includes(profile.role)) redirect('/intake')

  const supabase = await createClient()
  const [channels, { data: teams }] = await Promise.all([
    getIntakeChannels(),
    supabase.from('teams').select('id, name').order('name'),
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Channels"
        description="Connect and manage inbound sources. New channels start paused until credentials are connected."
        breadcrumbs={[{ label: 'Intake', href: '/intake' }, { label: 'Channels' }]}
      />
      <ChannelsClient
        initialChannels={channels}
        teams={(teams ?? []) as { id: string; name: string }[]}
      />
    </div>
  )
}
