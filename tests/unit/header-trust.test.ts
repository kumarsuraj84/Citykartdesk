// D-001 / SEC-01: a client must not be able to choose who it is by sending the verified-user header.
// Negative tests: forged / unsigned / wrongly-signed headers are never forwarded or never believed.
// Positive tests: the proxy's own signed header is believed; the main path still redirects a signed-out visitor to /login.

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { readVerifiedUserId, signVerifiedUser, VERIFIED_USER_HEADER, VERIFIED_USER_SIG_HEADER } from '@/lib/auth/verified-user'

const VICTIM = '11111111-2222-3333-4444-555555555555'

function req(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, 'http://localhost:3310'), { headers })
}
/** The header names the proxy lets through to the page/route (Next lists them in x-middleware-override-headers). */
function forwarded(res: Response): string[] {
  return (res.headers.get('x-middleware-override-headers') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

describe('proxy: client-supplied verified-user headers are removed on every fast path', () => {
  const paths = ['/requests/anything.png', '/admin/categories/x.svg', '/approve/sometoken', '/csat/sometoken', '/api/health', '/api/version', '/api/alerts/run', '/_next/data/x', '/favicon.ico']
  for (const p of paths) {
    it(`${p}: the forged id and signature are not forwarded`, async () => {
      const res = await proxy(req(p, { [VERIFIED_USER_HEADER]: VICTIM, [VERIFIED_USER_SIG_HEADER]: 'forged', 'x-keep-me': '1' }))
      const names = forwarded(res)
      expect(names).not.toContain(VERIFIED_USER_HEADER)
      expect(names).not.toContain(VERIFIED_USER_SIG_HEADER)
      expect(res.headers.get(`x-middleware-request-${VERIFIED_USER_HEADER}`)).toBeNull()
      expect(names).toContain('x-keep-me') // unrelated headers still pass
    })
  }

  it('a signed-out visitor to a protected page is still sent to /login, and nothing forged reaches it', async () => {
    const res = await proxy(req('/admin/users', { [VERIFIED_USER_HEADER]: VICTIM, [VERIFIED_USER_SIG_HEADER]: 'forged' }))
    expect([307, 308]).toContain(res.status)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('the legitimate public routes keep working (no redirect to /login)', async () => {
    for (const p of ['/api/health', '/api/intake/webhook/whatsapp', '/csat/abc', '/approve/abc']) {
      const res = await proxy(req(p))
      expect(res.headers.get('location'), p).toBeNull()
    }
  })
})

describe('getCurrentProfile / events route trust: only a header the proxy signed is believed', () => {
  const headers = (o: Record<string, string>) => new Headers(o)

  it('forged id with no signature is ignored (caller must check the session)', () => {
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: VICTIM }))).toBeUndefined()
  })
  it('forged id with a made-up signature is ignored', () => {
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: VICTIM, [VERIFIED_USER_SIG_HEADER]: 'a'.repeat(64) }))).toBeUndefined()
  })
  it('a real signature for a DIFFERENT user cannot be reused for the victim', () => {
    const mine = '99999999-2222-3333-4444-555555555555'
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: VICTIM, [VERIFIED_USER_SIG_HEADER]: signVerifiedUser(mine)! }))).toBeUndefined()
  })
  it('the proxy-signed header is believed', () => {
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: VICTIM, [VERIFIED_USER_SIG_HEADER]: signVerifiedUser(VICTIM)! }))).toBe(VICTIM)
  })
  it('a signed "signed out" marker reads as null (trusted: nobody is signed in)', () => {
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: '', [VERIFIED_USER_SIG_HEADER]: signVerifiedUser('')! }))).toBeNull()
  })
  it('no headers at all: nothing trusted', () => {
    expect(readVerifiedUserId(headers({}))).toBeUndefined()
  })
  it('a signed-out marker is not accepted when its signature belongs to a real user (cannot downgrade/upgrade)', () => {
    expect(readVerifiedUserId(headers({ [VERIFIED_USER_HEADER]: '', [VERIFIED_USER_SIG_HEADER]: signVerifiedUser(VICTIM)! }))).toBeUndefined()
  })
})
