'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

type ChannelType = 'email' | 'portal' | 'whatsapp' | 'teams' | 'slack' | 'api'

// intake.manage_channels ≈ admin. Enforced here (app layer) AND in RLS (defence
// in depth — the RLS write policies require role admin/platform_owner).
function canManageChannels(role: string): boolean {
  return role === 'admin' || role === 'platform_owner'
}

// Append-only audit, written via service-role (authenticated INSERT is denied by
// the RESTRICTIVE policy on intake_audit_log — mirrors request_activity).
async function logIntakeAudit(entry: {
  orgId: string
  actorId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata?: Record<string, unknown>
}) {
  const admin = createAdminClient() as unknown as AnyClient
  await admin.from('intake_audit_log').insert({
    org_id:      entry.orgId,
    actor_id:    entry.actorId,
    entity_type: entry.entityType,
    entity_id:   entry.entityId,
    action:      entry.action,
    metadata:    entry.metadata ?? {},
  })
}

export async function createChannel(input: {
  name: string
  type: ChannelType
  provider?: string | null
  // config can carry sync_from_date (ISO date string) to limit initial ingestion
  // and classification scope. Older emails will not be pulled or classified.
  config?: Record<string, unknown>
  default_team_id?: string | null
}): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const name = input.name.trim()
  if (!name) return { error: 'Channel name is required.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { data, error } = await supabase
    .from('intake_channels')
    .insert({
      org_id:          profile.org_id,
      name,
      type:            input.type,
      provider:        input.provider ?? null,
      config:          input.config ?? {},
      default_team_id: input.default_team_id ?? null,
      status:          'paused',  // new channels start paused until creds are connected (Phase B)
      created_by:      profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: data.id, action: 'channel_created',
    metadata: { name, type: input.type },
  })

  revalidatePath('/intake/channels')
  return { id: data.id }
}

export async function updateChannel(
  id: string,
  data: {
    name?: string
    provider?: string | null
    // Partial config update — merged with existing values on the client before calling here.
    config?: Record<string, unknown>
    default_team_id?: string | null
  }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const patch: Record<string, unknown> = {}
  if (data.name !== undefined) patch.name = data.name.trim()
  if (data.provider !== undefined) patch.provider = data.provider
  if (data.config !== undefined) patch.config = data.config
  if (data.default_team_id !== undefined) patch.default_team_id = data.default_team_id

  const { error } = await supabase
    .from('intake_channels')
    .update(patch)
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: id, action: 'channel_updated', metadata: patch,
  })

  revalidatePath('/intake/channels')
  return {}
}

export async function setChannelStatus(
  id: string,
  status: 'active' | 'paused'
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_channels')
    .update({ status })
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: id,
    action: status === 'active' ? 'channel_activated' : 'channel_paused',
  })

  revalidatePath('/intake/channels')
  return {}
}

export async function deleteChannel(id: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_channels')
    .delete()
    .eq('id', id)
    .eq('org_id', profile.org_id)

  if (error) return { error: error.message }

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: id, action: 'channel_deleted',
  })

  revalidatePath('/intake/channels')
  return {}
}

// ── Credentials (Supabase Vault) ─────────────────────────────────────────────

export type ImapCredentialInput = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  folder?: string
}

// Stores IMAP credentials in Supabase Vault (never in plaintext anywhere). The
// service-role-only RPC writes the secret and sets intake_channels.credentials_ref.
export async function connectChannel(
  channelId: string,
  creds: ImapCredentialInput
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  if (!creds.host?.trim() || !creds.user?.trim() || !creds.port) {
    return { error: 'Host, port and username are required.' }
  }

  // Verify the channel belongs to the caller's org (RLS-scoped read).
  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, org_id, config, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  const admin = createAdminClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error: { message: string } | null }>
  }

  // Editing an already-connected channel: a blank password means "keep the
  // existing one" so the operator only re-enters what changed. Re-read the
  // current secret and reuse its password.
  let password = creds.password
  if (!password) {
    if (!channel.credentials_ref) {
      return { error: 'Password is required when connecting a channel for the first time.' }
    }
    const { data: existing } = await admin.rpc('intake_read_credential', { p_ref: channel.credentials_ref })
    try {
      const prev = JSON.parse((existing as string) ?? '{}') as { password?: string; type?: string }
      if (prev.type === 'oauth') return { error: 'This channel uses OAuth — reconnect with the provider button instead.' }
      if (!prev.password) return { error: 'No stored password to keep — please enter the password.' }
      password = prev.password
    } catch {
      return { error: 'Could not read existing credentials — please enter the password.' }
    }
  }

  const secret = JSON.stringify({
    type: 'basic',
    host: creds.host.trim(),
    port: Number(creds.port),
    secure: creds.secure,
    user: creds.user.trim(),
    password,
  })

  // Vault write via service-role RPC (authenticated cannot execute it).
  const { error: vaultErr } = await admin.rpc('intake_store_credential', {
    p_channel_id: channelId,
    p_secret: secret,
  })
  if (vaultErr) return { error: `Failed to store credentials: ${vaultErr.message}` }

  // Persist non-secret fields in config so the edit form pre-fills next time.
  await rls
    .from('intake_channels')
    .update({
      config: {
        ...(channel.config ?? {}),
        host: creds.host.trim(),
        port: Number(creds.port),
        secure: creds.secure,
        user: creds.user.trim(),
        folder: creds.folder?.trim() || 'INBOX',
      },
    })
    .eq('id', channelId)
    .eq('org_id', profile.org_id)

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: channelId, action: 'channel_credentials_set',
    metadata: { host: creds.host.trim(), user: creds.user.trim() },
  })

  revalidatePath('/intake/channels')
  return {}
}

