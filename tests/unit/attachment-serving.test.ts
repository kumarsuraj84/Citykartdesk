// D-053 / D-054 / SEC-D-12: what type an attachment is served as, whether it opens in the browser, and which file a row may point at.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contentDisposition, contentTypeForFileName, pathBelongsToRequest } from '@/lib/attachments/serve'

describe('contentTypeForFileName', () => {
  it('uses the extension table, case-insensitively', () => {
    expect(contentTypeForFileName('Photo.JPG')).toBe('image/jpeg')
    expect(contentTypeForFileName('a.pdf')).toBe('application/pdf')
    expect(contentTypeForFileName('notes.txt')).toBe('text/plain; charset=utf-8')
  })
  it('anything unknown or dangerous is an opaque download, never html or svg', () => {
    for (const n of ['x.html', 'x.htm', 'x.svg', 'x.js', 'x.xhtml', 'noext', 'x.exe']) expect(contentTypeForFileName(n), n).toBe('application/octet-stream')
  })
})

describe('contentDisposition', () => {
  it('images, PDF and text open in the browser; everything else downloads', () => {
    expect(contentDisposition('a.png', 'image/png')).toMatch(/^inline;/)
    expect(contentDisposition('a.pdf', 'application/pdf')).toMatch(/^inline;/)
    expect(contentDisposition('a.xlsx', contentTypeForFileName('a.xlsx'))).toMatch(/^attachment;/)
    expect(contentDisposition('x.html', 'application/octet-stream')).toMatch(/^attachment;/)
  })
  it('a non-ASCII file name is sent in the standard encoded form and cannot break out of the header', () => {
    const h = contentDisposition('रिपोर्ट "final"\r\nX-Evil: 1.pdf', 'application/pdf')
    expect(h).toContain("filename*=UTF-8''")
    expect(h).not.toMatch(/[\r\n]/)
    expect(h.split(';')[1]).not.toContain('"final"')
  })
})

describe('pathBelongsToRequest', () => {
  const id = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
  it('accepts a file in the request own folder only', () => {
    expect(pathBelongsToRequest(`${id}/17_ab_report.pdf`, id)).toBe(true)
    expect(pathBelongsToRequest(`other-id/17_ab_report.pdf`, id)).toBe(false)
    expect(pathBelongsToRequest(`${id}/../other/x.pdf`, id)).toBe(false)
    expect(pathBelongsToRequest(`${id}//x.pdf`, id)).toBe(false)
    expect(pathBelongsToRequest('', id)).toBe(false)
  })
})

// ── the route ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let row: Record<string, unknown> | null = null
const downloaded: string[] = []
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: async (p: string) => { downloaded.push(p); return { data: new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), error: null } } }) } }) }))

const RID = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
const get = async () => (await import('@/app/api/storage/attachment/request/[id]/route')).GET(new Request('http://x'), { params: Promise.resolve({ id: 'att1' }) })

describe('the attachment download route', () => {
  beforeEach(() => { downloaded.length = 0 })

  it('a row whose stored type was rewritten to text/html is still served as its extension says, with nosniff', async () => {
    row = { storage_path: `${RID}/1_a_note.txt`, request_id: RID, file_name: 'note.txt', mime_type: 'text/html', deleted_at: null }
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('a file called .html downloads as an opaque attachment', async () => {
    row = { storage_path: `${RID}/1_a_x.html`, request_id: RID, file_name: 'x.html', mime_type: 'image/png', deleted_at: null }
    const res = await get()
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })
  it('a row pointing at another request file is not served and storage is not touched', async () => {
    row = { storage_path: '99999999-0000-0000-0000-000000000000/1_a_secret.pdf', request_id: RID, file_name: 'secret.pdf', mime_type: 'application/pdf', deleted_at: null }
    const res = await get()
    expect(res.status).toBe(404)
    expect(downloaded).toEqual([])
  })
  it('a deleted attachment is not served', async () => {
    row = { storage_path: `${RID}/1_a_x.pdf`, request_id: RID, file_name: 'x.pdf', mime_type: 'application/pdf', deleted_at: '2026-01-01' }
    expect((await get()).status).toBe(404)
  })
})
