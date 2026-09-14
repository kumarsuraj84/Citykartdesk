// Fallback chain when nothing's configured in Admin → Platform Settings →
// Integrations yet: EMAIL_FROM env var, then this hardcoded default.
const DEFAULT_EMAIL_FROM = process.env.EMAIL_FROM ?? 'Citykart Desk <noreply@citykart.org>'
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
export const EMAIL_ENABLED = !!RESEND_API_KEY

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
    const address = settings.get('email_from_address')?.trim()
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
    return DEFAULT_EMAIL_FROM
  }
}
