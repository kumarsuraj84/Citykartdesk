// Reads the permission switches (app_settings: policy.<key>) and answers "may this role do that?" for the server actions. Server-side only.
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_POLICIES, POLICY_OPTIONS, can, type Capability, type PolicyKey, type PolicyValues } from '@/lib/permissions/matrix'

const KEYS = Object.keys(POLICY_OPTIONS) as PolicyKey[]
const CACHE_MS = 10_000
let cache: { at: number; value: PolicyValues } | null = null

export function invalidatePolicies() { cache = null }

/** The current switches; an unknown or missing value is today's behaviour (the default), never something looser. */
export async function loadPolicies(): Promise<PolicyValues> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const value: PolicyValues = { ...DEFAULT_POLICIES }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data } = await admin.from('app_settings').select('key, value').in('key', KEYS.map((k) => `policy.${k}`))
    for (const row of (data ?? []) as { key: string; value: string }[]) {
      const k = row.key.replace(/^policy\./, '') as PolicyKey
      if ((POLICY_OPTIONS[k] as readonly string[] | undefined)?.includes(row.value)) (value as Record<string, string>)[k] = row.value
    }
  } catch { /* the defaults apply */ }
  cache = { at: Date.now(), value }
  return value
}

/** An error message when this person may not do this, otherwise null. */
export async function requireCapability(profile: { role: string } | null | undefined, capability: Capability): Promise<string | null> {
  if (!profile) return 'Unauthorized.'
  const policies = await loadPolicies()
  if (can(profile.role, capability, policies)) return null
  return 'Unauthorized.' // the same wording every admin action has always used (screens and tests rely on it)
}

export async function roleMay(role: string, capability: Capability): Promise<boolean> {
  return can(role, capability, await loadPolicies())
}
