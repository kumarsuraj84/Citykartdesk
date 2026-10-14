import { describe, it, expect } from 'vitest'
import { senderAuthenticity } from '@/lib/email/inbound-auth'

const GOOD = 'mx.google.com; dkim=pass header.i=@citykart.org header.s=google header.b=Abc123; spf=pass (google.com: domain of manager@citykart.org designates 209.85.220.41 as permitted sender) smtp.mailfrom=manager@citykart.org; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=citykart.org'
const FORGED = 'mx.google.com; dkim=none; spf=fail (google.com: domain of evil@attacker.example does not designate 1.2.3.4 as permitted sender) smtp.mailfrom=evil@attacker.example; dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=citykart.org'

describe('is the sender who they say they are? (D-028)', () => {
  it('accepts a message Gmail authenticated for the sender domain', () => {
    expect(senderAuthenticity(GOOD, 'manager@citykart.org')).toMatchObject({ verdict: 'authentic' })
  })
  it('refuses a message that failed DMARC, SPF and DKIM', () => {
    expect(senderAuthenticity(FORGED, 'manager@citykart.org')).toMatchObject({ verdict: 'failed', reason: 'DMARC fail' })
  })
  it('a pass for the ATTACKER\'s own domain does not vouch for the address in the From line', () => {
    const h = 'mx.google.com; dkim=pass header.i=@attacker.example; spf=pass smtp.mailfrom=evil@attacker.example; dmarc=none header.from=citykart.org'
    expect(senderAuthenticity(h, 'manager@citykart.org')).toMatchObject({ verdict: 'failed' })
  })
  it('with no DMARC rule, a DKIM or SPF pass for the sender\'s own domain is enough', () => {
    expect(senderAuthenticity('mx.google.com; dkim=pass header.d=citykart.org; spf=neutral; dmarc=none', 'a@citykart.org').verdict).toBe('authentic')
    expect(senderAuthenticity('mx.google.com; dkim=none; spf=pass smtp.mailfrom=a@mail.citykart.org; dmarc=none', 'a@citykart.org').verdict).toBe('authentic')
  })
  it('only the topmost header written by Google counts: an extra "pass" line added by the sender lower down does not help', () => {
    expect(senderAuthenticity([FORGED, 'mx.google.com; dmarc=pass header.from=citykart.org'], 'manager@citykart.org').verdict).toBe('failed')
  })
  it('a "pass" written by someone else is not believed, and no header at all means unchecked (internal mail still works)', () => {
    expect(senderAuthenticity('mail.attacker.example; dmarc=pass', 'manager@citykart.org').verdict).toBe('unchecked')
    expect(senderAuthenticity(undefined, 'manager@citykart.org').verdict).toBe('unchecked')
    expect(senderAuthenticity([], 'manager@citykart.org').verdict).toBe('unchecked')
    expect(senderAuthenticity('', 'manager@citykart.org').verdict).toBe('unchecked')
  })
  it('copes with header values that are not plain strings', () => {
    expect(senderAuthenticity({ text: GOOD }, 'manager@citykart.org').verdict).toBe('authentic')
    expect(senderAuthenticity(12345, 'manager@citykart.org').verdict).toBe('unchecked')
  })
})
