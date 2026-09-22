import { describe, it, expect } from 'vitest'
import {
  withSubjectTag, parseRequestNoFromSubject, isGmailHost,
  taggedReplyAddress, parseRequestNoFromAddress,
} from '@/lib/email/thread-tag'

describe('subject tagging', () => {
  it('adds the tag once', () => {
    expect(withSubjectTag('Request updated: Printer jam', 'CKSD-000032')).toBe('[CKSD-000032] Request updated: Printer jam')
  })
  it('never double-tags an already-tagged subject', () => {
    const once = withSubjectTag('Request updated: X', 'CKSD-000032')
    expect(withSubjectTag(once, 'CKSD-000032')).toBe(once)
  })
  it('parses the tag back out, including from a "Re: [..]" reply subject', () => {
    expect(parseRequestNoFromSubject('[CKSD-000032] Request updated: Printer jam')).toBe('CKSD-000032')
    expect(parseRequestNoFromSubject('Re: [CKSD-000032] Request updated: Printer jam')).toBe('CKSD-000032')
    expect(parseRequestNoFromSubject('Re: Re: Fwd: [CKSD-000032] Ticket assigned')).toBe('CKSD-000032')
  })
  it('finds nothing in an unrelated subject', () => {
    expect(parseRequestNoFromSubject('Meeting tomorrow')).toBeNull()
  })
})

describe('tagged reply address', () => {
  it('recognizes gmail/google hosts only', () => {
    expect(isGmailHost('smtp.gmail.com')).toBe(true)
    expect(isGmailHost('imap.gmail.com')).toBe(true)
    expect(isGmailHost('smtp.office365.com')).toBe(false)
  })
  it('builds a plus-tagged address', () => {
    expect(taggedReplyAddress('citykartdesk@citykartstores.com', 'CKSD-000032')).toBe('citykartdesk+CKSD-000032@citykartstores.com')
  })
  it('parses the ticket number back out of a plus-tagged address', () => {
    expect(parseRequestNoFromAddress('citykartdesk+CKSD-000032@citykartstores.com')).toBe('CKSD-000032')
    expect(parseRequestNoFromAddress('CityKartDesk+cksd-000032@CityKartStores.com')).toBe('CKSD-000032')
  })
  it('finds nothing in a plain (untagged) address', () => {
    expect(parseRequestNoFromAddress('someone@example.com')).toBeNull()
  })
})
