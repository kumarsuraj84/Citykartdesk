import { createAdminClient } from '@/lib/supabase/admin'

export interface CsatSettings {
  /** send the "resolved + how did we do?" e-mail and ask for a rating */
  enabled: boolean
  /** days after resolving to send one reminder to a requester who has not rated or reopened; 0 = no reminder */
  reminderDays: number
}

export const CSAT_DEFAULTS: CsatSettings = { enabled: true, reminderDays: 2 }

let cached: { value: CsatSettings; expiresAt: number } | null = null

/** Read from Request Configuration → General (app_settings keys csat_enabled, csat_reminder_days). Cached for a minute. */
export async function getCsatSettings(): Promise<CsatSettings> {
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('key, value').in('key', ['csat_enabled', 'csat_reminder_days'])
    const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
    const days = parseInt(map.get('csat_reminder_days') ?? '', 10)
    const value: CsatSettings = {
      enabled: map.get('csat_enabled') !== 'false',
      reminderDays: Number.isFinite(days) && days >= 0 ? days : CSAT_DEFAULTS.reminderDays,
    }
    cached = { value, expiresAt: Date.now() + 60_000 }
    return value
  } catch {
    return CSAT_DEFAULTS
  }
}

/** For tests and right after an admin saves a setting. */
export function resetCsatSettingsCache(): void { cached = null }
