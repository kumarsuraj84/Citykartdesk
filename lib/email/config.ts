// Outbound email has two interchangeable delivery methods, chosen by which
// environment variables are set (restart the app after changing them):
//
//   1. SMTP  — a mailbox / mail server you already own, e.g. Google Workspace:
//        SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
//        SMTP_USER=citykartdesk@citykartstores.com  SMTP_PASS=<Google App Password>
//      SMTP_PASS is optional for servers that authenticate by IP address (e.g.
//      Google's smtp-relay.gmail.com). SMTP_FROM_ADDRESS overrides the sender.
//   2. Resend — an email API service:  RESEND_API_KEY=re_...
//
// SMTP wins when both are configured. With neither, email is disabled and every
// send is a logged no-op (same as before this option existed).

export type EmailProvider = 'smtp' | 'resend'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string | null
  pass: string | null
  fromAddress: string | null
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

export function resolveEmailProvider(env: Env = process.env): EmailProvider | null {
  if (readSmtpConfig(env)) return 'smtp'
  if (env.RESEND_API_KEY) return 'resend'
  return null
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
export const SMTP_CONFIG = readSmtpConfig()
export const EMAIL_PROVIDER = resolveEmailProvider()
export const EMAIL_ENABLED = EMAIL_PROVIDER !== null

let cachedFrom: { value: string; expiresAt: number } | null = null
const FROM_CACHE_MS = 60_000

/**
 * The "From" address every outbound email sends as — configurable at
 * Admin → Platform Settings → Integrations (app_settings rows
 * 'email_from_name' / 'email_from_address') instead of being baked into an
 * env var, so it can be changed anytime without a redeploy. Governs both
 * user notification emails and the OEM auto-routing emails (createRequest())
 * since both go through sendEmail(). Cached briefly to avoid a DB round
 * trip on every single send — a bulk notify() (e.g. one Business Rule
 * emailing every manager) fans out many sendEmail() calls in parallel.
 */
export async function getEmailFrom(): Promise<string> {
  if (cachedFrom && cachedFrom.expiresAt > Date.now()) return cachedFrom.value

  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { data } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', ['email_from_name', 'email_from_address'])
    const settings = new Map((data ?? []).map((r) => [r.key, r.value]))
    const address = resolveSenderAddress(EMAIL_PROVIDER, SMTP_CONFIG, settings.get('email_from_address'))
    const value = address
      ? `${settings.get('email_from_name')?.trim() || 'Citykart Desk'} <${address}>`
      : DEFAULT_EMAIL_FROM

    cachedFrom = { value, expiresAt: Date.now() + FROM_CACHE_MS }
    return value
  } catch {
    // DB unreachable — fall back to the env var/default rather than failing
    // the send, but deliberately don't cache it: a transient blip shouldn't
    // silently override a correctly configured custom sender for the full
    // 60s TTL, only for the one send that hit it.
    if (EMAIL_PROVIDER === 'smtp' && SMTP_CONFIG) {
      const address = SMTP_CONFIG.fromAddress ?? SMTP_CONFIG.user
      if (address) return `Citykart Desk <${address}>`
    }
    return DEFAULT_EMAIL_FROM
  }
}
