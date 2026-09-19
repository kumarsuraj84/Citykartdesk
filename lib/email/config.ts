// Outbound email has interchangeable delivery methods. In order of priority:
//
//   1. A mailbox saved in Admin > Platform Settings (stored in the database, the
//      password encrypted) — changeable anytime without touching the server.
//   2. SMTP settings in the server's environment file (SMTP_HOST / SMTP_PORT /
//      SMTP_USER / SMTP_PASS, optional SMTP_FROM_ADDRESS) — restart to change.
//   3. Resend, an email API service (RESEND_API_KEY).
//
// With none of them, email is disabled and every send is a logged no-op.
// SMTP_PASS may be left out for login-less relays (e.g. Google's smtp-relay.gmail.com,
// which trusts the server's IP address).

export type EmailProvider = 'smtp' | 'resend'
export type EmailSource = 'database' | 'environment' | 'resend'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string | null
  pass: string | null
  fromAddress: string | null
}

export type EmailSetup = {
  provider: EmailProvider | null
  smtp: SmtpConfig | null
  source: EmailSource | null
}

type Env = Record<string, string | undefined>

export function readSmtpConfig(env: Env = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  if (!host) return null
  const port = Number(env.SMTP_PORT) || 587
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === 'true' : port === 465
  return {
    host,
    port,
    secure,
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS || null,
    fromAddress: env.SMTP_FROM_ADDRESS?.trim() || null,
  }
}

/** Pure priority rule: saved mailbox, then server-file SMTP, then Resend, else off. */
export function pickEmailSetup(dbSmtp: SmtpConfig | null, env: Env = process.env): EmailSetup {
  if (dbSmtp) return { provider: 'smtp', smtp: dbSmtp, source: 'database' }
  const envSmtp = readSmtpConfig(env)
  if (envSmtp) return { provider: 'smtp', smtp: envSmtp, source: 'environment' }
  if (env.RESEND_API_KEY) return { provider: 'resend', smtp: null, source: 'resend' }
  return { provider: null, smtp: null, source: null }
}

export async function getEmailSetup(): Promise<EmailSetup> {
  const { loadDbSmtpConfig } = await import('./mailbox')
  return pickEmailSetup(await loadDbSmtpConfig())
}

/**
 * The address mail is actually sent from. Gmail/Workspace only lets a mailbox send
 * as itself (or a configured alias), so with SMTP the authenticated user wins over
 * the address saved in Admin → Platform Settings, which would otherwise be silently
 * rewritten by Google. Only the display name stays admin-configurable.
 */
export function resolveSenderAddress(
  provider: EmailProvider | null,
  smtp: SmtpConfig | null,
  settingsAddress: string | null | undefined
): string | null {
  const configured = settingsAddress?.trim() || null
  if (provider === 'smtp' && smtp) return smtp.fromAddress ?? smtp.user ?? configured
  return configured
}

// Fallback chain when nothing's configured in Admin → Platform Settings →
// Integrations yet: EMAIL_FROM env var, then this hardcoded default.
// `||`, not `??`: an env file with a blank `EMAIL_FROM=` line must fall back to the default
// rather than send with no From address at all.
export function defaultEmailFrom(env: Env = process.env): string {
  return env.EMAIL_FROM?.trim() || 'Citykart Desk <noreply@citykart.org>'
}
const DEFAULT_EMAIL_FROM = defaultEmailFrom()
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''

let cachedFrom: { key: string; value: string; expiresAt: number } | null = null
const FROM_CACHE_MS = 60_000

/**
 * The "From" address every outbound email sends as — the display name is configurable
 * at Admin → Platform Settings → Integrations (app_settings 'email_from_name' /
 * 'email_from_address'), so it can be changed anytime without a redeploy. Governs both
 * user notification emails and the OEM auto-routing emails (createRequest())
 * since both go through sendEmail(). Cached briefly to avoid a DB round
 * trip on every single send — a bulk notify() (e.g. one Business Rule
 * emailing every manager) fans out many sendEmail() calls in parallel.
 */
export async function getEmailFrom(setup?: EmailSetup): Promise<string> {
  const active = setup ?? (await getEmailSetup())
  const key = `${active.provider}|${active.smtp?.user ?? ''}|${active.smtp?.fromAddress ?? ''}`
  if (cachedFrom && cachedFrom.key === key && cachedFrom.expiresAt > Date.now()) return cachedFrom.value

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { data } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', ['email_from_name', 'email_from_address'])
    const settings = new Map((data ?? []).map((r) => [r.key, r.value]))
    const address = resolveSenderAddress(active.provider, active.smtp, settings.get('email_from_address'))
    const value = address
      ? `${settings.get('email_from_name')?.trim() || 'Citykart Desk'} <${address}>`
      : DEFAULT_EMAIL_FROM

    cachedFrom = { key, value, expiresAt: Date.now() + FROM_CACHE_MS }
    return value
  } catch {
    // DB unreachable — fall back to the env var/default rather than failing
    // the send, but deliberately don't cache it: a transient blip shouldn't
    // silently override a correctly configured custom sender for the full
    // 60s TTL, only for the one send that hit it.
    if (active.provider === 'smtp' && active.smtp) {
      const address = active.smtp.fromAddress ?? active.smtp.user
      if (address) return `Citykart Desk <${address}>`
    }
    return DEFAULT_EMAIL_FROM
  }
}
