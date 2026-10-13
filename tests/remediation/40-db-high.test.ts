// Audit findings D-004, D-006, D-008, D-010 (database part), D-014, D-015, D-054 (High, database).
// NEGATIVE: the audited behaviour is refused. POSITIVE: the legitimate paths still work. Synthetic users only, audit stack only.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { anon, asUser, svc, http, login, ORG_A, SERVICE, type Session } from './helpers'

let staff1: Session, staff2: Session, agent1: Session, agent2: Session, manager: Session, admin: Session
let staff1Ticket = ''
const tag = Date.now()
const cleanup: (() => Promise<unknown>)[] = []
const teamOf = async (userId: string) => ((await svc<{ team_id: string }[]>('GET', `/team_members?user_id=eq.${userId}&select=team_id&limit=1`)).json[0]?.team_id)

beforeAll(async () => {
  ;[staff1, staff2, agent1, agent2, manager, admin] = await Promise.all(['staff1', 'staff2', 'agent1', 'agent2', 'manager1', 'admin1'].map((n) => login(`${n}@audit.test`)))
  // staff1 gets one ticket of their own for these tests (created by the server, removed afterwards)
  const s = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
  staff1Ticket = (await svc<{ id: string }[]>('POST', '/requests', { title: `fixture ${tag}`, requester_id: staff1.id, service_id: s.id, team_id: s.team_id, org_id: ORG_A, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
  cleanup.push(() => svc('DELETE', `/requests?id=eq.${staff1Ticket}`))
})
afterAll(async () => { for (const f of cleanup.reverse()) await f().catch(() => {}) })

async function ticketOf(_requester: Session) {
  return staff1Ticket
}

describe('D-004 storage: no one can write into, or read from, another request\'s attachment folder', () => {
  it('an unrelated requester cannot upload into another request folder (original attack)', async () => {
    const rid = await ticketOf(staff1)
    const path = `${rid}/planted-${tag}.txt`
    cleanup.push(() => http('DELETE', '/storage/v1/object/request-attachments', { key: SERVICE, token: SERVICE, body: { prefixes: [path] } }))
    const r = await http('POST', `/storage/v1/object/request-attachments/${path}`, { token: staff2.token, body: 'planted', headers: { 'Content-Type': 'text/plain' } })
    expect(r.status).toBeGreaterThanOrEqual(400)
  })
  it('an unrelated requester cannot download or list another request\'s files', async () => {
    const rid = await ticketOf(staff1)
    const path = `${rid}/secret-${tag}.txt`
    await http('POST', `/storage/v1/object/request-attachments/${path}`, { key: SERVICE, token: SERVICE, body: 'secret', headers: { 'Content-Type': 'text/plain' } })
    cleanup.push(() => http('DELETE', '/storage/v1/object/request-attachments', { key: SERVICE, token: SERVICE, body: { prefixes: [path] } }))
    const dl = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/request-attachments/${path}`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${staff2.token}` } })
    expect(dl.status).toBeGreaterThanOrEqual(400)
  })
  it('POSITIVE: the server can still upload, download and remove files', async () => {
    const rid = await ticketOf(staff1)
    const path = `${rid}/server-${tag}.txt`
    expect((await http('POST', `/storage/v1/object/request-attachments/${path}`, { key: SERVICE, token: SERVICE, body: 'ok', headers: { 'Content-Type': 'text/plain' } })).status).toBe(200)
    const dl = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/request-attachments/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })
    expect(dl.status).toBe(200)
    expect(await dl.text()).toBe('ok')
    await http('DELETE', '/storage/v1/object/request-attachments', { key: SERVICE, token: SERVICE, body: { prefixes: [path] } })
  })
})

