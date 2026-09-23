'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { requireModuleEnabled } from '@/lib/actions/moduleGuard'
import { WhatsAppGraphClient } from '@/lib/whatsapp/graph-client'
import { resolveGraphApiVersion } from '@/lib/whatsapp/config'
import { WhatsAppSecretSchema } from '@/lib/whatsapp/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error: { message: string } | null }> }

// Step 23 — Admin > Intake > Channels > WhatsApp. Same
// intake.manage_channels ≈ admin gate and append-only audit pattern as the
// email channel actions in lib/actions/intake/channels.ts (kept in a
// separate file rather than folded into that one, matching this codebase's
// existing convention of per-provider action modules).
function canManageChannels(role: string): boolean {
  return role === 'admin' || role === 'platform_owner'
}

async function logIntakeAudit(entry: {
  orgId: string; actorId: string | null; entityId: string | null; action: string; metadata?: Record<string, unknown>
}) {
  const admin = createAdminClient() as unknown as AnyClient
  await admin.from('intake_audit_log').insert({
    org_id: entry.orgId, actor_id: entry.actorId, entity_type: 'channel',
    entity_id: entry.entityId, action: entry.action, metadata: entry.metadata ?? {},
  })
}

export async function createWhatsAppChannel(input: {
  name: string
  phoneNumberId: string
  wabaId?: string
  displayName?: string
}): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const name = input.name.trim()
  const phoneNumberId = input.phoneNumberId.trim()
  if (!name) return { error: 'Channel name is required.' }
  if (!phoneNumberId) return { error: 'Meta phone number id is required.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { data, error } = await supabase
    .from('intake_channels')
    .insert({
      org_id: profile.org_id,
      name,
      type: 'whatsapp',
      provider: null,
      config: {
        phone_number_id: phoneNumberId,
        waba_id: input.wabaId?.trim() || undefined,
        display_name: input.displayName?.trim() || undefined,
      },
      status: 'paused',
      created_by: profile.id,
    })
    .select('id')
    .single()

  // Stage 5.1 fix: the partial unique index on (config->>'phone_number_id')
  // has no status filter (migration 20240101000136) — it fires on THIS
  // insert too, not only on activation, since a Meta phone_number_id is a
  // 1:1 external identifier and two channels racing to "reserve" it even in
  // draft/paused state is themselves an ambiguous configuration worth
  // rejecting immediately rather than deferring. Caught here (23505) and
  // mapped to a clean message — surfacing the raw Postgres constraint-name
  // error to an admin was confirmed during Stage 5.1's live UI verification
  // and is exactly what Part 2 of that stage's brief calls out to avoid.
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'Another WhatsApp channel already uses this phone number id.' }
    }
    return { error: error.message }
  }

  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: data.id, action: 'whatsapp_channel_created', metadata: { name, phoneNumberId } })
  revalidatePath('/intake/channels')
  return { id: data.id }
}

export async function saveWhatsAppCredentials(
  channelId: string,
  creds: { accessToken?: string; appSecret?: string; verifyToken?: string }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, org_id, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  const admin = createAdminClient() as unknown as AdminClient

  // A blank field means "keep the existing value" (same convention as the
  // email channel's connectChannel()) so the operator only re-enters what
  // changed — most commonly just a rotated access token.
  let existing: { access_token?: string; app_secret?: string; verify_token?: string } = {}
  if (channel.credentials_ref) {
    const { data } = await admin.rpc('intake_read_credential', { p_ref: channel.credentials_ref })
    try { existing = JSON.parse((data as string) ?? '{}') } catch { existing = {} }
  }

  const accessToken = creds.accessToken?.trim() || existing.access_token
  const appSecret = creds.appSecret?.trim() || existing.app_secret
  const verifyToken = creds.verifyToken?.trim() || existing.verify_token

  const secret = WhatsAppSecretSchema.safeParse({ type: 'whatsapp', access_token: accessToken, app_secret: appSecret, verify_token: verifyToken })
  if (!secret.success) return { error: 'Access token, app secret, and verify token are all required.' }

  const { error: vaultErr } = await admin.rpc('intake_store_credential', { p_channel_id: channelId, p_secret: JSON.stringify(secret.data) })
  if (vaultErr) return { error: `Failed to store credentials: ${vaultErr.message}` }

  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: channelId, action: 'whatsapp_credentials_set' })
  revalidatePath('/intake/channels')
  return {}
}

export async function setWhatsAppChannelActive(channelId: string, active: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const { error } = await supabase
    .from('intake_channels')
    .update({ status: active ? 'active' : 'paused' })
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .eq('type', 'whatsapp')

  // A 23505 here means another active WhatsApp channel (any org) already
  // claims this phone_number_id — the DB-level tenant-isolation invariant
  // this stage added (migration 20240101000136), surfaced as a clear error
  // rather than a raw constraint-violation message.
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: 'Another active WhatsApp channel already uses this phone number id.' }
    }
    return { error: error.message }
  }

  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: channelId, action: active ? 'whatsapp_channel_activated' : 'whatsapp_channel_paused' })
  revalidatePath('/intake/channels')
  return {}
}

