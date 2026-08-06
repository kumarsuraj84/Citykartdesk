import { supabase } from '../../lib/supabase.js'
import type { IntakeEnvelope } from './types.js'

// A service from the org catalog, with the keyword vocabulary the rest of the app
// already uses for routing/search. This is what binds intake to the real
// hierarchy: resolving a service yields its team, priority and form fields.
export interface CatalogService {
  id: string
  name: string
  keywords: string[]
  categoryId: string | null
  categorySlug: string | null
  teamId: string | null
  defaultPriority: string | null
}

export interface ServiceMatch {
  serviceId: string
  categoryId: string | null
  teamId: string | null
}

// Load the org's active services joined to their category slug (so we can align
// with the rule engine's category suggestion). Service-role read — caller scopes
// by org_id since RLS is bypassed.
export async function loadCatalog(orgId: string): Promise<CatalogService[]> {
  const { data } = await supabase
    .from('services')
    .select('id, name, keywords, category_id, team_id, default_priority, service_categories(slug)')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (!data?.length) return []
  return data.map((s): CatalogService => ({
    id: s.id,
    name: s.name,
    keywords: (s.keywords as string[] | null) ?? [],
    categoryId: s.category_id ?? null,
    categorySlug: (s as { service_categories?: { slug?: string } }).service_categories?.slug ?? null,
    teamId: s.team_id ?? null,
    defaultPriority: (s.default_priority as string | null) ?? null,
  }))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Count keyword hits in a haystack (word-boundary for plain tokens, substring for
// phrases) — same matching semantics as the rule engine.
function keywordHits(haystack: string, keywords: string[]): number {
  if (!haystack) return 0
  const hay = haystack.toLowerCase()
  let n = 0
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim()
    if (!k) continue
    const isPhrase = /[\s@_]/.test(k)
    const hit = isPhrase ? hay.includes(k) : new RegExp(`\\b${escapeRegex(k)}\\b`, 'i').test(hay)
    if (hit) n++
  }
  return n
}

// Resolve the best-matching service for an actionable email. Subject hits count
// double (higher-signal than body, consistent with the classifier's tiers); a
// service in the suggested category gets a small boost so classification and
// catalog agree. Returns null when nothing matches confidently — the reviewer
// then picks manually, exactly as today.
export function resolveService(
  env: IntakeEnvelope,
  suggestedCategorySlug: string | null,
  catalog: CatalogService[],
): ServiceMatch | null {
  if (!catalog.length) return null
  const subject = env.subject ?? ''
  const body = env.text ?? ''

  let best: CatalogService | null = null
  let bestScore = 0
  for (const svc of catalog) {
    if (!svc.keywords.length) continue
    const score = keywordHits(subject, svc.keywords) * 2
      + keywordHits(body, svc.keywords)
      + (suggestedCategorySlug && svc.categorySlug === suggestedCategorySlug ? 1 : 0)
    if (score > bestScore) { bestScore = score; best = svc }
  }

  // Require at least one real keyword hit (a lone category-boost of 1 isn't enough).
  if (!best || bestScore < 2) return null
  return { serviceId: best.id, categoryId: best.categoryId, teamId: best.teamId }
}
