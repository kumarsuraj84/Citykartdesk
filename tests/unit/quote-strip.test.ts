import { describe, it, expect } from 'vitest'
import { stripQuotedReply } from '@/lib/email/quote-strip'

describe('stripQuotedReply', () => {
  it('cuts a Gmail-style "On ... wrote:" quote', () => {
    const raw = `Sure, replacing the toner now.\n\nOn Tue, Sep 22, 2026 at 10:00 AM Ajay Kumar <ajay@citykart.org> wrote:\n> Please share more details.\n> Thanks.`
    expect(stripQuotedReply(raw)).toBe('Sure, replacing the toner now.')
  })

  it('cuts an Outlook "-----Original Message-----" quote', () => {
    const raw = `Approved, please proceed.\n\n-----Original Message-----\nFrom: system@citykart.org\nSent: Tuesday\nTo: arvind@citykart.org\nSubject: Approval needed`
    expect(stripQuotedReply(raw)).toBe('Approved, please proceed.')
  })

  it('cuts trailing "> " quoted lines with no explicit boundary line', () => {
    const raw = `Still broken, please check again.\n\n> Your request has been resolved.\n> Ajay marked it resolved.`
    expect(stripQuotedReply(raw)).toBe('Still broken, please check again.')
  })

  it('cuts a Gmail "On ... wrote:" quote even when the client word-wraps it across lines', () => {
    const raw = `OEM TICKET NO IS ____________________\n\n\nENJOY..\n\n\n*Regards*\n*Ankur Pahwa*\n*Manager - IT*\n\n\n\n\nOn Tue, Sep 22, 2026 at 3:56 PM CitykartDesk <\ncitykartdesk@citykartstores.com> wrote:\n\n> Dear Team,\n> Please find below...`
    expect(stripQuotedReply(raw)).toBe('OEM TICKET NO IS ____________________\n\n\nENJOY..\n\n\n*Regards*\n*Ankur Pahwa*\n*Manager - IT*')
  })

  it('cuts an Outlook "*From:* ... *Sent:* ... *To:* ... *Subject:*" header block (bold labels flattened to asterisks)', () => {
    const raw = `TICKET NO IS oem12345678910\n\n\n\n*From:* CitykartDesk <citykartdesk@citykartstores.com>\n*Sent:* 22 September 2026 15:50\n*To:* ankur.pahwa@citykartstores.com\n*Subject:* [CKSD-000489] Ticket to Vendor/OEM - wSSSS - CKSD-000489\n\n\n\nDear Team,\n\nPlease find the below ticket...`
    expect(stripQuotedReply(raw)).toBe('TICKET NO IS oem12345678910')
  })

  it('keeps the full text when there is nothing to strip', () => {
    expect(stripQuotedReply('The part has arrived, fitting it tomorrow.')).toBe('The part has arrived, fitting it tomorrow.')
  })

  it('never returns near-empty text — keeps the original if stripping would gut it', () => {
    const raw = `On second thought, everything is fine now.`
    expect(stripQuotedReply(raw)).toBe(raw)
  })

  it('handles empty/whitespace input safely', () => {
    expect(stripQuotedReply('')).toBe('')
    expect(stripQuotedReply('   ').trim()).toBe('')
  })
})
