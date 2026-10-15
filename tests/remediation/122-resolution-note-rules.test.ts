// Marking a ticket resolved needs a real note: what was done, at least 20 characters, and no password. Checked through the real server action on the audit
// database, as a signed-in administrator, on one of its synthetic tickets.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { setupD03Fixtures, clientForToken, type D03Fixtures } from '../setup/fixtures-d03'
import { svc } from './helpers'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()), cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateRequestStatus } from '@/lib/actions/requests'
import { NOTE_TOO_SHORT_MESSAGE, PASSWORD_IN_NOTE_MESSAGE, NOTE_REQUIRED_MESSAGE } from '@/lib/requests/resolution-note'

vi.setConfig({ testTimeout: 180_000 })

let fx: D03Fixtures
let ticket = ''

beforeAll(async () => {
  fx = await setupD03Fixtures()
  vi.mocked(createClient).mockResolvedValue(clientForToken(fx.admin.accessToken) as never)
  // the fixtures' own ticket (removed with them), put to "in progress" with someone working on it
  ticket = fx.requestA.id
  await svc('PATCH', `/requests?id=eq.${ticket}`, { status: 'in_progress' })
}, 240_000)

afterAll(async () => { await fx?.cleanup() }, 120_000)

describe('resolving a ticket through the server', () => {
  it('refuses nothing, too little, or a password, and says why', async () => {
    expect((await updateRequestStatus(ticket, 'resolved')).error).toBe(NOTE_REQUIRED_MESSAGE)
    expect((await updateRequestStatus(ticket, 'resolved', 'Resolved')).error).toBe(NOTE_TOO_SHORT_MESSAGE)
    expect((await updateRequestStatus(ticket, 'resolved', 'We are resolving the ticket.')).error).toBe(NOTE_TOO_SHORT_MESSAGE)
    expect((await updateRequestStatus(ticket, 'resolved', 'ID created. Pass: Xyzw@9876 for all the IDs.')).error).toBe(PASSWORD_IN_NOTE_MESSAGE)
    const row = await svc<{ status: string }[]>('GET', `/requests?id=eq.${ticket}&select=status`)
    expect(row.json[0].status).toBe('in_progress')                          // nothing changed
  })

  it('accepts a note that says what was done', async () => {
    const res = await updateRequestStatus(ticket, 'resolved', 'Cable was damaged. Replaced the cable and tested the payment.')
    expect(res.error).toBeUndefined()
    const row = await svc<{ status: string }[]>('GET', `/requests?id=eq.${ticket}&select=status`)
    expect(row.json[0].status).toBe('resolved')
  })
})
