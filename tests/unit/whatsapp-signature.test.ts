import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyMetaSignature } from '@/lib/whatsapp/signature'

const APP_SECRET = 'my-app-secret'
const BODY = JSON.stringify({ hello: 'world' })

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

describe('Stage 5 — Meta webhook signature verification', () => {
  it('accepts a correctly-signed body', () => {
    expect(verifyMetaSignature(BODY, sign(BODY, APP_SECRET), APP_SECRET)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyMetaSignature(BODY, sign(BODY, 'wrong-secret'), APP_SECRET)).toBe(false)
  })

  it('rejects a signature computed over a different (tampered) body', () => {
    const tampered = JSON.stringify({ hello: 'tampered' })
    expect(verifyMetaSignature(tampered, sign(BODY, APP_SECRET), APP_SECRET)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(BODY, null, APP_SECRET)).toBe(false)
  })

  it('rejects a header missing the sha256= prefix', () => {
    const raw = createHmac('sha256', APP_SECRET).update(BODY, 'utf8').digest('hex')
    expect(verifyMetaSignature(BODY, raw, APP_SECRET)).toBe(false)
  })

  it('rejects a garbage/non-hex signature value without throwing', () => {
    expect(verifyMetaSignature(BODY, 'sha256=not-valid-hex!!', APP_SECRET)).toBe(false)
  })

  it('rejects an empty string body signed differently than the actual empty body', () => {
    expect(verifyMetaSignature('', sign('something-else', APP_SECRET), APP_SECRET)).toBe(false)
  })
})