describe('D-006 company-wide settings', () => {
  it('are not readable without signing in (original attack)', async () => {
    for (const t of ['sla_escalation_rules', 'business_hours', 'holidays', 'task_statuses', 'task_priorities', 'request_priorities', 'app_settings', 'retention_policies']) {
      expect((await anon('GET', `/${t}?select=*&limit=1`)).status, t).toBeGreaterThanOrEqual(400)
    }
  })
  it('cannot be changed by a manager or an admin (original attack)', async () => {
    const hours = (await svc<{ id: string; is_active: boolean }[]>('GET', '/business_hours?select=id,is_active&day_of_week=eq.1')).json[0]
    await asUser(manager, 'PATCH', '/business_hours?day_of_week=eq.1', { is_active: !hours.is_active })
    expect((await svc<{ is_active: boolean }[]>('GET', '/business_hours?select=is_active&day_of_week=eq.1')).json[0].is_active).toBe(hours.is_active)

    const before = (await svc<{ value: string }[]>('GET', '/app_settings?select=value&key=eq.auto_close_days')).json[0].value
    await asUser(admin, 'PATCH', '/app_settings?key=eq.auto_close_days', { value: '1' })
    expect((await svc<{ value: string }[]>('GET', '/app_settings?select=value&key=eq.auto_close_days')).json[0].value).toBe(before)
  })
  it('POSITIVE: signed-in users still read them, and the server can still change them', async () => {
    const r = await asUser<unknown[]>(agent1, 'GET', '/business_hours?select=id')
    expect(r.status).toBe(200)
    expect(r.json.length).toBeGreaterThan(0)
    expect((await asUser<unknown[]>(staff1, 'GET', '/request_priorities?select=id')).json.length).toBeGreaterThan(0)
    const h = (await svc<{ is_active: boolean }[]>('GET', '/business_hours?select=is_active&day_of_week=eq.2')).json[0]
    expect((await svc('PATCH', '/business_hours?day_of_week=eq.2', { is_active: h.is_active })).status).toBeLessThan(300)
  })
})

describe('D-014 deleting tasks / collaborators stays inside the caller\'s organization', () => {
  it('a manager cannot delete another organization\'s task; and can still delete a task of their own organization', async () => {
    const orgB = (await svc<{ id: string }[]>('POST', '/organizations', { name: `d14 ${tag}`, slug: `d14-${tag}`, status: 'active', seat_limit: 3 }, { Prefer: 'return=representation' })).json[0].id
    cleanup.push(() => http('POST', '/rest/v1/rpc/owner_delete_org', { key: SERVICE, token: SERVICE, body: { p_org_id: orgB } }))
    const other = (await svc<{ id: string }[]>('POST', '/tasks', { title: `other-org ${tag}`, created_by: agent1.id, org_id: orgB, task_type: 'personal' }, { Prefer: 'return=representation' })).json[0].id
    const own = (await svc<{ id: string }[]>('POST', '/tasks', { title: `own-org ${tag}`, created_by: agent1.id, org_id: ORG_A, task_type: 'personal' }, { Prefer: 'return=representation' })).json[0].id
    cleanup.push(() => svc('DELETE', `/tasks?id=in.(${other},${own})`))

    await asUser(manager, 'DELETE', `/tasks?id=eq.${other}`)
    expect((await svc<unknown[]>('GET', `/tasks?id=eq.${other}&select=id`)).json).toHaveLength(1)
    await asUser(manager, 'DELETE', `/tasks?id=eq.${own}`)
    expect((await svc<unknown[]>('GET', `/tasks?id=eq.${own}&select=id`)).json).toHaveLength(0)
  })
})

