// QA-D017: while the file storage service is down, opening an attachment answered "404 not found" (after 20 seconds). The file is not missing, the store is unavailable:
// that must be a 503 so the person (and the browser) can tell, and retry later. A really missing file stays 404.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let downloadResult: { data: unknown; error: { name?: string; status?: number; message?: string } | null } = { data: null, error: null }
const REQ = '11111111-1111-1111-1111-111111111111'
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_path: `${REQ}/a.pdf`, file_name: 'a.pdf', mime_type: 'application/pdf', deleted_at: null, request_id: REQ }, error: null }) }) }) }) }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: async () => downloadResult }) } }) }))

async function call() {
  const { GET } = await import('@/app/api/storage/attachment/request/[id]/route')
  return GET(new Request('http://x/api'), { params: Promise.resolve({ id: 'att-1' }) })
}
beforeEach(() => { downloadResult = { data: new Blob(['x']), error: null } })

describe('attachment download when the file storage is down', () => {
  it('a normal download works', async () => { expect((await call()).status).toBe(200) })
  it('a file that really is not there stays 404', async () => {
    downloadResult = { data: null, error: { name: 'StorageApiError', status: 404, message: 'Object not found' } }
    expect((await call()).status).toBe(404)
  })
  it('an unreachable storage service is 503, not 404', async () => {
    downloadResult = { data: null, error: { name: 'StorageUnknownError', message: 'fetch failed' } }
    expect((await call()).status).toBe(503)
  })
  it('a 5xx from the storage service is 503', async () => {
    downloadResult = { data: null, error: { name: 'StorageApiError', status: 502, message: 'Bad gateway' } }
    expect((await call()).status).toBe(503)
  })
})
