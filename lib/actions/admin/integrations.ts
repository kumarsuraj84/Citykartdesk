'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'

type ActionResult = { error?: string }

// Same bar as intake channel credentials (lib/actions/intake/channels.ts) —
// admin/platform_owner only, since this stores a real third-party API key.
function canManageIntegrations(role: string): boolean {
  return role === 'admin' || role === 'platform_owner'
}

async function requireIntegrationsAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canManageIntegrations(profile.role)) return { error: 'You do not have permission to manage integrations.' }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' }
  return { profile }
}

// Stores the DeskTime API key in Supabase Vault (never in plaintext anywhere).
// The service-role-only RPC writes the secret and sets
// organizations.desktime_credential_ref.
export async function saveDeskTimeApiKey(apiKey: string): Promise<ActionResult> {
  const guard = await requireIntegrationsAdmin()
  if (guard.error) return { error: guard.error }
  if (!apiKey.trim()) return { error: 'API key is required.' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('org_store_desktime_key', {
    p_org_id: guard.profile!.org_id!,
    p_secret: apiKey.trim(),
  })
  if (error) return { error: `Failed to store API key: ${error.message}` }

  revalidatePath('/admin/settings')
  return {}
}

// Clears the connection pointer. The vault secret itself is left in place
// (overwritten on next connect) — same posture as intake channel deletes.
export async function disconnectDeskTime(): Promise<ActionResult> {
  const guard = await requireIntegrationsAdmin()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({ desktime_credential_ref: null, desktime_connected_at: null })
    .eq('id', guard.profile!.org_id!)
  if (error) return { error: error.message }

  revalidatePath('/admin/settings')
  return {}
}
