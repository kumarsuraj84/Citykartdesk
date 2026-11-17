import { describe, expect, it } from 'vitest'
import { parseRequestNoFromAddress, parseRequestNoFromSubject, subjectTag, taggedReplyAddress, withSubjectTag } from '@/lib/email/thread-tag'
import { findTaggedRequestNo, resolveKnownSender } from '@/lib/email/inbound-match'
import { zohoRequestNo } from '@/lib/zoho/transfer/number'

// A moved ticket is mailed like any other, so a person's REPLY to such a mail must find its way back to the ticket. These cases use the real matching code.
describe('replies to mails about a ticket moved from Zoho find their ticket', () => {
  it('tags the subject and the reply address with the ZOHO- number, and reads them back', () => {
    const no = zohoRequestNo(48213)!
    expect(withSubjectTag('Request updated', no)).toBe('[ZOHO-48213] Request updated')
    expect(parseRequestNoFromSubject(`Re: ${subjectTag(no)} Request updated`)).toBe('ZOHO-48213')
    const addr = taggedReplyAddress('citykartdesk@citykartstores.com', no)!
    expect(addr).toBe('citykartdesk+ZOHO-48213@citykartstores.com')
    expect(parseRequestNoFromAddress(addr)).toBe('ZOHO-48213')
  })
  it('works for every Zoho number of 3 to 8 digits (today\'s numbers run from 6 digits up to 146,000)', () => {
    for (const n of [100, 4821, 48213, 146038, 12345678]) {
      const no = zohoRequestNo(n)!
      expect(parseRequestNoFromSubject(`Re: [${no}] x`), no).toBe(no)
    }
  })
  it('finds the ticket from either signal, subject first, and ignores a mail with neither', () => {
    expect(findTaggedRequestNo({ subject: 'Re: [ZOHO-146038] Request updated', toAddresses: [], fromAddress: 'a@b.test' })).toBe('ZOHO-146038')
    expect(findTaggedRequestNo({ subject: 'Hello', toAddresses: ['citykartdesk+ZOHO-146038@citykartstores.com'], fromAddress: 'a@b.test' })).toBe('ZOHO-146038')
    expect(findTaggedRequestNo({ subject: 'Hello', toAddresses: ['someone@x.test'], fromAddress: 'a@b.test' })).toBeNull()
  })
  it('KNOWN LIMIT: a Zoho number of only 1 or 2 digits (the oldest tickets, long closed) is not recognised in a reply', () => {
    expect(parseRequestNoFromSubject('Re: [ZOHO-37] Request updated')).toBeNull()
    expect(parseRequestNoFromSubject('Re: [ZOHO-99] x')).toBeNull()
  })
  it('a stranger who copies the subject tag is still not trusted: only a known person\'s exact address is accepted', () => {
    const profiles = new Map([['qa11.store@audit.test', { id: 'p1', name: 'Store' }]])
    expect(resolveKnownSender('QA11.Store@audit.test', profiles, new Map())).toMatchObject({ kind: 'profile', profileId: 'p1' })
    expect(resolveKnownSender('qa11.store@audit.test.evil.test', profiles, new Map())).toEqual({ kind: 'unknown' })
    expect(resolveKnownSender('stranger@x.test', profiles, new Map())).toEqual({ kind: 'unknown' })
  })
})
