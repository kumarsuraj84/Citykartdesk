'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

export type SearchResult = {
  id: string
  type: 'request' | 'task' | 'project' | 'service' | 'user' | 'approval'
  title: string
  subtitle?: string
  href: string
  meta?: string
  badge?: string
}

export type GroupedSearchResults = {
  requests: SearchResult[]
  tasks: SearchResult[]
  projects: SearchResult[]
  services: SearchResult[]
  users: SearchResult[]
  approvals: SearchResult[]
}

export async function globalSearch(query: string): Promise<GroupedSearchResults> {
  const empty: GroupedSearchResults = { requests: [], tasks: [], projects: [], services: [], users: [], approvals: [] }
  if (query.trim().length < 2) return empty

  const profile = await getCurrentProfile()
  if (!profile || !profile.org_id) return empty
  const orgId = profile.org_id

  const q = query.trim()
  const ql = q.toLowerCase()
  const like = `%${q}%`

  // RLS-scoped client, NOT the admin client — search results must never surface
  // a request/task/project/approval the viewer isn't otherwise allowed to see.
  // The explicit .eq('org_id', orgId) filters below are kept as defense-in-depth
  // (RLS already enforces org scoping) but the real per-row visibility (owner/
  // requester/assignee/team/collaborator/member) now comes entirely from RLS,
  // so it can never drift out of sync with the list pages' own visibility rules.
  const db = await createClient()

  // ── 1. Profiles matching the query (for person-based lookups) ──────────────
  const { data: matchingProfiles } = await db
    .from('profiles')
    .select('id, full_name, role')
    .eq('org_id', orgId)
    .ilike('full_name', like)
    .limit(10)

  const profileIds: string[] = (matchingProfiles ?? []).map((p) => p.id)

  // ── 2. Requests ────────────────────────────────────────────────────────────
  // Run separate queries per searchable column, then merge + dedupe
  const [rByNo, rByTitle, rByDesc, rByRequester, rByAssignee] = await Promise.all([
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').eq('org_id', orgId).ilike('request_no', like).limit(6),
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').eq('org_id', orgId).ilike('title', like).limit(6),
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').eq('org_id', orgId).ilike('description', like).limit(4),
    profileIds.length > 0
      ? db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').eq('org_id', orgId).in('requester_id', profileIds).limit(4)
      : { data: [] },
    profileIds.length > 0
      ? db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').eq('org_id', orgId).in('assigned_to', profileIds).limit(4)
      : { data: [] },
  ])

  // Fetch assignee/requester names for the merged set
  const allRaw = [
    ...(rByNo.data ?? []),
    ...(rByTitle.data ?? []),
    ...(rByDesc.data ?? []),
    ...(rByRequester.data ?? []),
    ...(rByAssignee.data ?? []),
  ]
  const seenR = new Set<string>()
  const uniqueReqs = allRaw.filter((r) => { if (seenR.has(r.id)) return false; seenR.add(r.id); return true }).slice(0, 8)

  // Bulk-fetch names for requester/assignee IDs
  const personIds = [...new Set(uniqueReqs.flatMap((r) => [r.requester_id, r.assigned_to].filter((id): id is string => Boolean(id))))]
  const { data: nameRows } = personIds.length > 0
    ? await db.from('profiles').select('id, full_name').in('id', personIds)
    : { data: [] }
  const nameMap = new Map<string, string>((nameRows ?? []).map((p) => [p.id, p.full_name]))

  const requests: SearchResult[] = uniqueReqs.map((r) => ({
    id: r.id,
    type: 'request' as const,
    title: r.title,
    subtitle: (r.assigned_to ? nameMap.get(r.assigned_to) : undefined) ?? nameMap.get(r.requester_id),
    href: `/requests/${r.id}`,
    meta: r.status,
    badge: r.request_no,
  }))

  // ── 3. Tasks ───────────────────────────────────────────────────────────────
  const [tByTitle, tByDesc, tByAssignee, tByLinkedReqNo] = await Promise.all([
    db.from('tasks').select('id,title,status,assignee_id,request_id').eq('org_id', orgId).ilike('title', like).limit(6),
    db.from('tasks').select('id,title,status,assignee_id,request_id').eq('org_id', orgId).ilike('description', like).limit(4),
    profileIds.length > 0
      ? db.from('tasks').select('id,title,status,assignee_id,request_id').eq('org_id', orgId).in('assignee_id', profileIds).limit(4)
      : { data: [] },
    // tasks linked to a request whose request_no matches
    db.from('requests').select('id,request_no').eq('org_id', orgId).ilike('request_no', like).limit(8),
  ])

  // Get request IDs that match the number search, then find tasks linked to them
  const linkedReqIds = (tByLinkedReqNo.data ?? []).map((r) => r.id)
  const tByLinked = linkedReqIds.length > 0
    ? await db.from('tasks').select('id,title,status,assignee_id,request_id').eq('org_id', orgId).in('request_id', linkedReqIds).limit(6)
    : { data: [] }

  const allTRaw = [
    ...(tByTitle.data ?? []),
    ...(tByDesc.data ?? []),
    ...(tByAssignee.data ?? []),
    ...(tByLinked.data ?? []),
  ]
  const seenT = new Set<string>()
  const uniqueTasks = allTRaw.filter((t) => { if (seenT.has(t.id)) return false; seenT.add(t.id); return true }).slice(0, 8)

  // Fetch assignee names + linked request_no
  const taskPersonIds = [...new Set(uniqueTasks.map((t) => t.assignee_id).filter((id): id is string => Boolean(id)))]
  const taskReqIds = [...new Set(uniqueTasks.map((t) => t.request_id).filter((id): id is string => Boolean(id)))]
  const [{ data: taskNames }, { data: taskReqs }] = await Promise.all([
    taskPersonIds.length > 0 ? db.from('profiles').select('id,full_name').in('id', taskPersonIds) : { data: [] },
    taskReqIds.length > 0 ? db.from('requests').select('id,request_no').in('id', taskReqIds) : { data: [] },
  ])
  const taskNameMap = new Map<string, string>((taskNames ?? []).map((p) => [p.id, p.full_name]))
  const taskReqMap = new Map<string, string>((taskReqs ?? []).map((r) => [r.id, r.request_no]))

  const tasks: SearchResult[] = uniqueTasks.map((t) => ({
    id: t.id,
    type: 'task' as const,
    title: t.title,
    subtitle: (t.assignee_id ? taskNameMap.get(t.assignee_id) : undefined) ?? (t.request_id ? taskReqMap.get(t.request_id) : undefined),
    href: `/tasks/${t.id}`,
    meta: t.status,
  }))

  // ── 3b. Projects — matches the project itself (name/description/owner) as
  // well as content nested inside it (milestone names, narrative status
  // updates + blockers), so a hit deep inside a project still surfaces the
  // project as the navigable result. ────────────────────────────────────────
  const [pByName, pByDesc, pByOwner, pByMilestone, pByUpdate] = await Promise.all([
    db.from('projects').select('id,name,status,priority,owner_id,functional_owner_id').eq('org_id', orgId).is('archived_at', null).ilike('name', like).limit(6),
    db.from('projects').select('id,name,status,priority,owner_id,functional_owner_id').eq('org_id', orgId).is('archived_at', null).ilike('description', like).limit(4),
    profileIds.length > 0
      ? db.from('projects').select('id,name,status,priority,owner_id,functional_owner_id').eq('org_id', orgId).is('archived_at', null).or(`owner_id.in.(${profileIds.join(',')}),functional_owner_id.in.(${profileIds.join(',')})`).limit(4)
      : { data: [] },
    db.from('milestones').select('id,project_id').eq('org_id', orgId).ilike('name', like).limit(6),
    db.from('project_updates').select('id,project_id').eq('org_id', orgId).or(`update_text.ilike.${like},blockers.ilike.${like}`).limit(6),
  ])

  // Milestone/update hits resolve to their parent project.
  const nestedProjectIds = [...new Set([
    ...(pByMilestone.data ?? []).map((m) => m.project_id),
    ...(pByUpdate.data ?? []).map((u) => u.project_id),
  ])]
  const { data: nestedProjects } = nestedProjectIds.length > 0
    ? await db.from('projects').select('id,name,status,priority,owner_id,functional_owner_id').eq('org_id', orgId).is('archived_at', null).in('id', nestedProjectIds)
    : { data: [] }

  const allPRaw = [
    ...(pByName.data ?? []),
    ...(pByDesc.data ?? []),
    ...(pByOwner.data ?? []),
    ...(nestedProjects ?? []),
  ]
  const seenP = new Set<string>()
  const uniqueProjects = allPRaw.filter((p) => { if (seenP.has(p.id)) return false; seenP.add(p.id); return true }).slice(0, 8)

  const projPersonIds = [...new Set(uniqueProjects.flatMap((p) => [p.owner_id, p.functional_owner_id].filter((id): id is string => Boolean(id))))]
  const { data: projNames } = projPersonIds.length > 0
    ? await db.from('profiles').select('id,full_name').in('id', projPersonIds)
    : { data: [] }
  const projNameMap = new Map<string, string>((projNames ?? []).map((p) => [p.id, p.full_name]))

  const projects: SearchResult[] = uniqueProjects.map((p) => ({
    id: p.id,
    type: 'project' as const,
    title: p.name,
    subtitle: (p.owner_id ? projNameMap.get(p.owner_id) : undefined) ?? (p.functional_owner_id ? projNameMap.get(p.functional_owner_id) : undefined),
    href: `/projects/${p.id}`,
    meta: p.status,
    badge: p.priority,
  }))

  // ── 4. Services ────────────────────────────────────────────────────────────
  // A service is a flat catalog entry now (no fixed category to show as a
  // subtitle — category is a per-submission field, not a service property).
  const { data: svcData } = await db
    .from('services')
    .select('id,name,slug,description')
    .eq('org_id', orgId)
    .or(`name.ilike.${like},description.ilike.${like}`)
    .eq('is_active', true)
    .limit(5)

  const services: SearchResult[] = (svcData ?? []).map((s) => ({
    id: s.id,
    type: 'service' as const,
    title: s.name,
    subtitle: s.description ?? undefined,
    href: `/services/${s.slug}`,
  }))

  // ── 5. People ──────────────────────────────────────────────────────────────
  const users: SearchResult[] = (matchingProfiles ?? []).slice(0, 5).map((p) => ({
    id: p.id,
    type: 'user' as const,
    title: p.full_name,
    href: `/admin/users`,
    meta: p.role,
  }))

  // ── 6. Approvals ───────────────────────────────────────────────────────────
  const { data: appData } = await db
    .from('approvals')
    .select('id,status,request_id')
    .limit(50)

  // Fetch request info for matched approvals — org-scoped here since
  // `approvals` itself has no org_id column, only a request_id FK.
  const allReqIds = [...new Set((appData ?? []).map((a) => a.request_id).filter(Boolean))]
  const { data: appReqs } = allReqIds.length > 0
    ? await db.from('requests').select('id,request_no,title').eq('org_id', orgId).in('id', allReqIds)
    : { data: [] }
  const appReqMap = new Map((appReqs ?? []).map((r) => [r.id, r]))

  const approvals: SearchResult[] = (appData ?? [])
    .filter((a) => appReqMap.has(a.request_id))
    .map((a) => ({ a, req: appReqMap.get(a.request_id) }))
    .filter(({ a, req }) =>
      req?.title?.toLowerCase().includes(ql) ||
      req?.request_no?.toLowerCase().includes(ql) ||
      a.status?.toLowerCase().includes(ql)
    )
    .slice(0, 5)
    .map(({ a, req }) => ({
      id: a.id,
      type: 'approval' as const,
      title: req?.title ?? 'Approval',
      subtitle: req?.request_no,
      href: `/approvals/${a.id}`,
      meta: a.status,
    }))

  return { requests, tasks, projects, services, users, approvals }
}
