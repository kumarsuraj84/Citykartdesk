import { describe, it, expect, beforeEach } from 'vitest'
import { signCsatToken, verifyCsatToken, csatLinksAvailable } from '@/lib/csat/token'
import { csatResolvedEmail, csatReminderEmail } from '@/lib/email/csat-templates'

const ID = '123e4567-e89b-12d3-a456-426614174000'

describe('CSAT link token', () => {
  beforeEach(() => { process.env.CSAT_LINK_SECRET = 'unit-secret' })

  it('round-trips a good token', () => {
    const t = signCsatToken(ID, Date.now() + 60_000)!
    expect(verifyCsatToken(t)).toMatchObject({ ok: true, surveyId: ID })
  })
  it('refuses an edited survey id, an edited expiry and garbage', () => {
    const t = signCsatToken(ID, Date.now() + 60_000)!
    const [, exp, sig] = t.split('.')
    expect(verifyCsatToken(`123e4567-e89b-12d3-a456-426614174999.${exp}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyCsatToken(`${ID}.${(Date.now() + 9e9).toString(36)}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyCsatToken('nonsense')).toEqual({ ok: false, reason: 'invalid' })
  })
  it('refuses an expired token and a token signed with another secret', () => {
    expect(verifyCsatToken(signCsatToken(ID, Date.now() - 1)!)).toEqual({ ok: false, reason: 'expired' })
    const t = signCsatToken(ID, Date.now() + 60_000)!
    process.env.CSAT_LINK_SECRET = 'other'
    expect(verifyCsatToken(t)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('makes no links when there is no secret', () => {
    const keep = process.env.CRON_SECRET
    delete process.env.CSAT_LINK_SECRET
    delete process.env.CRON_SECRET
    expect(csatLinksAvailable()).toBe(false)
    expect(signCsatToken(ID, Date.now() + 1000)).toBeNull()
    if (keep) process.env.CRON_SECRET = keep
  })
})

const base = {
  recipientName: 'Asha', requestNo: 'CKSD-1', requestTitle: 'AC <b>not</b> cooling', requestUrl: 'http://app.test/requests/1',
  starUrls: [1, 2, 3, 4, 5].map((n) => `http://app.test/csat/tok?r=${n}`), reopenUrl: 'http://app.test/csat/tok?reopen=1', reopenUntil: '12 Oct 2026, 5:00 pm',
}

describe('CSAT e-mails', () => {
  it('the resolved e-mail carries the note, five stars, the reopen link and its deadline, and escapes the ticket text', () => {
    const m = csatResolvedEmail({ ...base, resolutionNote: 'Gas refilled <script>x</script>', resolverName: 'Krishan', resolvedOn: '9 Oct 2026' })
    expect(m.subject).toBe('Resolved: CKSD-1 — AC <b>not</b> cooling')
    for (const n of [1, 2, 3, 4, 5]) expect(m.html).toContain(`?r=${n}`)
    expect(m.html).toContain('?reopen=1')
    expect(m.html).toContain('12 Oct 2026, 5:00 pm')
    expect(m.html).toContain('Gas refilled')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>not</b>')
    expect(m.text).toContain('Gas refilled')
  })
  it('leaves out the reopen line when there is no reopen window', () => {
    const m = csatResolvedEmail({ ...base, reopenUntil: '', resolutionNote: '', resolverName: '', resolvedOn: '' })
    expect(m.html).not.toContain('?reopen=1')
  })
  it('the reminder asks again with the same links', () => {
    const m = csatReminderEmail(base)
    expect(m.subject).toMatch(/^Quick question/)
    expect(m.html).toContain('?r=5')
    expect(m.html).toContain('?reopen=1')
  })
})
