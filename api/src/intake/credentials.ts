import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'

// Resolved credentials handed to ImapFlow / nodemailer. Exactly one of
// `password` (basic auth) or `accessToken` (XOAUTH2) is set.
export interface ImapCredentials {
  host: string
  port: number
  secure: boolean
  user: string
  password?: string
  accessToken?: string
}

// Raw secret shapes stored in Vault.
interface BasicSecret {
  type?: 'basic'
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}
interface OAuthSecret {
  type: 'oauth'
  provider: 'google' | 'microsoft'
  host: string
  port: number
  secure: boolean
  user: string
  refresh_token: string
}

function oauthTokenUrl(provider: 'google' | 'microsoft'): string {
  return provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
}

function oauthClient(provider: 'google' | 'microsoft'): { id?: string; secret?: string } {
  return provider === 'google'
    ? { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }
    : { id: process.env.MS_OAUTH_CLIENT_ID,     secret: process.env.MS_OAUTH_CLIENT_SECRET }
}

// Exchange a stored refresh_token for a fresh access_token. Access tokens are
// short-lived (~1h) so we mint one per poll rather than caching.
async function refreshAccessToken(secret: OAuthSecret): Promise<string | null> {
  const client = oauthClient(secret.provider)
  if (!client.id || !client.secret) {
    log.error(`OAuth client for ${secret.provider} not configured on the worker`)
    return null
  }
  const params = new URLSearchParams({
    client_id:     client.id,
    client_secret: client.secret,
    refresh_token: secret.refresh_token,
    grant_type:    'refresh_token',
  })
  try {
    const res = await fetch(oauthTokenUrl(secret.provider), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = (await res.json()) as { access_token?: string; error_description?: string; error?: string }
    if (!res.ok || !data.access_token) {
      log.warn(`token refresh failed for ${secret.user}: ${data.error_description ?? data.error ?? res.status}`)
      return null
    }
    return data.access_token
  } catch (err) {
    log.warn('token refresh request errored', err instanceof Error ? err.message : err)
    return null
  }
}

// Reads a channel's decrypted credentials from Supabase Vault via the
// service-role-only RPC. For OAuth secrets, refreshes the access token so the
// caller always receives ready-to-use credentials. Returns null on any failure.
export async function readImapCredentials(credentialsRef: string): Promise<ImapCredentials | null> {
  const { data, error } = await supabase.rpc('intake_read_credential', { p_ref: credentialsRef })
  if (error || !data) return null

  let parsed: BasicSecret | OAuthSecret
  try {
    parsed = JSON.parse(data as string)
  } catch {
    return null
  }

  if (parsed.type === 'oauth') {
    const accessToken = await refreshAccessToken(parsed)
    if (!accessToken) return null
    return {
      host: parsed.host, port: parsed.port, secure: parsed.secure,
      user: parsed.user, accessToken,
    }
  }

  return {
    host: parsed.host, port: parsed.port, secure: parsed.secure,
    user: parsed.user, password: (parsed as BasicSecret).password,
  }
}