// Returns a channel's stored connection settings WITHOUT the password, so the
// edit form can pre-fill even for channels connected before non-secret fields
// were mirrored into config. Reads config first, falls back to the Vault secret.
export async function getChannelConnectionInfo(channelId: string): Promise<{
  error?: string
  connected?: boolean
  isOAuth?: boolean
  host?: string
  port?: number
  secure?: boolean
  user?: string
  folder?: string
}> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, config, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  const config = (channel.config ?? {}) as Record<string, unknown>
  const folder = (config.folder as string) ?? 'INBOX'

  // No stored secret yet — return whatever config has (likely just folder).
  if (!channel.credentials_ref) {
    return { connected: false, folder }
  }

  // Read the non-secret fields from the Vault secret via service-role RPC.
  const admin = createAdminClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error: { message: string } | null }>
  }
  const { data } = await admin.rpc('intake_read_credential', { p_ref: channel.credentials_ref })
  try {
    const secret = JSON.parse((data as string) ?? '{}') as {
      type?: string; host?: string; port?: number; secure?: boolean; user?: string
    }
    if (secret.type === 'oauth') {
      return { connected: true, isOAuth: true, user: secret.user, folder }
    }
    return {
      connected: true,
      isOAuth: false,
      host: secret.host ?? (config.host as string),
      port: secret.port ?? (config.port as number) ?? 993,
      secure: secret.secure ?? (config.secure as boolean) ?? true,
      user: secret.user ?? (config.user as string),
      folder,
    }
  } catch {
    // Secret unreadable — fall back to config so the form still pre-fills.
    return {
      connected: true,
      host: config.host as string,
      port: (config.port as number) ?? 993,
      secure: (config.secure as boolean) ?? true,
      user: config.user as string,
      folder,
    }
  }
}

// Resets a channel's incremental cursor so the next poll re-pulls the entire
// mailbox from UID 1 (not just newly-arrived mail). Storage is idempotent via
// dedup_hash, so re-pulling can't create duplicates — it only backfills history.
export async function resyncChannel(channelId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { data: channel } = await supabase
    .from('intake_channels')
    .select('id, config')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  const nextConfig = { ...(channel.config ?? {}), last_uid: 0 }
  const { error } = await supabase
    .from('intake_channels')
    .update({ config: nextConfig })
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
  if (error) return { error: error.message }

  await logIntakeAudit({
    orgId: profile.org_id!, actorId: profile.id,
    entityType: 'channel', entityId: channelId, action: 'channel_resync',
  })

  revalidatePath('/intake/channels')
  return {}
}

// Triggers an immediate poll of all active channels on the worker and returns
// the per-channel result so the operator can see exactly what each mailbox did
// (fetched / stored / error) — the manual counterpart to the scheduler tick.
export async function pollNow(): Promise<{
  ok: boolean
  error?: string
  channels?: number
  stored?: number
  details?: { id: string; fetched: number; stored: number; duplicates: number; error: string | null }[]
}> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }
  if (!canManageChannels(profile.role)) return { ok: false, error: 'You do not have permission to manage channels.' }

  const rawUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!rawUrl || !workerSecret) {
    return { ok: false, error: 'Worker is not configured (INTAKE_WORKER_URL / INTAKE_WORKER_SECRET).' }
  }
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  try {
    const res = await fetch(`${workerUrl}/intake/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-worker-secret': workerSecret },
    })
    const data = (await res.json()) as {
      ok: boolean; error?: string; channels?: number; stored?: number
      details?: { id: string; fetched: number; stored: number; duplicates: number; error: string | null }[]
    }
    revalidatePath('/intake/channels')
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach worker.' }
  }
}

// Asks the worker to validate a channel's stored credentials over IMAP.
export async function testChannel(channelId: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }
  if (!canManageChannels(profile.role)) return { ok: false, error: 'You do not have permission to manage channels.' }

  const rawUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!rawUrl || !workerSecret) {
    return { ok: false, error: 'Worker is not configured (INTAKE_WORKER_URL / INTAKE_WORKER_SECRET).' }
  }
  // Be forgiving: prepend https:// if the env var omitted the protocol, and
  // strip any trailing slash.
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  try {
    const res = await fetch(`${workerUrl}/intake/test-channel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-worker-secret': workerSecret },
      body: JSON.stringify({ channelId }),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach worker.' }
  }
}