describe('D-015 internal notes are visible to the ticket\'s own team, not to any technician', () => {
  it('a technician who raised a ticket to another team cannot read that team\'s internal notes (original gap)', async () => {
    const team1 = await teamOf(agent1.id), team2 = await teamOf(agent2.id)
    expect(team1).not.toBe(team2)
    const svcRow = (await svc<{ id: string }[]>('GET', `/services?team_id=eq.${team2}&select=id&limit=1`)).json[0]
    const t = (await svc<{ id: string }[]>('POST', '/requests', { title: `d15 ${tag}`, requester_id: agent1.id, service_id: svcRow.id, team_id: team2, org_id: ORG_A, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
    cleanup.push(() => svc('DELETE', `/requests?id=eq.${t}`))
    await svc('POST', '/request_comments', { request_id: t, author_id: agent2.id, body: 'INTERNAL team-2 note', is_internal: true })
    await svc('POST', '/request_comments', { request_id: t, author_id: agent2.id, body: 'public reply', is_internal: false })

    const asRequesterTech = (await asUser<{ body: string }[]>(agent1, 'GET', `/request_comments?request_id=eq.${t}&select=body`)).json.map((c) => c.body)
    expect(asRequesterTech).toContain('public reply')
    expect(asRequesterTech).not.toContain('INTERNAL team-2 note')

    // POSITIVE: the ticket's own team and a manager still see the internal note
    expect((await asUser<{ body: string }[]>(agent2, 'GET', `/request_comments?request_id=eq.${t}&select=body`)).json.map((c) => c.body)).toContain('INTERNAL team-2 note')
    expect((await asUser<{ body: string }[]>(manager, 'GET', `/request_comments?request_id=eq.${t}&select=body`)).json.map((c) => c.body)).toContain('INTERNAL team-2 note')
  })
  it('POSITIVE: a plain requester never sees internal notes, but sees public replies', async () => {
    const rid = await ticketOf(staff1)
    await svc('POST', '/request_comments', { request_id: rid, author_id: agent1.id, body: `internal ${tag}`, is_internal: true })
    await svc('POST', '/request_comments', { request_id: rid, author_id: agent1.id, body: `public ${tag}`, is_internal: false })
    const bodies = (await asUser<{ body: string }[]>(staff1, 'GET', `/request_comments?request_id=eq.${rid}&select=body`)).json.map((c) => c.body)
    expect(bodies).toContain(`public ${tag}`)
    expect(bodies).not.toContain(`internal ${tag}`)
  })
})

describe('D-008 a ticket cannot be forged through the API', () => {
  it('a requester cannot insert a ticket that is already closed with a far-future due date (original attack)', async () => {
    const s = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
    const r = await asUser(staff1, 'POST', '/requests', { title: `forged ${tag}`, requester_id: staff1.id, org_id: ORG_A, service_id: s.id, team_id: s.team_id, status: 'closed', resolved_at: new Date().toISOString(), closed_at: new Date().toISOString(), resolution_due_at: '2099-01-01T00:00:00Z' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect((await svc<unknown[]>('GET', `/requests?title=eq.forged ${tag}&select=id`)).json).toHaveLength(0)
  })
  it('a technician cannot renumber a ticket or change when it was created (original attack)', async () => {
    const rid = await ticketOf(staff1)
    const before = (await svc<{ request_no: string; created_at: string }[]>('GET', `/requests?id=eq.${rid}&select=request_no,created_at`)).json[0]
    const t = await teamOf(agent1.id)
    // make sure agent1 can write this ticket: use a ticket of agent1's own team
    const mine = (await svc<{ id: string; request_no: string; created_at: string }[]>('GET', `/requests?team_id=eq.${t}&select=id,request_no,created_at&limit=1`)).json[0]
    const r = await asUser(agent1, 'PATCH', `/requests?id=eq.${mine.id}`, { request_no: `ZZZ-${tag}` })
    expect(r.status).toBeGreaterThanOrEqual(400)
    const r2 = await asUser(agent1, 'PATCH', `/requests?id=eq.${mine.id}`, { created_at: '2000-01-01T00:00:00Z' })
    expect(r2.status).toBeGreaterThanOrEqual(400)
    const after = (await svc<{ request_no: string; created_at: string }[]>('GET', `/requests?id=eq.${mine.id}&select=request_no,created_at`)).json[0]
    expect(after).toEqual({ request_no: mine.request_no, created_at: mine.created_at })
    expect(before.request_no).toBeTruthy()
  })
  it('POSITIVE: a requester can still create an ordinary ticket, and a technician can still change their team\'s tickets', async () => {
    const s = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
    const ok = await asUser<{ id: string }[]>(staff1, 'POST', '/requests', { title: `normal ${tag}`, requester_id: staff1.id, org_id: ORG_A, service_id: s.id, team_id: s.team_id }, { Prefer: 'return=representation' })
    expect(ok.status).toBe(201)
    cleanup.push(() => svc('DELETE', `/requests?id=eq.${ok.json[0].id}`))
    const t = await teamOf(agent1.id)
    const mine = (await svc<{ id: string; title: string }[]>('GET', `/requests?team_id=eq.${t}&select=id,title&limit=1`)).json[0]
    const upd = await asUser(agent1, 'PATCH', `/requests?id=eq.${mine.id}`, { priority: 'high' })
    expect(upd.status).toBeLessThan(300)
  })
})

describe('D-010 (database part) a deactivated user sees nothing, even with a session that is still open', () => {
  it('own tickets and other people disappear as soon as the account is inactive', async () => {
    const own = async () => (await asUser<unknown[]>(staff1, 'GET', `/requests?requester_id=eq.${staff1.id}&select=id&limit=5`)).json.length
    expect(await own()).toBeGreaterThan(0)
    await svc('PATCH', `/profiles?id=eq.${staff1.id}`, { is_active: false })
    cleanup.push(() => svc('PATCH', `/profiles?id=eq.${staff1.id}`, { is_active: true }))
    expect(await own()).toBe(0)
    expect((await asUser<unknown[]>(staff1, 'GET', '/profiles?select=id&limit=50')).json.length).toBeLessThanOrEqual(1)
    await svc('PATCH', `/profiles?id=eq.${staff1.id}`, { is_active: true })
    expect(await own()).toBeGreaterThan(0)
  })
})

describe('D-054 an attachment row cannot be re-pointed or re-typed through the API', () => {
  it('only the deleted flag can be changed; the file must be in the request\'s own folder', async () => {
    const rid = await ticketOf(staff1)
    const row = (await svc<{ id: string }[]>('POST', '/request_attachments', { request_id: rid, uploaded_by: staff1.id, file_name: 'a.txt', file_size: 1, mime_type: 'text/plain', storage_path: `${rid}/a-${tag}.txt` }, { Prefer: 'return=representation' })).json[0].id
    cleanup.push(() => svc('DELETE', `/request_attachments?id=eq.${row}`))

    expect((await asUser(staff1, 'PATCH', `/request_attachments?id=eq.${row}`, { mime_type: 'text/html' })).status).toBeGreaterThanOrEqual(400)
    expect((await asUser(staff1, 'PATCH', `/request_attachments?id=eq.${row}`, { storage_path: '99999999-0000-0000-0000-000000000000/steal.pdf' })).status).toBeGreaterThanOrEqual(400)
    const after = (await svc<{ mime_type: string; storage_path: string }[]>('GET', `/request_attachments?id=eq.${row}&select=mime_type,storage_path`)).json[0]
    expect(after).toEqual({ mime_type: 'text/plain', storage_path: `${rid}/a-${tag}.txt` })

    // an insert pointing at another request's folder is refused; one in its own folder is accepted
    const bad = await asUser(staff1, 'POST', '/request_attachments', { request_id: rid, uploaded_by: staff1.id, file_name: 'x.txt', file_size: 1, mime_type: 'text/plain', storage_path: '99999999-0000-0000-0000-000000000000/x.txt' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    const good = await asUser<{ id: string }[]>(staff1, 'POST', '/request_attachments', { request_id: rid, uploaded_by: staff1.id, file_name: 'y.txt', file_size: 1, mime_type: 'text/plain', storage_path: `${rid}/y-${tag}.txt` }, { Prefer: 'return=representation' })
    expect(good.status).toBe(201)
    cleanup.push(() => svc('DELETE', `/request_attachments?id=eq.${good.json[0].id}`))
  })
})
