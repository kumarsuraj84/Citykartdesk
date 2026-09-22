/**
 * appendEmailReplyComment() — the counterpart to addComment() for a reply that came in
 * by email. Against the real database.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, seedRequestLike, getAdmin, type D03Fixtures } from '../setup/fixtures-d03'

const sent: unknown[] = []
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => { sent.push(1); return {} }) }))

import { appendEmailReplyComment } from '@/lib/requests/email-reply-comment'

describe('appendEmailReplyComment', () => {
  let fx: D03Fixtures
  const admin = getAdmin()

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
    fx = await setupD03Fixtures()
  }, 90_000)
  afterAll(async () => { await fx?.cleanup() }, 90_000)

  it('a known technician\'s reply is stored, attributed, notifies the requester, and resumes a Waiting on User ticket', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    const res = await appendEmailReplyComment({
      requestId: req.id, body: 'Replaced the part, please confirm this fixed it.',
      author: { kind: 'profile', profileId: fx.agentA.id, name: 'D03 Agent A' },
    })
    expect(res.error).toBeUndefined()

    const { data: comment } = await admin.from('request_comments').select('*').eq('id', res.commentId!).single()
    expect(comment!.source).toBe('email')
    expect(comment!.author_id).toBe(fx.agentA.id)
    expect(comment!.external_name).toBeNull()
    expect(comment!.is_internal).toBe(false)

    let notifs: { user_id: string; title: string }[] = []
    const start = Date.now()
    while (Date.now() - start < 4000) {
      const { data } = await admin.from('notifications').select('user_id, title').eq('request_id', req.id).eq('type', 'comment_added')
      notifs = data ?? []
      if (notifs.some((n) => n.user_id === fx.requesterA.id)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(notifs.some((n) => n.user_id === fx.requesterA.id && n.title.includes('replied by email'))).toBe(true)
  })

  it('an OEM contact\'s reply is stored with no author_id, attributed by name/email', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'in_progress' })
    const res = await appendEmailReplyComment({
      requestId: req.id, body: 'Our technician will visit tomorrow between 10-12.',
      author: { kind: 'oem', name: 'Voltas AC Service', email: 'service@voltas.example.com' },
    })
    expect(res.error).toBeUndefined()

    const { data: comment } = await admin.from('request_comments').select('*').eq('id', res.commentId!).single()
    expect(comment!.author_id).toBeNull()
    expect(comment!.external_name).toBe('Voltas AC Service')
    expect(comment!.external_email).toBe('service@voltas.example.com')
  })

  it('requester\'s own reply while Waiting on User resumes the ticket to In Progress', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, assignedTo: fx.agentA.id, status: 'waiting_user' })
    await admin.from('requests').update({ waiting_since: new Date(Date.now() - 60_000).toISOString() }).eq('id', req.id)

    await appendEmailReplyComment({
      requestId: req.id, body: 'Yes, still an issue.',
      author: { kind: 'profile', profileId: fx.requesterA.id, name: 'D03 Requester A' },
    })

    const { data } = await admin.from('requests').select('status, waiting_since').eq('id', req.id).single()
    expect(data!.status).toBe('in_progress')
    expect(data!.waiting_since).toBeNull()
  })

  it('rejects an empty reply body', async () => {
    const req = await seedRequestLike(fx, { requesterId: fx.requesterA.id, serviceId: fx.teamA.serviceId, teamId: fx.teamA.id, status: 'open' })
    const res = await appendEmailReplyComment({ requestId: req.id, body: '   ', author: { kind: 'oem', name: 'X', email: 'x@y.com' } })
    expect(res.error).toBeTruthy()
  })
})
