import type { QuestionnaireServiceSummary, SubCategorySearchResult } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

// ── Step 2: service listing ─────────────────────────────────────────────────
// Every query here filters `org_id` explicitly in application code — `client`
// is expected to be the admin (service-role) client for a channel with no
// browser session (WhatsApp), which bypasses RLS entirely, so nothing here
// may rely on RLS for tenant isolation. Mirrors createRequestCore()'s own
// "explicit org_id filter on every read" rule (see its top-of-file comment).
//
// Deliberately narrower than lib/queries/services.ts's getServices(): this is
// always a self-serve requester raising their own ticket through a
// conversational flow, never an admin/manager browsing draft/review-status
// services — so only `published` + `is_active` services are ever listed here,
// matching exactly what a plain 'user' role sees on the web catalog
// (getAllowedStatuses() in lib/queries/services.ts), with no role parameter
// to keep this narrower, explicit surface from ever being asked to expose more.
export async function listQuestionnaireServices(params: {
  client: AnyClient
  orgId: string
  requesterLocationId?: string | null
}): Promise<QuestionnaireServiceSummary[]> {
  const { client, orgId, requesterLocationId = null } = params

  const { data } = await client
    .from('services')
    .select('id, name, description, slug')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .eq('status', 'published')
    .order('sort_order')

  const services = (data ?? []) as QuestionnaireServiceSummary[]
  if (services.length === 0) return services

  // Location-scoped visibility — same rule as filterServicesByLocation() in
  // lib/queries/services.ts (no tags = visible to everyone; tagged = only to
  // a requester at one of the tagged locations), reimplemented here against
  // an explicit requesterLocationId instead of the RLS-session-bound
  // getCurrentProfile() that function uses, since a channel with no browser
  // session has no such session to read from.
  const { data: tags } = await client
    .from('service_location_tags')
    .select('service_id, location_id')
    .in('service_id', services.map((s) => s.id))

  const restricted = new Set<string>()
  const allowedForMe = new Set<string>()
  for (const t of (tags ?? []) as { service_id: string; location_id: string }[]) {
    restricted.add(t.service_id)
    if (requesterLocationId && t.location_id === requesterLocationId) allowedForMe.add(t.service_id)
  }

  return services.filter((s) => !restricted.has(s.id) || allowedForMe.has(s.id))
}

// ── Step 3: issue-keyword search over Sub-categories ────────────────────────

/**
 * Deterministic, inexpensive keyword scoring for one sub-category name
 * against a free-text query — no AI/embeddings (per explicit product
 * decision: Stage 3's search must not depend on an AI provider). Pure and
 * independently unit-testable. Exact match scores highest, then prefix, then
 * substring, then partial word overlap; anything scoring 0 is not a match.
 */
export function scoreSubCategoryMatch(query: string, name: string): number {
  const q = query.trim().toLowerCase()
  const n = name.trim().toLowerCase()
  if (!q || !n) return 0
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  if (n.includes(q)) return 60

  const queryWords = q.split(/\s+/).filter(Boolean)
  const nameWords = n.split(/\s+/).filter(Boolean)
  if (queryWords.length === 0 || nameWords.length === 0) return 0

  const matchedWords = queryWords.filter((w) => nameWords.some((nw) => nw.includes(w) || w.includes(nw)))
  if (matchedWords.length === 0) return 0
  return Math.round((matchedWords.length / queryWords.length) * 40)
}

/**
 * Searches the sub-categories tagged to `serviceId` (and only that service's
 * tagged set — see the UNIQUE(sub_category_id) exclusivity constraint noted
 * throughout the codebase, which makes a service's tagged sub-categories
 * inherently org-safe) for `query`. An empty query returns the full tagged,
 * active list alphabetically, so a caller can offer "pick one" before the
 * requester has typed anything — a structured empty/zero-results state is
 * just an empty array either way; the caller decides how to phrase it.
 */
export async function searchSubCategories(params: {
  client: AnyClient
  orgId: string
  serviceId: string
  query: string
  limit?: number
}): Promise<SubCategorySearchResult[]> {
  const { client, orgId, serviceId, query, limit = 10 } = params

  // Defense-in-depth: confirm the service actually belongs to this org and is
  // still active before trusting its tag set, the same way createRequestCore()
  // re-validates on every call rather than assuming an earlier step already did.
  const { data: service } = await client
    .from('services')
    .select('id')
    .eq('id', serviceId)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!service) return []

  type Row = {
    sub_category: {
      id: string
      name: string
      category_id: string
      is_active: boolean | null
      category: { name: string } | null
    } | null
  }
  const { data: tagged } = await client
    .from('service_sub_category_tags')
    .select('sub_category:service_sub_categories(id, name, category_id, is_active, category:service_categories(name))')
    .eq('service_id', serviceId)

  const active = ((tagged ?? []) as Row[])
    .map((r) => r.sub_category)
    .filter((s): s is NonNullable<Row['sub_category']> => !!s && s.is_active !== false)

  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return active
      .map((s) => ({ id: s.id, name: s.name, categoryId: s.category_id, categoryName: s.category?.name ?? '—', score: 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
  }

  return active
    .map((s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.category_id,
      categoryName: s.category?.name ?? '—',
      score: scoreSubCategoryMatch(trimmedQuery, s.name),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}
