import { describe, it, expect } from 'vitest'
import { canRetry } from '@/lib/supabase/resilient-fetch'

const withCode = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
const timeout = () => new DOMException('aborted', 'AbortError')

describe('resilient fetch: which failed requests are sent again (audit D-043)', () => {
  it('reads are repeated after any connection-level failure', () => {
    for (const m of ['GET', 'HEAD', undefined]) {
      expect(canRetry(m, timeout())).toBe(true)
      expect(canRetry(m, withCode('ECONNRESET'))).toBe(true)
      expect(canRetry(m, withCode('ETIMEDOUT'))).toBe(true)
    }
  })
  it('writes are repeated only when the server provably never received them', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(canRetry(m, withCode('ECONNREFUSED')), m).toBe(true)
      expect(canRetry(m, withCode('EADDRINUSE')), m).toBe(true)
      expect(canRetry(m, timeout()), m).toBe(false) // may have been applied
      expect(canRetry(m, withCode('ECONNRESET')), m).toBe(false)
      expect(canRetry(m, withCode('ETIMEDOUT')), m).toBe(false)
    }
  })
  it('an error the server actually sent is never repeated', () => {
    expect(canRetry('GET', new Error('boom'))).toBe(false)
  })
})
