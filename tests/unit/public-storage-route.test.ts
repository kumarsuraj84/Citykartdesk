// D-051 / SEC-39: the public storage route must validate the requested path before the elevated storage client is used.
// Isolated test: the storage client is replaced by a recorder, so NOTHING here touches any network, database or storage service.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const downloads: string[] = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        download: async (p: string) => {
          downloads.push(`${bucket}:${p}`)
          return { data: new Blob(['x'], { type: 'text/html' }), error: null }
        },
      }),
    },
  }),
}))

import { GET } from '@/app/api/storage/public/[bucket]/[...path]/route'
import { safePublicStoragePath } from '@/lib/storage/publicPath'

const UUID = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
const call = (bucket: string, path: string[]) => GET(new Request('http://localhost/x'), { params: Promise.resolve({ bucket, path }) })

beforeEach(() => { downloads.length = 0 })

describe('the route only serves the exact file shapes the app uploads', () => {
  it('serves a real icon and a real avatar, with a content type taken from the extension and nosniff', async () => {
    const icon = await call('icons', [`${UUID}.png`])
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png') // the stored object claimed text/html; the claim is ignored
    expect(icon.headers.get('x-content-type-options')).toBe('nosniff')
    const avatar = await call('avatars', [UUID, 'avatar.jpg'])
    expect(avatar.status).toBe(200)
    expect(avatar.headers.get('content-type')).toBe('image/jpeg')
    expect(downloads).toEqual([`icons:${UUID}.png`, `avatars:${UUID}/avatar.jpg`])
  })

  const bad: [string, string[]][] = [
    ['icons', ['..', '..', '..', '..', 'rest', 'v1', 'profiles']],
    ['icons', ['..%2f..%2f..%2frest%2fv1%2fprofiles']],
    ['icons', ['%2e%2e', '%2e%2e', 'x']],
    ['icons', ['..']],
    ['icons', ['.']],
    ['icons', ['']],
    ['icons', []],
    ['icons', [`${UUID}.png`, 'extra']],
    ['icons', ['a/b.png']],
    ['icons', ['a\\b.png']],
    ['icons', [`${UUID}.png?x=1`]],
    ['icons', [`${UUID}.png#x`]],
    ['icons', [`${UUID}.svg`]],
    ['icons', [`${UUID}.html`]],
    ['icons', [`${UUID}.png\u0000.html`]],
    ['icons', ['not-a-uuid.png']],
    ['avatars', ['..', 'avatar.png']],
    ['avatars', [UUID, '..', 'avatar.png']],
    ['avatars', [UUID, 'other.png']],
    ['avatars', [`${UUID}.png`]],
    ['request-attachments', [`${UUID}.png`]],
    ['unknown', [`${UUID}.png`]],
  ]
  for (const [bucket, path] of bad) {
    it(`refuses ${bucket}/${JSON.stringify(path)} without touching storage`, async () => {
      const res = await call(bucket, path)
      expect(res.status).toBe(404)
      expect(downloads).toEqual([])
    })
  }
})

describe('safePublicStoragePath', () => {
  it('accepts only the two upload shapes (case-insensitive extension)', () => {
    expect(safePublicStoragePath('icons', [`${UUID}.WEBP`])).toBe(`${UUID}.WEBP`)
    expect(safePublicStoragePath('avatars', [UUID, 'avatar.gif'])).toBe(`${UUID}/avatar.gif`)
    expect(safePublicStoragePath('icons', [UUID, 'avatar.png'])).toBeNull()
  })
})

describe('why validation is needed: the storage library does not protect the path (analysis only, no network)', () => {
  it('a path with dot-segments is placed into the request URL unencoded, so it resolves outside the bucket folder', async () => {
    const seen: string[] = []
    const client = createClient('http://storage.invalid', 'anon-key', {
      auth: { persistSession: false },
      global: { fetch: (async (url: RequestInfo | URL) => { seen.push(String(url)); return new Response('', { status: 404 }) }) as typeof fetch },
    })
    await client.storage.from('icons').download('../../../../rest/v1/profiles')
    expect(seen).toHaveLength(1)
    // the library kept the dot-segments, and URL resolution (done by fetch) would collapse them onto another path of the same host
    expect(seen[0]).toContain('/../')
    expect(new URL(seen[0]).pathname.startsWith('/storage/v1/object/icons/')).toBe(false)
  })
})
