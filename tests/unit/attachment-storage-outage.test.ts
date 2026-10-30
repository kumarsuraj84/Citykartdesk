// QA-D017: while the file storage service is down, opening an attachment answered "404 not found" (after 20 seconds). The file is not missing, the store is unavailable:
// that must be a 503 so the person (and the browser) can tell, and retry later. A really missing file stays 404.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// the storage service is replaced by a fake answer: a status, or a thrown error for "unreachable" (the file is now streamed from it, G-24)
let storageAnswer: { status: number } | { throws: true } = { status: 200 }
const REQ = '11111111-1111-1111-1111-111111111111'
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_path: `${REQ}/a.pdf`, file_name: 'a.pdf', mime_type: 'application/pdf', deleted_at: null, request_id: REQ }, error: null }) }) }) }) }),
}))
vi.stubGlobal('fetch', async () => {
  if ('throws' in storageAnswer) throw new TypeError('fetch failed')
  return new Response(storageAnswer.status === 200 ? 'x' : '{"error":"x"}', { status: storageAnswer.status })
})

async function call() {
  const { GET } = await import('@/app/api/storage/attachment/request/[id]/route')
  return GET(new Request('http://x/api'), { params: Promise.resolve({ id: 'att-1' }) })
}
beforeEach(() => { storageAnswer = { status: 200 }; vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-test-0123456789') })

describe('attachment download when the file storage is down', () => {
  it('a normal download works', async () => { expect((await call()).status).toBe(200) })
  it('a file that really is not there stays 404', async () => {
    storageAnswer = { status: 404 }
    expect((await call()).status).toBe(404)
  })
  it('an unreachable storage service is 503, not 404', async () => {
    storageAnswer = { throws: true }
    expect((await call()).status).toBe(503)
  })
  it('a 5xx from the storage service is 503', async () => {
    storageAnswer = { status: 502 }
    expect((await call()).status).toBe(503)
  })
})
