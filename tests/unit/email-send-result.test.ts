// B-18 / C-05: sendEmail no longer reports success when no mail provider is set up or when the mail server refused a To recipient.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let setup: { provider: 'smtp' | 'resend' | null; smtp?: { host: string; port: number; secure: boolean; user: string; pass: string } } = { provider: null }
vi.mock('@/lib/email/config', () => ({
  getEmailSetup: async () => setup,
  getEmailFrom: async () => 'Desk <desk@citykart.test>',
  RESEND_API_KEY: 'x',
}))
vi.mock('@/lib/events/record', () => ({ recordEvents: async () => ({}) }))
const sendMail = vi.fn()
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMail(...a), close: () => {} }) } }))

import { sendEmail, rejectedToRecipients, bareAddress, MAIL_NOT_SET_UP } from '@/lib/email/send'

const payload = { to: ['a@x.test', 'B <b@x.test>'], subject: 'S', html: '<p>x</p>' }
const savedSink = process.env.MAIL_SINK_DIR

beforeEach(() => { delete process.env.MAIL_SINK_DIR; sendMail.mockReset(); vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { if (savedSink === undefined) delete process.env.MAIL_SINK_DIR; else process.env.MAIL_SINK_DIR = savedSink; vi.restoreAllMocks() })

describe('sendEmail result', () => {
  it('with no mail provider it is an error marked skipped, not a success', async () => {
    setup = { provider: null }
    const r = await sendEmail(payload)
    expect(r).toEqual({ error: MAIL_NOT_SET_UP, skipped: true })
  })

  it('a refused To recipient is a failure that names the address', async () => {
    setup = { provider: 'smtp', smtp: { host: 'smtp.x.test', port: 587, secure: false, user: 'u', pass: 'p' } }
    sendMail.mockResolvedValue({ accepted: ['a@x.test'], rejected: ['b@x.test'] })
    const r = await sendEmail(payload)
    expect(r.error).toMatch(/b@x\.test/)
  })

  it('all recipients accepted is a success', async () => {
    setup = { provider: 'smtp', smtp: { host: 'smtp.x.test', port: 587, secure: false, user: 'u', pass: 'p' } }
    sendMail.mockResolvedValue({ accepted: ['a@x.test', 'b@x.test'], rejected: [] })
    expect(await sendEmail(payload)).toEqual({})
  })

  it('a thrown error (for example a timeout) is returned as an error', async () => {
    setup = { provider: 'smtp', smtp: { host: 'smtp.x.test', port: 587, secure: false, user: 'u', pass: 'p' } }
    sendMail.mockRejectedValue(new Error('Connection timeout'))
    expect((await sendEmail(payload)).error).toBe('Connection timeout')
  })

  it('the local mail sink still counts as sent even with no provider', async () => {
    setup = { provider: null }
    const { mkdtemp, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sink-'))
    process.env.MAIL_SINK_DIR = dir
    try {
      expect(await sendEmail(payload)).toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('refused recipients', () => {
  it('compares bare, lower-case addresses and reads both string and object entries', () => {
    expect(bareAddress('Name <A@X.test>')).toBe('a@x.test')
    expect(rejectedToRecipients(['a@x.test', 'B <b@x.test>'], [{ address: 'B@x.test' }])).toEqual(['b@x.test'])
    expect(rejectedToRecipients('a@x.test', [])).toEqual([])
    expect(rejectedToRecipients('a@x.test', undefined)).toEqual([])
  })
  it('a refused CC address alone is not a failure of the To recipients', () => {
    expect(rejectedToRecipients(['a@x.test'], ['cc@x.test'])).toEqual([])
  })
})
