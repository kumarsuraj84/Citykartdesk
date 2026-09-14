/**
 * Stage 8.1 — reproduces and locks in the fix for a real, previously-
 * undiscovered defect: proxy.ts's session gate redirected EVERY
 * unauthenticated call to /api/intake/webhook/whatsapp to /login, since the
 * route was missing from PUBLIC_API_ROUTES. Meta never sends a Supabase
 * session cookie, so both the GET verification handshake and the POST
 * inbound-message delivery would have been redirected before ever reaching
 * the route's own signature/token checks — in any real deployment, this
 * alone would have made real Meta webhook verification (and every real
 * inbound message) fail, independent of any other external prerequisite.
 * Reproduced directly against the local dev server via curl before the fix
 * (307 to /login), confirmed fixed after (403, from the route's own
 * verifyWebhookChallenge — never reaching /login).
 *
 * This test asserts the fast-path allowlist behavior directly (no Supabase
 * network call is made for an allowlisted path — the function returns
 * before ever constructing the Supabase client), so it needs no mocking.
 */
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

function requestFor(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, 'http://localhost:3210'))
}

describe('proxy() — public API route allowlist', () => {
  it('/api/intake/webhook/whatsapp is never redirected to /login, even with no session (Stage 8.1 fix)', async () => {
    const response = await proxy(requestFor('/api/intake/webhook/whatsapp'))
    expect(response.headers.get('location')).toBeNull()
    expect([307, 308]).not.toContain(response.status)
  })

  it('every documented cron/webhook/health route stays session-exempt (regression guard for the whole allowlist)', async () => {
    const publicRoutes = [
      '/api/health',
      '/api/alerts/run',
      '/api/business-rules/run',
      '/api/desktime/sync',
      '/api/intake/cron/classify',
      '/api/intake/webhook/gmail',
      '/api/intake/webhook/outlook',
      '/api/intake/webhook/whatsapp',
    ]
    for (const route of publicRoutes) {
      const response = await proxy(requestFor(route))
      expect(response.headers.get('location'), `${route} must not redirect`).toBeNull()
    }
  })

  it('an ordinary protected API route (not on the allowlist) still redirects to /login with no session — the allowlist did not become a blanket bypass', async () => {
    const response = await proxy(requestFor('/api/admin/audit'))
    const location = response.headers.get('location')
    expect(location).toContain('/login')
  })
})
