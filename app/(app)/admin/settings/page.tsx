import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { getEmailSetup, RESEND_API_KEY, resolveSenderAddress } from '@/lib/email/config'
import { readMailboxForAdmin } from '@/lib/email/mailbox'
import { getWhatsAppChannelReadiness } from '@/lib/actions/intake/whatsapp-channel'
import { SettingsClient } from './SettingsClient'
import { PolicySwitchesCard } from '@/components/admin/PolicySwitchesCard'
import { loadPolicies } from '@/lib/permissions/policies'
import { LOG_RETENTION, LOG_RETENTION_KEYS, logRetentionDays } from '@/lib/syslog/retention'

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
    supabase.from('app_settings').select('key, value').in('key', ['email_from_name', 'email_from_address', ...LOG_RETENTION_KEYS]),
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

  const setup = await getEmailSetup()
  const canEditMailbox = profile.role === 'admin' || profile.role === 'platform_owner'
  const mailbox = canEditMailbox ? await readMailboxForAdmin() : null
  const resendKey = RESEND_API_KEY || null
  let deliveryDetail: string | null = null
  if (setup.provider === 'smtp' && setup.smtp) {
    deliveryDetail = `${setup.smtp.host}:${setup.smtp.port} — ${setup.smtp.user ? `signed in as ${setup.smtp.user}` : 'no login (server trusts this machine)'}`
  } else if (setup.provider === 'resend' && resendKey) {
    deliveryDetail = `API key ••••${resendKey.slice(-4)}`
  }

  const policies = profile.role === 'platform_owner' ? await loadPolicies() : null

  const emailFromMap = new Map((emailFromRows ?? []).map((r) => [r.key, r.value]))
  const logRetention = {
    system_log: logRetentionDays('system_log', emailFromMap.get(LOG_RETENTION.system_log.key)),
    event_log: logRetentionDays('event_log', emailFromMap.get(LOG_RETENTION.event_log.key)),
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Platform Settings"
        description="Manage global platform configuration, data retention policies, and integration status."
      />
      <SettingsClient
        retentionPolicies={retentionPolicies ?? []}
        logRetention={logRetention}
        integrationStatus={{
          provider:  setup.provider,
          detail:    deliveryDetail,
          sendingAs: setup.provider === 'smtp' ? resolveSenderAddress('smtp', setup.smtp, null) : null,
          source:    setup.source,
        }}
        mailbox={mailbox}
        canEditMailbox={canEditMailbox}
        emailFrom={{
          name:    emailFromMap.get('email_from_name') ?? '',
          address: emailFromMap.get('email_from_address') ?? '',
        }}
        whatsappChannels={whatsappChannels}
      />
      {policies && <PolicySwitchesCard values={policies} />}
    </div>
  )
}