export async function getWhatsAppChannelInfo(channelId: string): Promise<{
  error?: string
  credentialConfigured?: boolean
}> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { error: moduleError }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  // Deliberately never returns the token/secret itself (Step 23: "Do not
  // display raw access token") — only whether one is configured.
  return { credentialConfigured: Boolean(channel.credentials_ref) }
}

/**
 * Step 24 / Stage 6 Part 1 — verifies Meta credentials/reachability WITHOUT
 * sending a message to any real user (reads the phone number's own
 * metadata back). The outcome is now PERSISTED (non-secret fields only,
 * into `config`) so a later readiness check can answer "has Meta ever
 * actually been contacted successfully?" as a durable fact rather than
 * something only known for the lifetime of one page load — this is exactly
 * what lets Stage 6's readiness diagnostic distinguish CONFIGURED (a token
 * is present) from VERIFIED (Meta actually accepted it at some point).
 */
export async function testWhatsAppConnection(channelId: string): Promise<{ ok: boolean; error?: string; displayPhoneNumber?: string; verifiedName?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'Unauthorized.' }
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { ok: false, error: moduleError }
  if (!canManageChannels(profile.role)) return { ok: false, error: 'You do not have permission to manage channels.' }

  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, org_id, config, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (!channel) return { ok: false, error: 'Channel not found.' }
  if (!channel.credentials_ref) return { ok: false, error: 'No credentials configured yet.' }

  const admin = createAdminClient() as unknown as AdminClient
  const { data } = await admin.rpc('intake_read_credential', { p_ref: channel.credentials_ref })
  const parsed = WhatsAppSecretSchema.safeParse(JSON.parse((data as string) ?? '{}'))
  if (!parsed.success) return { ok: false, error: 'Stored credentials are incomplete or corrupt.' }

  const config = (channel.config ?? {}) as { phone_number_id?: string; api_version?: string }
  if (!config.phone_number_id) return { ok: false, error: 'No phone number id configured.' }

  const client = new WhatsAppGraphClient(
    config.phone_number_id,
    parsed.data.access_token,
    resolveGraphApiVersion({ phone_number_id: config.phone_number_id, api_version: config.api_version })
  )
  const result = await client.testConnection()

  const nowIso = new Date().toISOString()
  // A failed test must not leave a *previous* success's display_phone_number/
  // verified_name behind — those fields are only meaningful alongside
  // last_test_ok:true, or the Readiness panel would show stale "verified"
  // identity data next to an error, which is exactly the false-green state
  // this diagnostic exists to prevent.
  const testConfigPatch = result.ok
    ? { last_test_at: nowIso, last_test_ok: true, last_test_display_phone_number: result.displayPhoneNumber, last_test_verified_name: result.verifiedName, last_test_error: null }
    : { last_test_at: nowIso, last_test_ok: false, last_test_error: result.message, last_test_display_phone_number: null, last_test_verified_name: null }
  await rls.from('intake_channels').update({ config: { ...config, ...testConfigPatch } }).eq('id', channelId).eq('org_id', profile.org_id)
  await logIntakeAudit({ orgId: profile.org_id!, actorId: profile.id, entityId: channelId, action: result.ok ? 'whatsapp_test_connection_succeeded' : 'whatsapp_test_connection_failed', metadata: result.ok ? {} : { error: result.message } })
  revalidatePath('/intake/channels')

  if (!result.ok) return { ok: false, error: result.message }
  return { ok: true, displayPhoneNumber: result.displayPhoneNumber ?? undefined, verifiedName: result.verifiedName ?? undefined }
}

export type WhatsAppChannelReadiness = {
  channelConfigured: boolean
  channelActive: boolean
  phoneNumberIdConfigured: boolean
  wabaIdConfigured: boolean
  credentialsConfigured: boolean
  webhookCallbackUrl: string | null
  metaConnectionVerified: boolean
  metaConnectionLastTestedAt: string | null
  metaConnectionLastError: string | null
  metaDisplayPhoneNumber: string | null
  metaVerifiedName: string | null
  requesterMobileCoverage: { activeUsers: number; activeWithMobile: number; activeWithoutMobile: number }
  webhookHealth: 'unknown' | 'ok' | 'errors_detected'
  webhookHealthDetail: string | null
}

