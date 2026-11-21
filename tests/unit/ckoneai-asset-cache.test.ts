import { describe, expect, it, beforeEach } from 'vitest'
import { AssetCache, MAX_FILE_BYTES, MAX_TOTAL_BYTES, TTL_MS, isCacheableAsset, mayKeep } from '@/lib/ckoneai/asset-cache'

describe('which requests may be answered from a kept copy', () => {
  it.each([
    '/ckoneai-ui/assets/index-BsNCApvY.js',
    '/ckoneai-ui/assets/styles-yU0SCtz1.css',
    '/ckoneai-ui/assets/routes-fn3Nqg6z.js',
    '/ckoneai-ui/assets/format-D7mFlTvq.js',
    '/ckoneai-ui/assets/logo-AbCd1234.svg',
    '/ckoneai-ui/assets/inter-latin-QwErTy12.woff2',
  ])('keeps %s', (p) => { expect(isCacheableAsset('GET', p, '')).toBe(true) })

  it.each([
    ['GET', '/ckoneai-ui', ''],                                     // the page itself
    ['GET', '/ckoneai-ui/', ''],
    ['GET', '/ckoneai-ui/assets/app-1.js', ''],                     // no fingerprint
    ['GET', '/ckoneai-ui/assets/index.js', ''],
    ['GET', '/ckoneai-ui/assets/index-short.js', ''],               // fingerprint shorter than 8
    ['GET', '/ckoneai-ui/index-BsNCApvY.js', ''],                   // not under assets
    ['GET', '/ckoneai-ui/assets/index-BsNCApvY.html', ''],          // not a file type that is kept
    ['GET', '/ckoneai-ui/assets/index-BsNCApvY.js', '?v=2'],        // any query: not kept
    ['HEAD', '/ckoneai-ui/assets/index-BsNCApvY.js', ''],
    ['POST', '/ckoneai-ui/assets/index-BsNCApvY.js', ''],
    ['GET', '/api/ckoneai/health', ''],                             // never an API answer
    ['GET', '/api/ckoneai/conversations', ''],
    ['GET', '/ckoneai-ui/assets/../secret-AbCdEf12.js', ''],
  ])('does not keep %s %s%s', (m, p, q) => { expect(isCacheableAsset(m, p, q)).toBe(false) })
})

describe('which answers may be kept', () => {
  it('a good answer of a file type, small enough', () => {
    expect(mayKeep(200, 'text/javascript; charset=utf-8', 403_810)).toBe(true)
    expect(mayKeep(200, 'text/css; charset=utf-8', null)).toBe(true)
    expect(mayKeep(200, 'image/svg+xml', 1000)).toBe(true)
    expect(mayKeep(200, 'font/woff2', 1000)).toBe(true)
  })
  it('never an error, an html page, json, or something too big', () => {
    expect(mayKeep(404, 'text/javascript', 10)).toBe(false)
    expect(mayKeep(500, 'text/css', 10)).toBe(false)
    expect(mayKeep(304, 'text/css', 10)).toBe(false)
    expect(mayKeep(200, 'text/html', 10)).toBe(false)
    expect(mayKeep(200, 'application/json', 10)).toBe(false)
    expect(mayKeep(200, null, 10)).toBe(false)
    expect(mayKeep(200, 'text/javascript', MAX_FILE_BYTES + 1)).toBe(false)
  })
})

describe('the kept copies', () => {
  let c: AssetCache
  const entry = (n: number, at = Date.now()) => ({ body: new Uint8Array(n), headers: { 'content-type': 'text/javascript' }, at })
  beforeEach(() => { c = new AssetCache() })

  it('hands back what it was given, and nothing it was not', () => {
    expect(c.get('/a')).toBeNull()
    c.set('/a', entry(10))
    expect(c.get('/a')?.body.byteLength).toBe(10)
    expect(c.get('/b')).toBeNull()
  })

  it('forgets a copy after six hours', () => {
    const t0 = 1_000_000
    c.set('/a', entry(10, t0))
    expect(c.get('/a', t0 + TTL_MS - 1)).not.toBeNull()
    expect(c.get('/a', t0 + TTL_MS + 1)).toBeNull()
    expect(c.size).toBe(0)
    expect(c.totalBytes).toBe(0)
  })

  it('refuses a file over the limit and keeps the totals right when one is replaced', () => {
    expect(c.set('/big', entry(MAX_FILE_BYTES + 1))).toBe(false)
    expect(c.size).toBe(0)
    c.set('/a', entry(100)); c.set('/a', entry(40))
    expect(c.size).toBe(1)
    expect(c.totalBytes).toBe(40)
  })

  it('drops the oldest copies first when the total would pass the limit', () => {
    const each = MAX_FILE_BYTES            // 2 MB
    const fit = Math.floor(MAX_TOTAL_BYTES / each)
    for (let i = 0; i < fit; i++) c.set(`/f${i}`, entry(each))
    expect(c.size).toBe(fit)
    c.set('/new', entry(each))
    expect(c.get('/f0')).toBeNull()        // the oldest is gone
    expect(c.get('/new')).not.toBeNull()   // the newest stays
    expect(c.totalBytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
})
