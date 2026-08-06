'use server'
import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export async function resolveAssignee(opts: {
  serviceId: string
  categoryId?: string | null
  subCategoryId?: string | null
  priority?: string | null
}): Promise<string | null> {
  const db = createAdminClient() as unknown as AnyClient

  const scopeIds = [opts.serviceId, opts.subCategoryId, opts.categoryId].filter(Boolean) as string[]

  const { data: rules, error } = await db
    .from('assignment_rules')
    .select('*')
    .eq('is_active', true)
    .in('scope_id', scopeIds)

  if (error || !rules || rules.length === 0) return null

  // Filter by priority_filter
  const filtered = rules.filter(
    (r: AnyClient) => r.priority_filter === null || r.priority_filter === opts.priority
  )

  if (filtered.length === 0) return null

  // Apply precedence: service > sub_category > category
  const precedence: Record<string, number> = { service: 0, sub_category: 1, category: 2 }
  filtered.sort((a: AnyClient, b: AnyClient) => precedence[a.scope_type] - precedence[b.scope_type])

  // Among same scope_type, prefer the one matching the most specific scope_id
  const rule = filtered[0]

  if (!rule.assignee_ids || rule.assignee_ids.length === 0) return null

  if (rule.strategy === 'direct') {
    return rule.assignee_ids[0] ?? null
  }

  if (rule.strategy === 'round_robin') {
    const index = rule.last_assigned_index % rule.assignee_ids.length
    const chosen = rule.assignee_ids[index]
    const nextIndex = (index + 1) % rule.assignee_ids.length
    await db
      .from('assignment_rules')
      .update({ last_assigned_index: nextIndex })
      .eq('id', rule.id)
    return chosen
  }

  if (rule.strategy === 'load_balanced') {
    if (!rule.assignee_ids || rule.assignee_ids.length === 0) return null

    const counts = await Promise.all(
      rule.assignee_ids.map(async (id: string) => {
        const { count } = await db
          .from('requests')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', id)
          .not('status', 'in', '("resolved","cancelled","closed")')
        return { id, count: count ?? 0 }
      })
    )

    counts.sort((a: { count: number }, b: { count: number }) => a.count - b.count)
    return counts[0]?.id ?? null
  }

  return null
}
