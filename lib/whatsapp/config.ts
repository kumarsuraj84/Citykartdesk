import { secureCompare } from '@/lib/secure-compare'
import { WhatsAppSecretSchema, type WhatsAppChannelConfig, type WhatsAppSecret } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export type WhatsAppChannelRow = {
  id: string
  orgId: string
  name: string
  status: 'active' | 'paused' | 'error'
  config: WhatsAppChannelConfig
  credentialsRef: string | null
}

function mapChannelRow(row: {
  id: string; org_id: string; name: string; status: string; config: unknown; credentials_ref: string | null
}): WhatsAppChannelRow {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    status: row.status as WhatsAppChannelRow['status'],
    config: (row.config ?? {}) as WhatsAppChannelConfig,
    credentialsRef: row.credentials_ref,
  }
}

/**
 * Step 5 — the ONLY way a WhatsApp channel is resolved for an inbound
 * message: by Meta's destination phone_number_id, never by the sender.
 * phone_number_id is globally unique to one Meta phone number (enforced by
 * a partial unique index — see migration 20240101000136), so at most one
 * row can ever match; still defends against a corrupt/duplicate config by
 * treating more than one match as a configuration error rather than
 * guessing.
 */
export async function findActiveWhatsAppChannelByPhoneNumberId(
  admin: AnyClient,
  phoneNumberId: string
): Promise<{ ok: true; channel: WhatsAppChannelRow } | { ok: false; reason: 'not_found' | 'conflict' }> {
  const { data, error } = await admin
    .from('intake_channels')
    .select('id, org_id, name, status, config, credentials_ref')
    .eq('type', 'whatsapp')
    .eq('status', 'active')
    .contains('config', { phone_number_id: phoneNumberId })

  if (error || !data) return { ok: false, reason: 'not_found' }
  if (data.length === 0) return { ok: false, reason: 'not_found' }
  if (data.length > 1) return { ok: false, reason: 'conflict' }
  return { ok: true, channel: mapChannelRow(data[0]) }
}

/** Used only by the GET webhook-verification handshake, which arrives with
 *  no phone_number_id context — Meta signs the verify token at the App
 *  level. Scanning active channels is acceptable here: this only runs
 *  during initial setup / occasional re-verification, never per message. */
export async function findAllActiveWhatsAppChannels(admin: AnyClient): Promise<WhatsAppChannelRow[]> {
  const { data, error } = await admin
    .from('intake_channels')
    .select('id, org_id, name, status, config, credentials_ref')
    .eq('type', 'whatsapp')
    .eq('status', 'active')

  if (error || !data) return []
  return data.map(mapChannelRow)
}

export async function loadWhatsAppSecret(admin: AnyClient, channel: WhatsAppChannelRow): Promise<WhatsAppSecret | null> {
  if (!channel.credentialsRef) return null
  const { data, error } = await admin.rpc('intake_read_credential', { p_ref: channel.credentialsRef })
  if (error || typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data)
    const result = WhatsAppSecretSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Step 3 — Meta's GET webhook-verification handshake carries no
 * phone_number_id (it's an App-level handshake, not a per-number one), so
 * the only available check is: does the provided token match ANY currently
 * active WhatsApp channel's stored verify_token? This only runs during
 * initial setup or an occasional re-verification — never per inbound
 * message — so scanning active channels (bounded by the number of
 * configured WhatsApp channels, not messages) is acceptable.
 */
export async function verifyWebhookChallenge(
  admin: AnyClient,
  mode: string | null,
  token: string | null
): Promise<boolean> {
  if (mode !== 'subscribe' || !token) return false
  const channels = await findAllActiveWhatsAppChannels(admin)
  for (const channel of channels) {
    const secret = await loadWhatsAppSecret(admin, channel)
    if (secret && secureCompare(secret.verify_token, token)) return true
  }
  return false
}

const DEFAULT_GRAPH_API_VERSION = 'v23.0'

/** Documented, overridable rather than scattered through code (Step 14):
 *  a channel's own config.api_version wins (per-WABA flexibility), falling
 *  back to the deployment-wide META_GRAPH_API_VERSION env var, falling
 *  back to the version current as of this stage's implementation. */
export function resolveGraphApiVersion(source?: WhatsAppChannelRow | WhatsAppChannelConfig): string {
  const configApiVersion = source && 'config' in source ? source.config.api_version : (source as WhatsAppChannelConfig | undefined)?.api_version
  return configApiVersion || process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION
}
