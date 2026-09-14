import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { getWhatsAppChannelReadiness } from '@/lib/actions/intake/whatsapp-channel'
import { SettingsClient } from './SettingsClient'

export default async function PlatformSettingsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')

  const supabase = await createClient()

  const [
    { data: retentionPolicies },
    { data: emailFromRows },
    { data: whatsappChannelRows },
  ] = await Promise.all([
    supabase.from('retention_policies').select('*').order('entity_type'),
    supabase.from('app_settings').select('key, value').in('key', ['email_from_name', 'email_from_address']),
    supabase.from('intake_channels').select('id, name, status').eq('type', 'whatsapp').order('created_at'),
  ])

  // Surfaced here (not gated by the Intake module toggle, unlike Admin >
  // Intake > Channels) so an admin always has one stable place to see
  // WhatsApp's CONFIGURED-vs-VERIFIED status, even while Intake itself is
  // disabled. Reuses Stage 6's own readiness diagnostic rather than
  // re-deriving it.
  const whatsappChannels = await Promise.all(
    (whatsappChannelRows ?? []).map(async (row) => {
      const { readiness } = await getWhatsAppChannelReadiness(row.id)
      return { id: row.id, name: row.name, status: row.status as string, readiness: readiness ?? null }
    })
  )

  const resendKey  = process.env.RESEND_API_KEY ?? null
  const keyMasked  = resendKey && resendKey.length >= 4 ? resendKey.slice(-4) : null

  const emailFromMap = new Map((emailFromRows ?? []).map((r) => [r.key, r.value]))

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Platform Settings"
        description="Manage global platform configuration, data retention policies, and integration status."
      />
      <SettingsClient
        retentionPolicies={retentionPolicies ?? []}
        integrationStatus={{
          resendKeySet:    resendKey != null,
          resendKeyMasked: keyMasked,
        }}
        emailFrom={{
          name:    emailFromMap.get('email_from_name') ?? '',
          address: emailFromMap.get('email_from_address') ?? '',
        }}
        whatsappChannels={whatsappChannels}
      />
    </div>
  )
}
