'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type SearchResult = {
  id: string
  type: 'request' | 'task' | 'service' | 'user' | 'approval'
  title: string
  subtitle?: string
  href: string
  meta?: string
  badge?: string
}

export type GroupedSearchResults = {
  requests: SearchResult[]
  tasks: SearchResult[]
  services: SearchResult[]
  users: SearchResult[]
  approvals: SearchResult[]
}

export async function globalSearch(query: string): Promise<GroupedSearchResults> {
  const empty: GroupedSearchResults = { requests: [], tasks: [], services: [], users: [], approvals: [] }
  if (query.trim().length < 2) return empty

  const q = query.trim()
  const ql = q.toLowerCase()
  const like = `%${q}%`

  // Use admin client to bypass RLS — pages the user navigates to still enforce RLS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as unknown as { from: (t: string) => any }

  // ── 1. Profiles matching the query (for person-based lookups) ──────────────
  const { data: matchingProfiles } = await db
    .from('profiles')
    .select('id, full_name, role')
    .ilike('full_name', like)
    .limit(10)

  const profileIds: string[] = (matchingProfiles ?? []).map((p: any) => p.id)

  // ── 2. Requests ────────────────────────────────────────────────────────────
  // Run separate queries per searchable column, then merge + dedupe
  const [rByNo, rByTitle, rByDesc, rByRequester, rByAssignee] = await Promise.all([
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').ilike('request_no', like).limit(6),
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').ilike('title', like).limit(6),
    db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').ilike('description', like).limit(4),
    profileIds.length > 0
      ? db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').in('requester_id', profileIds).limit(4)
      : { data: [] },
    profileIds.length > 0
      ? db.from('requests').select('id,request_no,title,status,assigned_to,requester_id').in('assigned_to', profileIds).limit(4)
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
  const uniqueReqs = allRaw.filter((r: any) => { if (seenR.has(r.id)) return false; seenR.add(r.id); return true }).slice(0, 8)

  // Bulk-fetch names for requester/assignee IDs
  const personIds = [...new Set(uniqueReqs.flatMap((r: any) => [r.requester_id, r.assigned_to].filter(Boolean)))]
  const { data: nameRows } = personIds.length > 0
    ? await db.from('profiles').select('id, full_name').in('id', personIds)
    : { data: [] }
  const nameMap = new Map((nameRows ?? []).map((p: any) => [p.id, p.full_name]))

  const requests: SearchResult[] = uniqueReqs.map((r: any) => ({
    id: r.id,
    type: 'request' as const,
    title: r.title,
    subtitle: nameMap.get(r.assigned_to) ?? nameMap.get(r.requester_id),
    href: `/requests/${r.id}`,
    meta: r.status,
    badge: r.request_no,
  }))

  // ── 3. Tasks ───────────────────────────────────────────────────────────────
  const [tByTitle, tByDesc, tByAssignee, tByLinkedReqNo] = await Promise.all([
    db.from('tasks').select('id,title,status,assignee_id,request_id').ilike('title', like).limit(6),
    db.from('tasks').select('id,title,status,assignee_id,request_id').ilike('description', like).limit(4),
    profileIds.length > 0
      ? db.from('tasks').select('id,title,status,assignee_id,request_id').in('assignee_id', profileIds).limit(4)
      : { data: [] },
    // tasks linked to a request whose request_no matches
    db.from('requests').select('id,request_no').ilike('request_no', like).limit(8),
  ])

  // Get request IDs that match the number search, then find tasks linked to them
  const linkedReqIds = (tByLinkedReqNo.data ?? []).map((r: any) => r.id)
  const tByLinked = linkedReqIds.length > 0
    ? await db.from('tasks').select('id,title,status,assignee_id,request_id').in('request_id', linkedReqIds).limit(6)
    : { data: [] }

  const allTRaw = [
    ...(tByTitle.data ?? []),
    ...(tByDesc.data ?? []),
    ...(tByAssignee.data ?? []),
    ...(tByLinked.data ?? []),
  ]
  const seenT = new Set<string>()
  const uniqueTasks = allTRaw.filter((t: any) => { if (seenT.has(t.id)) return false; seenT.add(t.id); return true }).slice(0, 8)

  // Fetch assignee names + linked request_no
  const taskPersonIds = [...new Set(uniqueTasks.map((t: any) => t.assignee_id).filter(Boolean))]
  const taskReqIds = [...new Set(uniqueTasks.map((t: any) => t.request_id).filter(Boolean))]
  const [{ data: taskNames }, { data: taskReqs }] = await Promise.all([
    taskPersonIds.length > 0 ? db.from('profiles').select('id,full_name').in('id', taskPersonIds) : { data: [] },
    taskReqIds.length > 0 ? db.from('requests').select('id,request_no').in('id', taskReqIds) : { data: [] },
  ])
  const taskNameMap = new Map((taskNames ?? []).map((p: any) => [p.id, p.full_name]))
  const taskReqMap = new Map((taskReqs ?? []).map((r: any) => [r.id, r.request_no]))

  const tasks: SearchResult[] = uniqueTasks.map((t: any) => ({
    id: t.id,
    type: 'task' as const,
    title: t.title,
    subtitle: taskNameMap.get(t.assignee_id) ?? (t.request_id ? `${taskReqMap.get(t.request_id)}` : undefined),
    href: `/tasks/${t.id}`,
    meta: t.status,
  }))

  // ── 4. Services ────────────────────────────────────────────────────────────
  const { data: svcData } = await db
    .from('services')
    .select('id,name,slug,category_id')
    .or(`name.ilike.${like},description.ilike.${like}`)
    .eq('is_active', true)
    .limit(5)

  // Fetch category names
  const catIds = [...new Set((svcData ?? []).map((s: any) => s.category_id).filter(Boolean))]
  const { data: catData } = catIds.length > 0
    ? await db.from('service_categories').select('id,name').in('id', catIds)
    : { data: [] }
  const catMap = new Map((catData ?? []).map((c: any) => [c.id, c.name]))

  const services: SearchResult[] = (svcData ?? []).map((s: any) => ({
    id: s.id,
    type: 'service' as const,
    title: s.name,
    subtitle: catMap.get(s.category_id),
    href: `/services/${s.slug}`,
  }))

  // ── 5. People ──────────────────────────────────────────────────────────────
  const users: SearchResult[] = (matchingProfiles ?? []).slice(0, 5).map((p: any) => ({
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

  // Fetch request info for matched approvals
  const allReqIds = [...new Set((appData ?? []).map((a: any) => a.request_id).filter(Boolean))]
  const { data: appReqs } = allReqIds.length > 0
    ? await db.from('requests').select('id,request_no,title').in('id', allReqIds)
    : { data: [] }
  const appReqMap = new Map((appReqs ?? []).map((r: any) => [r.id, r]))

  const approvals: SearchResult[] = (appData ?? [])
    .map((a: any) => ({ a, req: appReqMap.get(a.request_id) }))
    .filter(({ a, req }: any) =>
      req?.title?.toLowerCase().includes(ql) ||
      req?.request_no?.toLowerCase().includes(ql) ||
      a.status?.toLowerCase().includes(ql)
    )
    .slice(0, 5)
    .map(({ a, req }: any) => ({
      id: a.id,
      type: 'approval' as const,
      title: req?.title ?? 'Approval',
      subtitle: req?.request_no,
      href: `/approvals/${a.id}`,
      meta: a.status,
    }))

  return { requests, tasks, services, users, approvals }
}