/**
 * Stage 6, Part 1 — the readiness diagnostic itself. Deliberately
 * distinguishes CONFIGURED (a value is present) from VERIFIED (Meta has
 * actually accepted it) at every point that distinction matters — never
 * reports a green "production-ready" state merely because credentials
 * exist. Never returns a secret value; `metaConnectionVerified` and its
 * neighbors come entirely from the non-secret `last_test_*` fields
 * testWhatsAppConnection() persists into `config`, never from re-reading
 * the Vault secret itself.
 *
 * Deliberately does NOT gate on requireModuleEnabled('intake') (unlike
 * every other action in this file) — Stage 7.1: Platform Settings >
 * Integrations surfaces this same readiness so an admin always has one
 * stable place to see WhatsApp's status, even while the Intake module
 * itself is toggled off. A read-only status view isn't "using" the
 * feature; nothing here needs the module to be licensed/enabled.
 */
export async function getWhatsAppChannelReadiness(channelId: string): Promise<{ error?: string; readiness?: WhatsAppChannelReadiness }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Unauthorized.' }
  if (!canManageChannels(profile.role)) return { error: 'You do not have permission to manage channels.' }

  const rls = (await createClient()) as unknown as AnyClient
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, status, config, credentials_ref')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (!channel) return { error: 'Channel not found.' }

  const config = (channel.config ?? {}) as {
    phone_number_id?: string; waba_id?: string
    last_test_at?: string; last_test_ok?: boolean; last_test_error?: string
    last_test_display_phone_number?: string; last_test_verified_name?: string
  }

  const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || null
  const webhookCallbackUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/intake/webhook/whatsapp` : null

  const { count: activeUsers } = await rls.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).eq('is_active', true)
  // Numbers now live in profile_mobile_numbers (many:1 as of migration
  // 20240101000140) — count DISTINCT active profiles with at least one
  // number, not rows, so a profile with several numbers is still counted
  // once. Filtered via an embedded join against profiles rather than
  // fetching every active profile id and passing it through `.in()`: an org
  // with hundreds of active users (real orgs do) blows PostgREST's GET URL
  // length limit, which supabase-js reports as an error but this call was
  // discarding via `?? []`, so the coverage count silently went to 0 for
  // any org that size instead of surfacing the failure.
  const { data: mobileRows } = await rls
    .from('profile_mobile_numbers')
    .select('profile_id, profiles!inner(is_active)')
    .eq('org_id', profile.org_id)
    .eq('profiles.is_active', true)
  const activeWithMobile = new Set((mobileRows ?? []).map((r: { profile_id: string }) => r.profile_id)).size

  // Webhook health — derived from this channel's own recent audit trail
  // (Part 22's own audit-log verification is what makes this trustworthy).
  // 'unknown' is the honest, default answer until real traffic exists —
  // never fabricated as "ok" just because no errors have been seen yet.
  const admin = createAdminClient() as unknown as AnyClient
  const { data: recentAudit } = await admin
    .from('intake_audit_log')
    .select('action')
    .eq('org_id', profile.org_id)
    .in('action', ['whatsapp_message_processed', 'whatsapp_invalid_signature', 'whatsapp_channel_not_found', 'whatsapp_channel_conflict'])
    .order('created_at', { ascending: false })
    .limit(20)
  const rows = (recentAudit ?? []) as { action: string }[]
  const hasProcessed = rows.some((r) => r.action === 'whatsapp_message_processed')
  const hasErrors = rows.some((r) => r.action !== 'whatsapp_message_processed')
  const webhookHealth: WhatsAppChannelReadiness['webhookHealth'] = rows.length === 0 ? 'unknown' : hasErrors && !hasProcessed ? 'errors_detected' : 'ok'
  const webhookHealthDetail = rows.length === 0
    ? 'No webhook traffic recorded yet for this org — health cannot be determined until Meta sends a real event.'
    : hasErrors ? 'Recent signature/channel-resolution errors were recorded — check intake_audit_log for detail.' : 'Recent traffic processed without signature/channel errors.'

  return {
    readiness: {
      channelConfigured: true,
      channelActive: channel.status === 'active',
      phoneNumberIdConfigured: Boolean(config.phone_number_id),
      wabaIdConfigured: Boolean(config.waba_id),
      credentialsConfigured: Boolean(channel.credentials_ref),
      webhookCallbackUrl,
      metaConnectionVerified: config.last_test_ok === true,
      metaConnectionLastTestedAt: config.last_test_at ?? null,
      metaConnectionLastError: config.last_test_ok === false ? (config.last_test_error ?? null) : null,
      metaDisplayPhoneNumber: config.last_test_display_phone_number ?? null,
      metaVerifiedName: config.last_test_verified_name ?? null,
      requesterMobileCoverage: {
        activeUsers: activeUsers ?? 0,
        activeWithMobile: activeWithMobile ?? 0,
        activeWithoutMobile: (activeUsers ?? 0) - (activeWithMobile ?? 0),
      },
      webhookHealth,
      webhookHealthDetail,
    },
  }
}
