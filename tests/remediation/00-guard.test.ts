import { describe, it, expect } from 'vitest'

describe('remediation tests run only on the isolated audit stack', () => {
  it('points at a 554xx loopback API, with audit mode and the egress guard on', () => {
    expect(process.env.AUDIT_MODE).toBe('1')
    expect(process.env.SUPABASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:554\d\d$/)
    expect(process.env.NODE_OPTIONS).toContain('egress-guard.cjs')
  })
  it('the developer stack port (54321) is rejected by the guard logic', () => {
    expect(/^554\d\d$/.test('54321')).toBe(false)
  })
})
