import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { IntakeRulesClient } from './IntakeRulesClient'
import type { IntakeRule } from '@/lib/actions/intake/rules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export default async function IntakeRulesPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/intake')

  // RLS-scoped reads (org's own data only). intake_rules isn't in the generated
  // Database type yet, so the client is cast — same pattern as the intake actions.
  const supabase = (await createClient()) as unknown as AnyClient
  const [rulesRes, deptRes, catRes, svcRes, prioRes] = await Promise.all([
    supabase.from('intake_rules')
      .select('id, name, enabled, match_field, match_keywords, match_regex, output_type, output_department, output_category, output_subcategory, output_priority, weight')
      .order('enabled', { ascending: false }).order('weight', { ascending: false }),
    supabase.from('departments').select('name').order('name'),
    supabase.from('service_categories').select('id, slug, name').eq('is_active', true).order('sort_order'),
    supabase.from('services').select('slug, name, category_id').eq('is_active', true).order('sort_order'),
    supabase.from('request_priorities').select('value, name').eq('is_active', true).order('display_order'),
  ])

  // service_categories.slug is what we store for category; map category id → slug
  // so subcategory (service) options can be scoped to the chosen category.
  const catSlugById: Record<string, string> = {}
  for (const c of (catRes.data ?? []) as { id: string; slug: string; name: string }[]) catSlugById[c.id] = c.slug

  const master = {
    departments: ((deptRes.data ?? []) as { name: string }[]).map((d) => d.name),
    categories: ((catRes.data ?? []) as { slug: string; name: string }[]).map((c) => ({ value: c.slug, label: c.name })),
    subcategories: ((svcRes.data ?? []) as { slug: string; name: string; category_id: string }[])
      .map((s) => ({ value: s.slug, label: s.name, categorySlug: catSlugById[s.category_id] ?? null })),
    priorities: ((prioRes.data ?? []) as { value: string; name: string }[]).map((p) => ({ value: p.value, label: p.name })),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intake Rules"
        description="Your own classification rules. They run before the built-in rules and take precedence — a matching rule decides the outcome it sets."
      />
      <IntakeRulesClient initialRules={(rulesRes.data as IntakeRule[]) ?? []} master={master} />
    </div>
  )
}
