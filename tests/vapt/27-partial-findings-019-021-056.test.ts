// The three findings that were only partly fixed: 019 who can see whom, 021 file store reads, 056 reason for re-classifying.
// Real signed-in users, real HTTP to the data API and the file store, real server actions. Synthetic data on the isolated stack.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, getAdmin, seedRequestLike, createTestUser, type D03Fixtures } from '../setup/fixtures-d03'
import { http } from '../remediation/helpers'

process.env.SYSTEM_LOG_IN_TESTS = '1'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue({ get: () => null }), cookies: vi.fn().mockResolvedValue({ get: () => undefined, getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestCategory } from '@/lib/actions/requests'
import { searchUsersForDelegation } from '@/lib/actions/approvals'
import { getRequestActivity } from '@/lib/queries/requests'

vi.setConfig({ testTimeout: 180_000 })
let fx: D03Fixtures
const admin = () => getAdmin()
const API = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const tag = `p27-${Date.now()}`
const actAs = (u: { accessToken: string }) => vi.mocked(createClient).mockResolvedValue(clientForToken(u.accessToken) as never)
const created = { orgs: [] as string[], users: [] as string[], paths: [] as string[], rows: [] as string[], cats: [] as string[], subs: [] as string[], reqs: [] as string[] }

const storageGet = (path: string, token: string) => fetch(`${API}/storage/v1/object/authenticated/request-attachments/${path}`, { headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } })
async function putFile(path: string, body = 'secret-contents') {
  const r = await fetch(`${API}/storage/v1/object/request-attachments/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'text/plain', 'x-upsert': 'true' }, body })
  expect(r.status, 'upload by the server').toBeLessThan(300)
  created.paths.push(path)
}

beforeAll(async () => { fx = await setupD03Fixtures() }, 240_000)
afterAll(async () => {
  if (created.paths.length) await fetch(`${API}/storage/v1/object/request-attachments`, { method: 'DELETE', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: created.paths }) })
  if (created.rows.length) await admin().from('request_attachments').delete().in('id', created.rows)
  if (created.reqs.length) { await admin().from('request_activity').delete().in('request_id', created.reqs); await admin().from('requests').delete().in('id', created.reqs) }
  if (created.subs.length) { await admin().from('service_sub_category_tags').delete().in('sub_category_id', created.subs); await admin().from('service_sub_categories').delete().in('id', created.subs) }
  if (created.cats.length) await admin().from('service_categories').delete().in('id', created.cats)
  for (const id of created.users) { try { await admin().auth.admin.deleteUser(id) } catch { /* best effort */ } }
  for (const id of created.orgs) await admin().rpc('owner_delete_org', { p_org_id: id })
  await fx?.cleanup()
}, 120_000)

describe('VAPT-019: an ordinary user sees only the people they deal with', () => {
  const listNames = async (token: string) => ((await http<{ id: string }[]>('GET', '/rest/v1/profiles?select=id&limit=1000', { token })).json ?? []).map((r) => r.id)

  it('a requester cannot list the staff: they see themself and the people on their own tickets', async () => {
    // a ticket of requester A handled by technician A, so technician A is "known" to requester A
    const ids = await listNames(fx.requesterA.accessToken)
    expect(ids).toContain(fx.requesterA.id)
    expect(ids).toContain(fx.agentA.id)                                 // assigned to their ticket (seeded by the fixtures)
    for (const stranger of [fx.agentB.id, fx.manager.id, fx.admin.id, fx.platformOwner.id, fx.requesterB.id]) expect(ids, stranger).not.toContain(stranger)
    expect(ids.length).toBeLessThan(10)
  })
  it('a ticket page still shows the requester the name of who handles it (the joins keep working)', async () => {
    const r = await http<{ assignee: { full_name: string } | null }[]>('GET', `/rest/v1/requests?select=id,assignee:profiles!requests_assigned_to_fkey(full_name)&id=eq.${fx.requestA.id}`, { token: fx.requesterA.accessToken })
    expect(r.json[0]?.assignee?.full_name).toBeTruthy()
  })
  it('a new person who joins a ticket becomes visible, and stops being visible when the ticket is theirs no longer', async () => {
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentB.id, status: 'in_progress' })
    created.reqs.push(t.id)
    expect(await listNames(fx.requesterA.accessToken)).toContain(fx.agentB.id)
    await admin().from('requests').update({ assigned_to: fx.agentA.id }).eq('id', t.id)
    expect(await listNames(fx.requesterA.accessToken)).not.toContain(fx.agentB.id)
  })
  it('staff (technician, manager, administrator) still see everybody in the organisation, and nobody sees another organisation', async () => {
    for (const who of [fx.agentA, fx.manager, fx.admin]) {
      const ids = await listNames(who.accessToken)
      expect(ids, who.email).toEqual(expect.arrayContaining([fx.requesterA.id, fx.requesterB.id, fx.agentB.id, fx.manager.id]))
    }
    const org = await admin().from('organizations').insert({ name: `${tag} Org X`, slug: `${tag}-x`, status: 'active', seat_limit: 3 } as never).select('id').single()
    created.orgs.push(org.data!.id)
    const outsider = await createTestUser('p27-outsider', 'P27 Outsider'); created.users.push(outsider.id)
    await admin().from('profiles').update({ org_id: org.data!.id }).eq('id', outsider.id)
    expect(await listNames(fx.admin.accessToken)).not.toContain(outsider.id)
    expect(await listNames(fx.requesterA.accessToken)).not.toContain(outsider.id)
  })
  it('the activity history of a ticket still names the people to the requester (names through the server view)', async () => {
    await admin().from('request_activity').insert({ request_id: fx.requestA.id, actor_id: fx.agentA.id, action: 'comment_added', metadata: {} })
    actAs(fx.requesterA)
    const rows = await getRequestActivity(fx.requestA.id)
    expect(rows.some((r) => r.actor?.full_name)).toBe(true)
  })
  it('the approval-delegation search is not a way for an ordinary user to list the staff', async () => {
    actAs(fx.requesterA)
    expect(await searchUsersForDelegation('D03')).toEqual([])
    actAs(fx.agentA)
    expect((await searchUsersForDelegation('D03')).length).toBeGreaterThan(0)
  })
})

describe('VAPT-021: files in the file store', () => {
  let reqB: string, pathB: string, pathBInternal: string

  beforeAll(async () => {
    reqB = fx.requestB.id                                               // requester B's ticket, group B
    pathB = `${reqB}/${tag}-public.txt`
    pathBInternal = `${reqB}/${tag}-internal.txt`
    await putFile(pathB); await putFile(pathBInternal, 'internal-only')
    const rows = await admin().from('request_attachments').insert([
      { request_id: reqB, uploaded_by: fx.agentB.id, file_name: 'public.txt', file_size: 15, mime_type: 'text/plain', storage_path: pathB, is_internal: false },
      { request_id: reqB, uploaded_by: fx.agentB.id, file_name: 'internal.txt', file_size: 13, mime_type: 'text/plain', storage_path: pathBInternal, is_internal: true },
    ]).select('id')
    for (const r of rows.data ?? []) created.rows.push(r.id)
  }, 120_000)

  it('the owner and their group read the file; a stranger, another group and another organisation do not', async () => {
    expect((await storageGet(pathB, fx.requesterB.accessToken)).status).toBe(200)
    expect((await storageGet(pathB, fx.agentB.accessToken)).status).toBe(200)
    expect((await storageGet(pathB, fx.manager.accessToken)).status).toBe(200)
    expect((await storageGet(pathB, fx.requesterA.accessToken)).status).toBeGreaterThanOrEqual(400)    // requester A vs requester B
    expect((await storageGet(pathB, fx.agentA.accessToken)).status).toBeGreaterThanOrEqual(400)        // technician of another group
    const outsider = await createTestUser('p27-out2', 'P27 Outsider 2'); created.users.push(outsider.id)
    const org = await admin().from('organizations').insert({ name: `${tag} Org Y`, slug: `${tag}-y`, status: 'active', seat_limit: 3 } as never).select('id').single()
    created.orgs.push(org.data!.id)
    await admin().from('profiles').update({ org_id: org.data!.id, role: 'admin' }).eq('id', outsider.id)
    expect((await storageGet(pathB, outsider.accessToken)).status).toBeGreaterThanOrEqual(400)         // an administrator of another organisation
  })
  it('an internal file is hidden from the requester, and visible to the group', async () => {
    expect((await storageGet(pathBInternal, fx.requesterB.accessToken)).status).toBeGreaterThanOrEqual(400)
    expect((await storageGet(pathBInternal, fx.agentB.accessToken)).status).toBe(200)
  })
  it('FORGED REFERENCE: a row on my own ticket that points at another ticket\'s file opens nothing, and cannot even be created through the data API', async () => {
    const forged = await http('POST', '/rest/v1/request_attachments', { token: fx.requesterA.accessToken, body: { request_id: fx.requestA.id, uploaded_by: fx.requesterA.id, file_name: 'x.txt', file_size: 1, mime_type: 'text/plain', storage_path: pathB }, headers: { Prefer: 'return=representation' } })
    expect(forged.status).toBeGreaterThanOrEqual(400)
    // (a path can have only one attachment row, so a second row cannot point at a file that already has one) but a file that has NO row yet could be
    // claimed by a row made before the rule existed - here created by the server on requester A's own ticket. It must still open nothing.
    const orphan = `${reqB}/${tag}-orphan.txt`
    await putFile(orphan, 'orphan-contents')
    const legacy = await admin().from('request_attachments').insert({ request_id: fx.requestA.id, uploaded_by: fx.requesterA.id, file_name: 'x.txt', file_size: 1, mime_type: 'text/plain', storage_path: orphan }).select('id').single()
    expect(legacy.error?.message).toBeUndefined()
    created.rows.push(legacy.data!.id)
    expect((await storageGet(orphan, fx.requesterA.accessToken)).status).toBeGreaterThanOrEqual(400)
    expect((await storageGet(pathB, fx.requesterA.accessToken)).status).toBeGreaterThanOrEqual(400)
    expect((await storageGet(pathBInternal, fx.requesterA.accessToken)).status).toBeGreaterThanOrEqual(400)
  })
  it('a row for my own ticket with the proper path can still be created (normal uploads keep working)', async () => {
    const path = `${fx.requestA.id}/${tag}-own.txt`
    await putFile(path)
    const ok = await http('POST', '/rest/v1/request_attachments', { token: fx.requesterA.accessToken, body: { request_id: fx.requestA.id, uploaded_by: fx.requesterA.id, file_name: 'own.txt', file_size: 15, mime_type: 'text/plain', storage_path: path }, headers: { Prefer: 'return=representation' } })
    expect(ok.status).toBeLessThan(300)
    const id = (ok.json as { id: string }[])[0]?.id; if (id) created.rows.push(id)
    expect((await storageGet(path, fx.requesterA.accessToken)).status).toBe(200)
    expect((await storageGet(path, fx.requesterB.accessToken)).status).toBeGreaterThanOrEqual(400)
  })
  it('task files: nobody can forge a record, so nobody can read a task file they should not', async () => {
    const forged = await http('POST', '/rest/v1/task_attachments', { token: fx.agentA.accessToken, body: { task_id: fx.taskA.id, uploaded_by: fx.agentA.id, file_name: 'f', file_size: 1, mime_type: 'text/plain', storage_path: `${fx.taskB.id}/x.txt` } })
    expect(forged.status).toBeGreaterThanOrEqual(400)
  })
})

describe('VAPT-056: re-classifying needs a reason', () => {
  let catId: string, subA: string, subB: string, ticket: string
  beforeAll(async () => {
    const cat = await admin().from('service_categories').insert({ org_id: fx.orgId, name: `${tag} cat`, slug: `${tag}-cat` }).select('id').single()
    catId = cat.data!.id; created.cats.push(catId)
    const subs = await admin().from('service_sub_categories').insert([
      { category_id: catId, name: `${tag} Laptop`, slug: `${tag}-laptop`, sla_priority: 'low' },
      { category_id: catId, name: `${tag} Server`, slug: `${tag}-server`, sla_priority: 'urgent' },
    ] as never).select('id, slug')
    subA = subs.data!.find((s) => s.slug.endsWith('laptop'))!.id; subB = subs.data!.find((s) => s.slug.endsWith('server'))!.id
    created.subs.push(subA, subB)
    await admin().from('service_sub_category_tags').insert([{ service_id: fx.teamA.serviceId, sub_category_id: subA }, { service_id: fx.teamA.serviceId, sub_category_id: subB }])
    const t = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'assigned' })
    ticket = t.id; created.reqs.push(ticket)
    await admin().from('requests').update({ category_id: catId, sub_category_id: subA }).eq('id', ticket)
  }, 120_000)

  it('without a real reason nothing changes', async () => {
    actAs(fx.agentA)
    for (const bad of ['', '   ', 'short', 'x'.repeat(501)]) expect((await updateRequestCategory(ticket, subB, bad)).error, JSON.stringify(bad.slice(0, 12))).toBeTruthy()
    // (a call without the third argument at all, as an old client might make)
    expect((await (updateRequestCategory as unknown as (a: string, b: string) => Promise<{ error?: string }>)(ticket, subB)).error).toBeTruthy()
    const { data } = await admin().from('requests').select('sub_category_id, priority').eq('id', ticket).single()
    expect(data?.sub_category_id).toBe(subA)
  })
  it('with a reason it works: the reason, the old and new deadlines and the old and new sub-category go into the history; priority follows the sub-category', async () => {
    actAs(fx.agentA)
    const res = await updateRequestCategory(ticket, subB, 'The requester described a server outage, not a laptop fault')
    expect(res.error).toBeUndefined()
    const { data } = await admin().from('requests').select('sub_category_id, priority, status, assigned_to').eq('id', ticket).single()
    expect(data?.sub_category_id).toBe(subB)
    expect(data?.priority).toBe('urgent')                                  // from the sub-category's SLA tier, never typed by hand
    expect(data?.status).toBe('open')                                      // an "assigned" ticket that loses its owner goes back to open
    const act = (await admin().from('request_activity').select('metadata').eq('request_id', ticket).eq('action', 'reclassified').order('created_at', { ascending: false }).limit(1)).data?.[0]?.metadata as Record<string, unknown>
    expect(act.reason).toMatch(/server outage/)
    expect(act.sub_category_from).toBe(subA)
    expect(act).toHaveProperty('resolution_due_from')
    expect(act).toHaveProperty('resolution_due_to')
  })
  it('the reason is internal: the requester\'s history view does not carry it', async () => {
    actAs(fx.requesterA)
    const rows = await getRequestActivity(ticket)
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/server outage/)
  })
  it('a finished ticket, or a requester, is still refused (the earlier rules stand)', async () => {
    const done = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'resolved' })
    created.reqs.push(done.id)
    actAs(fx.agentA)
    expect((await updateRequestCategory(done.id, subA, 'A perfectly good reason here')).error).toMatch(/cannot be re-classified/)
    actAs(fx.requesterA)
    expect((await updateRequestCategory(ticket, subA, 'A perfectly good reason here')).error).toBeTruthy()
  })
})
