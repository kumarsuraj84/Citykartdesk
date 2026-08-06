import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { SettingsClient } from './SettingsClient'

export default async function PlatformSettingsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')

  const supabase = await createClient()

  const [
    { data: autoCloseRow },
    { data: retentionPolicies },
  ] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'auto_close_days').single(),
    supabase.from('retention_policies').select('*').order('entity_type'),
  ])

  const autoCloseDays = parseInt(autoCloseRow?.value ?? '7', 10)

  const resendKey  = process.env.RESEND_API_KEY ?? null
  const keyMasked  = resendKey && resendKey.length >= 4 ? resendKey.slice(-4) : null

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Platform Settings"
        description="Manage global platform configuration, data retention policies, and integration status."
      />
      <SettingsClient
        autoCloseDays={autoCloseDays}
        retentionPolicies={retentionPolicies ?? []}
        integrationStatus={{
          resendKeySet:    resendKey != null,
          resendKeyMasked: keyMasked,
        }}
      />
    </div>
  )
}
