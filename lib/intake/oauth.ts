import crypto from 'crypto'

// OAuth2 for mailbox access. Microsoft permanently disabled basic-auth IMAP and
// Google blocks account-password IMAP, so Gmail/M365 must authenticate via
// OAuth2 + XOAUTH2. This module holds the provider config and the signed-state
// helpers shared by the start/callback route handlers.

export type OAuthProvider = 'google' | 'microsoft'

export interface ProviderConfig {
  authorizeUrl: string
  tokenUrl: string
  scopes: string
  imapHost: string
  imapPort: number
  clientId: string | undefined
  clientSecret: string | undefined
  // Extra params appended to the authorize URL (e.g. forcing a refresh token).
  authorizeExtra: Record<string, string>
}

export function providerConfig(provider: OAuthProvider): ProviderConfig {
  if (provider === 'google') {
    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl:     'https://oauth2.googleapis.com/token',
      // mail.google.com = full IMAP/SMTP; openid+email so the id_token carries
      // the mailbox address (no extra userinfo round-trip needed).
      scopes:       'https://mail.google.com/ openid email',
      imapHost:     'imap.gmail.com',
      imapPort:     993,
      clientId:     process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      // offline + consent forces Google to return a refresh_token every time.
      authorizeExtra: { access_type: 'offline', prompt: 'consent' },
    }
  }
  return {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl:     'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes:       'https://outlook.office365.com/IMAP.AccessAsUser.All offline_access openid email',
    imapHost:     'outlook.office365.com',
    imapPort:     993,
    clientId:     process.env.MS_OAUTH_CLIENT_ID,
    clientSecret: process.env.MS_OAUTH_CLIENT_SECRET,
    authorizeExtra: {},
  }
}

function stateSecret(): string {
  return process.env.OAUTH_STATE_SECRET
    ?? process.env.INTAKE_WORKER_SECRET
    ?? process.env.CRON_SECRET
    ?? ''
}

// Signed, short-lived state so the callback can trust channelId/provider without
// a server-side session store. Payload is base64url(JSON).HMAC.
export function signState(payload: { channelId: string; provider: OAuthProvider }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string): { channelId: string; provider: OAuthProvider } | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  // Constant-time compare; lengths must match or timingSafeEqual throws.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      channelId: string; provider: OAuthProvider; ts: number
    }
    // 15-minute window — the consent round-trip is far shorter in practice.
    if (Date.now() - parsed.ts > 15 * 60 * 1000) return null
    return { channelId: parsed.channelId, provider: parsed.provider }
  } catch {
    return null
  }
}

// Decode a JWT payload WITHOUT verification. Safe here: the id_token arrives
// directly from the provider's token endpoint over TLS, so we only need to read
// the mailbox address from it, not to trust it as an auth assertion.
export function decodeJwtEmail(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: string; preferred_username?: string; upn?: string
    }
    return json.email ?? json.preferred_username ?? json.upn ?? null
  } catch {
    return null
  }
}

// Exchange an authorization code for tokens. Returns the refresh_token (long
// lived, stored in Vault), an access_token (used immediately for watch/subscription
// setup before the Vault write), and the mailbox email parsed from the id_token.
export async function exchangeCode(opts: {
  provider: OAuthProvider
  code: string
  redirectUri: string
}): Promise<{ refreshToken: string; accessToken: string; email: string | null } | { error: string }> {
  const cfg = providerConfig(opts.provider)
  if (!cfg.clientId || !cfg.clientSecret) {
    return { error: `${opts.provider} OAuth client is not configured on the server.` }
  }

  const params = new URLSearchParams({
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    code:          opts.code,
    grant_type:    'authorization_code',
    redirect_uri:  opts.redirectUri,
  })

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const data = (await res.json()) as {
    refresh_token?: string; access_token?: string; id_token?: string
    error_description?: string; error?: string
  }
  if (!res.ok || !data.refresh_token) {
    return { error: data.error_description ?? data.error ?? 'Token exchange failed (no refresh_token returned).' }
  }
  return {
    refreshToken: data.refresh_token,
    accessToken:  data.access_token ?? '',
    email: data.id_token ? decodeJwtEmail(data.id_token) : null,
  }
}
