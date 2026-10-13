// D-057: the sender of an inbound e-mail is the parsed header's own address, never an address that appears inside a display name.

import { describe, it, expect } from 'vitest'
import { simpleParser } from 'mailparser'
import { senderAddress } from '@/lib/email/inbound-sender'

const raw = (from: string) => Buffer.from(`From: ${from}\r\nTo: desk@citykart.org\r\nSubject: Re: [CKSD-000001] hello\r\nMessage-ID: <a@b>\r\n\r\nbody\r\n`)
const parse = (from: string) => simpleParser(raw(from))

// what the code did before the fix (kept here so the test documents the bug it closes)
const legacy = (p: { from?: { text?: string } }) => (p.from?.text ?? '').match(/<([^>]+)>/)?.[1] ?? (p.from?.text ?? '')

describe('senderAddress', () => {
  it('a normal message is attributed to its own sender (lower-cased)', async () => {
    expect(senderAddress((await parse('Asha Rao <Asha.Rao@Citykart.org>')).from)).toBe('asha.rao@citykart.org')
    expect(senderAddress((await parse('store.nld@citykartstores.com')).from)).toBe('store.nld@citykartstores.com')
  })

  it('a display name that contains another address does NOT change who the sender is (the original attack)', async () => {
    const p = await parse('"x <manager@citykart.org>" <someone@attacker.example>')
    expect(legacy(p)).toBe('manager@citykart.org') // the old behaviour: wrong person trusted
    expect(senderAddress(p.from)).toBe('someone@attacker.example') // now: the real sender, who is then simply not a known user
  })

  it('a message with more than one sender is not trusted', async () => {
    expect(senderAddress((await parse('a@citykart.org, b@citykart.org')).from)).toBeNull()
  })

  it('no sender, an empty sender and a group are not trusted', async () => {
    expect(senderAddress(undefined)).toBeNull()
    expect(senderAddress((await simpleParser(Buffer.from('Subject: x\r\n\r\nbody\r\n'))).from)).toBeNull()
    expect(senderAddress((await parse('Team: a@citykart.org, b@citykart.org;')).from)).toBeNull()
  })

  it('addresses with spaces, quotes or angle brackets in the address itself are rejected', () => {
    for (const address of ['a b@citykart.org', 'a"b@citykart.org', '<a@citykart.org>', 'nodomain', 'a@b', '']) {
      expect(senderAddress({ value: [{ address }] }), address).toBeNull()
    }
  })
})
