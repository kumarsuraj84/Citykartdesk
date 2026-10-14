import { describe, it, expect } from 'vitest'
import { PUBLIC_ACTION_BODY_LIMIT, publicActionBodyTooLarge } from '@/lib/http/public-body-limit'

const h = (o: Record<string, string>) => new Headers(o)
const action = (len?: number) => h({ 'next-action': 'abc', ...(len === undefined ? {} : { 'content-length': String(len) }) })

describe('body size on public pages (D-039)', () => {
  it('refuses a large server-action post to the login, reset, approve and rating pages', () => {
    for (const p of ['/login', '/forgot-password', '/reset-password', '/auth/callback', '/approve/abc.def', '/csat/xyz'])
      expect(publicActionBodyTooLarge('POST', p, action(PUBLIC_ACTION_BODY_LIMIT + 1)), p).toBe(true)
  })
  it('accepts ordinary small forms there', () => {
    for (const p of ['/login', '/approve/abc.def', '/csat/xyz']) expect(publicActionBodyTooLarge('POST', p, action(2_000)), p).toBe(false)
    expect(publicActionBodyTooLarge('POST', '/login', action(PUBLIC_ACTION_BODY_LIMIT))).toBe(false)
  })
  it('refuses a body whose size is not declared (so it cannot be streamed past the check)', () => {
    expect(publicActionBodyTooLarge('POST', '/login', action())).toBe(true)
    expect(publicActionBodyTooLarge('POST', '/login', action(NaN as unknown as number))).toBe(true)
  })
  it('does not touch signed-in pages (attachments), other methods, or requests that are not server actions', () => {
    expect(publicActionBodyTooLarge('POST', '/requests/1', action(25_000_000))).toBe(false)
    expect(publicActionBodyTooLarge('GET', '/login', action(25_000_000))).toBe(false)
    expect(publicActionBodyTooLarge('POST', '/login', h({ 'content-length': '25000000' }))).toBe(false)
    expect(publicActionBodyTooLarge('POST', '/loginx', action(25_000_000))).toBe(false)
  })
})

describe('the proxy applies it before anything else (D-039)', () => {
  it('answers 413 to a large server-action post on the login page, and lets a small one through', async () => {
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('@/proxy')
    const big = new NextRequest(new URL('/login', 'http://localhost:3210'), { method: 'POST', headers: { 'next-action': 'x', 'content-length': String(PUBLIC_ACTION_BODY_LIMIT + 1) } })
    expect((await proxy(big)).status).toBe(413)
    const small = new NextRequest(new URL('/approve/abc.def', 'http://localhost:3210'), { method: 'POST', headers: { 'next-action': 'x', 'content-length': '500' } })
    expect((await proxy(small)).status).not.toBe(413)
  })
})
