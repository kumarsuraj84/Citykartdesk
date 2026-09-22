import { describe, it, expect } from 'vitest'
import { findTaggedRequestNo, resolveKnownSender } from '@/lib/email/inbound-match'

describe('findTaggedRequestNo', () => {
  it('finds the tag in the subject', () => {
    expect(findTaggedRequestNo({ subject: 'Re: [CKSD-000032] Ticket assigned', toAddresses: ['citykartdesk@citykartstores.com'], fromAddress: 'a@b.com' })).toBe('CKSD-000032')
  })

  it('falls back to a plus-tagged recipient address when the subject has no tag', () => {
    expect(findTaggedRequestNo({ subject: 'Fwd: something', toAddresses: ['citykartdesk+CKSD-000032@citykartstores.com'], fromAddress: 'a@b.com' })).toBe('CKSD-000032')
  })

  it('prefers the subject tag when both are present', () => {
    expect(findTaggedRequestNo({ subject: '[CKSD-000032] x', toAddresses: ['citykartdesk+CKSD-000099@citykartstores.com'], fromAddress: 'a@b.com' })).toBe('CKSD-000032')
  })

  it('returns null when neither signal is present', () => {
    expect(findTaggedRequestNo({ subject: 'Hello', toAddresses: ['citykartdesk@citykartstores.com'], fromAddress: 'a@b.com' })).toBeNull()
  })
})

describe('resolveKnownSender', () => {
  const profiles = new Map([['ankur.pahwa@citykartstores.com', { id: 'p1', name: 'Ankur Pahwa' }]])
  const oems = new Map([['service@voltas.example.com', 'Voltas AC Service']])

  it('matches a known portal user, case-insensitively', () => {
    expect(resolveKnownSender('Ankur.Pahwa@CityKartStores.com', profiles, oems)).toEqual({ kind: 'profile', profileId: 'p1', name: 'Ankur Pahwa' })
  })

  it('matches a known OEM contact', () => {
    expect(resolveKnownSender('service@voltas.example.com', profiles, oems)).toEqual({ kind: 'oem', name: 'Voltas AC Service' })
  })

  it('rejects an unrecognized address — the actual security gate', () => {
    expect(resolveKnownSender('random.stranger@gmail.com', profiles, oems)).toEqual({ kind: 'unknown' })
  })

  it('does not treat a look-alike address as a match', () => {
    expect(resolveKnownSender('ankur.pahwa@citykartstores.com.evil.com', profiles, oems)).toEqual({ kind: 'unknown' })
  })
})
