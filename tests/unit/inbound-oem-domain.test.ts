import { describe, it, expect } from 'vitest'
import { isPlausibleSender, oemNameByDomain, resolveOemByDomain } from '@/lib/email/inbound-match'

const contacts = new Map([
  ['service@bluestarindia.com', 'Blue Star OEM'],
  ['rahul.k@bluestarindia.com', 'Blue Star OEM'],
  ['lg.desk@lge.com', 'LG OEM'],
  ['someone@gmail.com', 'Local Vendor'],
  ['a@shared-brand.com', 'Brand One'],
  ['b@shared-brand.com', 'Brand Two'],
])

describe('an OEM\'s colleagues at the company domain (confirmed senders only)', () => {
  it('maps company domains to their OEM, leaving out shared mail domains and domains two OEMs claim', () => {
    const m = oemNameByDomain(contacts)
    expect(m.get('bluestarindia.com')).toBe('Blue Star OEM')
    expect(m.get('lge.com')).toBe('LG OEM')
    expect(m.has('gmail.com')).toBe(false)
    expect(m.has('shared-brand.com')).toBe(false)
  })
  it('finds the OEM for any address on that domain, case-insensitively, and nobody else', () => {
    const m = oemNameByDomain(contacts)
    expect(resolveOemByDomain('Service.Desk@BlueStarIndia.com', m)).toEqual({ kind: 'oem', name: 'Blue Star OEM' })
    expect(resolveOemByDomain('x@bluestarindia.com.evil.example', m)).toBeNull()
    expect(resolveOemByDomain('x@lookalike-bluestarindia.com', m)).toBeNull()
    expect(resolveOemByDomain('x@gmail.com', m)).toBeNull()
    expect(resolveOemByDomain('no-at-sign', m)).toBeNull()
  })
  it('only a sender at a company we deal with is worth a note on the ticket', () => {
    const profiles = ['manager@citykartstores.com', 'x@gmail.com']
    expect(isPlausibleSender('new.person@bluestarindia.com', contacts, profiles)).toBe(true)
    expect(isPlausibleSender('boss@citykartstores.com', contacts, profiles)).toBe(true)
    expect(isPlausibleSender('stranger@random-spam.example', contacts, profiles)).toBe(false)
    expect(isPlausibleSender('stranger@gmail.com', new Map(), profiles)).toBe(false)   // a shared mail domain never counts for users
    expect(isPlausibleSender('', contacts, profiles)).toBe(false)
  })
})
