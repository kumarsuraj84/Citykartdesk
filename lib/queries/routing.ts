import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type AssignmentRule = {
  id: string
  name: string
  scope_type: 'service' | 'sub_category' | 'category'
  scope_id: string
  scope_label: string
  strategy: 'direct' | 'round_robin' | 'load_balanced'
  assignee_ids: string[]
  assignee_names: string[]
  priority_filter: string | null
  is_active: boolean
  created_at: string
}

export async function getAssignmentRules(orgId?: string): Promise<AssignmentRule[]> {
  const admin = createAdminClient() as unknown as AnyClient

  let rulesQuery = admin
    .from('assignment_rules')
    .select('*')
    .order('scope_type', { ascending: true })
    .order('created_at', { ascending: true })
  if (orgId) rulesQuery = rulesQuery.eq('org_id', orgId)

  const { data: rules, error } = await rulesQuery

  if (error || !rules || rules.length === 0) return []

  // Collect unique scope ids split by type
  const serviceIds: string[] = []
  const categoryIds: string[] = []
  const allAssigneeIds: string[] = []

  for (const rule of rules) {
    if (rule.scope_type === 'service') {
      serviceIds.push(rule.scope_id)
    } else {
      categoryIds.push(rule.scope_id)
    }
    if (Array.isArray(rule.assignee_ids)) {
      allAssigneeIds.push(...rule.assignee_ids)
    }
  }

  const uniqueServiceIds = [...new Set(serviceIds)]
  const uniqueCategoryIds = [...new Set(categoryIds)]
  const uniqueAssigneeIds = [...new Set(allAssigneeIds)]

  // Batch fetch in parallel
  const [servicesResult, categoriesResult, profilesResult] = await Promise.all([
    uniqueServiceIds.length > 0
      ? admin.from('services').select('id, name').in('id', uniqueServiceIds)
      : Promise.resolve({ data: [] }),
    uniqueCategoryIds.length > 0
      ? admin.from('service_categories').select('id, name').in('id', uniqueCategoryIds)
      : Promise.resolve({ data: [] }),
    uniqueAssigneeIds.length > 0
      ? admin.from('profiles').select('id, full_name').in('id', uniqueAssigneeIds)
      : Promise.resolve({ data: [] }),
  ])

  const serviceMap = new Map<string, string>(
    (servicesResult.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name])
  )
  const categoryMap = new Map<string, string>(
    (categoriesResult.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name])
  )
  const profileMap = new Map<string, string>(
    (profilesResult.data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])
  )

  return rules.map((rule: {
    id: string
    name: string
    scope_type: 'service' | 'sub_category' | 'category'
    scope_id: string
    strategy: 'direct' | 'round_robin' | 'load_balanced'
    assignee_ids: string[]
    priority_filter: string | null
    is_active: boolean
    created_at: string
  }): AssignmentRule => {
    const scopeLabel =
      rule.scope_type === 'service'
        ? (serviceMap.get(rule.scope_id) ?? rule.scope_id)
        : (categoryMap.get(rule.scope_id) ?? rule.scope_id)

    const assigneeNames = (rule.assignee_ids ?? []).map(
      (id: string) => profileMap.get(id) ?? id
    )

    return {
      id: rule.id,
      name: rule.name,
      scope_type: rule.scope_type,
      scope_id: rule.scope_id,
      scope_label: scopeLabel,
      strategy: rule.strategy,
      assignee_ids: rule.assignee_ids ?? [],
      assignee_names: assigneeNames,
      priority_filter: rule.priority_filter,
      is_active: rule.is_active,
      created_at: rule.created_at,
    }
  })
}
