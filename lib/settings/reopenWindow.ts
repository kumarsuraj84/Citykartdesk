import { createAdminClient } from '@/lib/supabase/admin'

// The value this was hardcoded to before Request Configuration → General's
// "Auto-close after resolution (days)" setting was actually wired up to
// anything — kept as the fallback so behavior is unchanged for any install
// that hasn't touched the setting (or if the DB read fails transiently).
const DEFAULT_DAYS = 3

let cached: { hours: number; expiresAt: number } | null = null
const CACHE_MS = 60_000

/**
 * Hours after resolving a request that the requester (or the resolving
 * agent) may still reopen it — configurable at Request Configuration →
 * General, stored in app_settings('auto_close_days') as whole days. Governs
 * both updateRequestStatus()'s reopen check (lib/actions/requests.ts) and
 * the Business Rules "set status" action's own resolve path
 * (lib/rules/actions.ts), so both honor the same admin-set window.
 *
 * NOT the same as the separate, fixed 48h window an approval-rejection
 * reopen gets (lib/actions/approvals.ts) — that's deliberately
 * un-configurable (an honest mistake on rejection reads differently from
 * "not satisfied with the resolution"), so it's untouched by this setting.
 */
export async function getResolvedReopenWindowHours(): Promise<number> {
  if (cached && cached.expiresAt > Date.now()) return cached.hours

  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'auto_close_days').maybeSingle()
    const days = parseInt(data?.value ?? '', 10)
    const hours = Number.isFinite(days) && days > 0 ? days * 24 : DEFAULT_DAYS * 24

    cached = { hours, expiresAt: Date.now() + CACHE_MS }
    return hours
  } catch {
    // DB unreachable — fall back to the default rather than failing the
    // caller, and deliberately don't cache it (see the matching lesson in
    // lib/email/config.ts's getEmailFrom()): a transient blip shouldn't
    // override a correctly configured window for the full 60s TTL.
    return DEFAULT_DAYS * 24
  }
}
