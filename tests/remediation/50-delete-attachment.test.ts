// D-068 (found during remediation): deleting an attachment through the app failed for everyone, because the soft-delete update was made with the
// signed-in user's own client and the row-security rules reject an update that makes the row invisible to its own SELECT rule. The action's own
// permission check (uploader, or a technician of the team, or a manager) is now what decides, and the update is made with the server's client.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { svc, login, ORG_A, type Session } from './helpers'

let acting: { id: string; role: string; team_members: { team_id: string }[]; org_id: string } | null = null
let userToken = ''
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => acting }))
// the user-scoped client really is the user's own (row security on), as in the app
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${userToken}` } } }),
}))

const tag = Date.now()
let staff: Session, other: Session, requestId: string, attachmentId: string, path: string

beforeAll(async () => {
  ;[staff, other] = await Promise.all([login('staff1@audit.test'), login('staff2@audit.test')])
  const s = (await svc<{ id: string; team_id: string }[]>('GET', '/services?select=id,team_id&limit=1')).json[0]
  requestId = (await svc<{ id: string }[]>('POST', '/requests', { title: `d68 ${tag}`, requester_id: staff.id, service_id: s.id, team_id: s.team_id, org_id: ORG_A, status: 'open' }, { Prefer: 'return=representation' })).json[0].id
  path = `${requestId}/d68-${tag}.txt`
  await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/request-attachments/${path}`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'text/plain' }, body: 'x' })
  attachmentId = (await svc<{ id: string }[]>('POST', '/request_attachments', { request_id: requestId, uploaded_by: staff.id, file_name: 'd68.txt', file_size: 1, mime_type: 'text/plain', storage_path: path }, { Prefer: 'return=representation' })).json[0].id
})
afterAll(async () => {
  await svc('DELETE', `/request_attachments?request_id=eq.${requestId}`)
  await svc('DELETE', `/requests?id=eq.${requestId}`)
})

const row = async () => (await svc<{ deleted_at: string | null }[]>('GET', `/request_attachments?id=eq.${attachmentId}&select=deleted_at`)).json[0]

describe('deleteAttachment', () => {
  it('a person who is neither the uploader nor on the team cannot delete it (the action\'s own permission check still decides)', async () => {
    const { deleteAttachment } = await import('@/lib/actions/attachments')
    acting = { id: other.id, role: 'user', team_members: [], org_id: ORG_A }
    userToken = other.token
    const r = await deleteAttachment(attachmentId)
    expect(r.error).toBeTruthy()
    expect((await row()).deleted_at).toBeNull()
  })

  it('the uploader can delete their own attachment (the file is marked deleted and removed from storage)', async () => {
    const { deleteAttachment } = await import('@/lib/actions/attachments')
    acting = { id: staff.id, role: 'user', team_members: [], org_id: ORG_A }
    userToken = staff.token
    const r = await deleteAttachment(attachmentId)
    expect(r.error).toBeUndefined()
    expect((await row()).deleted_at).not.toBeNull()
    const gone = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/request-attachments/${path}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } })
    expect(gone.status).toBeGreaterThanOrEqual(400)
  })
})
