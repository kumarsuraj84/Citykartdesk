// A-01: what the browser sends with a reply / forward can no longer override the organisation-checked message id or the sender, recipients are validated and
// limited, and the HTML is sanitised. A-14: testChannel checks the channel belongs to the caller's organisation.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb, type FakeDb } from './helpers/fake-db'

let db: FakeDb
let profile: { id: string; role: string; org_id: string } | null
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => profile }))
vi.mock('@/lib/actions/moduleGuard', () => ({ requireModuleEnabled: async () => null }))
vi.mock('@/lib/secrets', () => ({ getSecret: () => 'worker-secret' }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/requests/cc-recipients', async () => {
  const real = await vi.importActual<typeof import('@/lib/requests/cc-recipients')>('@/lib/requests/cc-recipients')
  return { ...real, loadCcBook: async () => new Map([['known.oem@oem.test', { email: 'known.oem@oem.test', name: 'OEM', kind: 'oem', detail: 'OEM contact' }]]) }
})
const fetchSpy = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true, json: async () => ({ ok: true }) }))
vi.mock('@/lib/http/fetch-timeout', () => ({ fetchWithTimeout: (...a: unknown[]) => (fetchSpy as unknown as (...x: unknown[]) => unknown)(...a) }))

import { sendFromMessage } from '@/lib/actions/intake/communication'
import { testChannel } from '@/lib/actions/intake/channels'
import { cleanSendPayload } from '@/lib/intake/send-payload'

const base = { action: 'reply' as const, toAddresses: ['customer@shop.test'], subject: 'Re: AC', bodyText: 'Hello' }

beforeEach(() => {
  process.env.INTAKE_WORKER_URL = 'https://worker.test'
  fetchSpy.mockClear()
  profile = { id: 'u-agent', role: 'agent', org_id: 'org-1' }
  db = fakeDb({
    intake_messages: [
      { id: 'm1', org_id: 'org-1', thread_id: 't1', from_address: 'customer@shop.test', to_addresses: ['desk@citykart.test'], cc_addresses: ['boss@shop.test'] },
      { id: 'm2', org_id: 'org-1', thread_id: 't1', from_address: 'other@shop.test', to_addresses: [], cc_addresses: [] },
      { id: 'm-foreign', org_id: 'org-2', thread_id: null, from_address: 'x@y.test', to_addresses: [], cc_addresses: [] },
    ],
    intake_channels: [{ id: 'ch1', org_id: 'org-1' }, { id: 'ch-foreign', org_id: 'org-2' }],
  })
})

const sentBody = () => JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body) as Record<string, unknown>

describe('sendFromMessage', () => {
  it('trusted ids are written last: a forged messageId / senderId in the payload cannot override them', async () => {
    const forged = { ...base, messageId: 'm-foreign', senderId: 'someone-else' } as never
    const r = await sendFromMessage('m1', forged)
    expect(r.ok).toBe(true)
    expect(sentBody()).toMatchObject({ messageId: 'm1', senderId: 'u-agent' })
    expect(sentBody()).not.toHaveProperty('org_id')
  })

  it('unknown payload fields are not passed on', async () => {
    await sendFromMessage('m1', { ...base, evil: 'x', bcc: ['a@b.test'] } as never)
    expect(sentBody()).not.toHaveProperty('evil')
    expect(sentBody()).not.toHaveProperty('bcc')
  })

  it('a message of another organisation is refused before the worker is called', async () => {
    const r = await sendFromMessage('m-foreign', base)
    expect(r.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a non-admin cannot write to an address that is neither on the conversation nor a known contact', async () => {
    const r = await sendFromMessage('m1', { ...base, toAddresses: ['stranger@evil.test'] })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/stranger@evil\.test/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('people on the thread (any of its messages) and known contacts are allowed', async () => {
    const r = await sendFromMessage('m1', { ...base, toAddresses: ['customer@shop.test', 'OTHER@shop.test'], ccAddresses: ['known.oem@oem.test'] })
    expect(r.ok).toBe(true)
    expect(sentBody().toAddresses).toEqual(['customer@shop.test', 'other@shop.test'])
  })

  it('an admin may write to a new address', async () => {
    profile = { id: 'u-admin', role: 'admin', org_id: 'org-1' }
    const r = await sendFromMessage('m1', { ...base, toAddresses: ['new.person@elsewhere.test'] })
    expect(r.ok).toBe(true)
  })

  it('the HTML body is sanitised', async () => {
    await sendFromMessage('m1', { ...base, bodyHtml: '<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(1)>' })
    const html = String(sentBody().bodyHtml)
    expect(html).toContain('<p>Hi</p>')
    expect(html).not.toMatch(/script|onerror|<img/i)
  })

  it('a requester (not a reviewer) cannot send at all', async () => {
    profile = { id: 'u-req', role: 'user', org_id: 'org-1' }
    expect((await sendFromMessage('m1', base)).ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('cleanSendPayload', () => {
  it('refuses invalid addresses, too many recipients, an unknown action and an empty recipient list', () => {
    expect(cleanSendPayload({ ...base, toAddresses: ['not an address'] })).toHaveProperty('error')
    expect(cleanSendPayload({ ...base, toAddresses: Array.from({ length: 21 }, (_, i) => `p${i}@x.test`) })).toHaveProperty('error')
    expect(cleanSendPayload({ ...base, action: 'bounce' })).toHaveProperty('error')
    expect(cleanSendPayload({ ...base, toAddresses: [] })).toHaveProperty('error')
    expect(cleanSendPayload({ ...base, toAddresses: 'a@x.test' })).toHaveProperty('error')
  })
  it('removes line breaks from the subject (no extra header lines) and de-duplicates addresses', () => {
    const r = cleanSendPayload({ ...base, subject: 'Hello\r\nBcc: evil@x.test', toAddresses: ['A@x.test', 'a@x.test'] }) as { subject: string; toAddresses: string[] }
    expect(r.subject).not.toMatch(/[\r\n]/)
    expect(r.toAddresses).toEqual(['a@x.test'])
  })
})

describe('testChannel', () => {
  it('works for a channel of the caller\'s organisation', async () => {
    profile = { id: 'u-admin', role: 'admin', org_id: 'org-1' }
    expect((await testChannel('ch1')).ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
  it('refuses another organisation\'s channel without calling the worker', async () => {
    profile = { id: 'u-admin', role: 'admin', org_id: 'org-1' }
    const r = await testChannel('ch-foreign')
    expect(r).toMatchObject({ ok: false, error: 'Channel not found.' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
