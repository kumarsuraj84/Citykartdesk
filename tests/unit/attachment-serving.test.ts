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
// the file is now fetched from the storage service as a stream (G-24): the storage service is replaced by a recorder, no network is touched
const BODY = '<script>alert(1)</script>'
vi.stubGlobal('fetch', async (url: string) => {
  downloaded.push(decodeURIComponent(String(url).split('/object/authenticated/')[1]))
  return new Response(BODY, { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(BODY.length) } })
})

const RID = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
const get = async (headers: Record<string, string> = {}) => (await import('@/app/api/storage/attachment/request/[id]/route')).GET(new Request('http://x', { headers }), { params: Promise.resolve({ id: 'att1' }) })

describe('the attachment download route', () => {
  beforeEach(() => { downloaded.length = 0; vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-test-0123456789') })

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
  it('the body is passed on with its length, and nothing about type or caching changes (G-24)', async () => {
    row = { storage_path: `${RID}/1_a_note.txt`, request_id: RID, file_name: 'note.txt', mime_type: 'text/plain', deleted_at: null }
    const res = await get()
    expect(res.headers.get('content-length')).toBe(String(BODY.length))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.text()).toBe(BODY)
    expect(downloaded).toEqual([`request-attachments/${RID}/1_a_note.txt`])
  })
  it('a single byte range is answered with 206 and only those bytes, even when the storage service ignores Range', async () => {
    row = { storage_path: `${RID}/1_a_clip.mp4`, request_id: RID, file_name: 'clip.mp4', mime_type: 'video/mp4', deleted_at: null }
    const res = await get({ range: 'bytes=3-8' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 3-8/${BODY.length}`)
    expect(res.headers.get('content-length')).toBe('6')
    expect(await res.text()).toBe(BODY.slice(3, 9))
    expect((await get({ range: 'bytes=999-' })).status).toBe(416)
  })
  it('a deleted attachment is not served', async () => {
    row = { storage_path: `${RID}/1_a_x.pdf`, request_id: RID, file_name: 'x.pdf', mime_type: 'application/pdf', deleted_at: '2026-01-01' }
    expect((await get()).status).toBe(404)
  })
})

import { parseSingleRange } from '@/lib/attachments/stream'
describe('parseSingleRange', () => {
  it('reads one bytes range and clamps it to the file', () => {
    expect(parseSingleRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseSingleRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseSingleRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseSingleRange('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 })
  })
  it('sends everything for no header, other units, several ranges or a malformed range', () => {
    for (const h of [null, undefined, '', 'items=0-1', 'bytes=0-1,5-6', 'bytes=-', 'bytes=9-3', 'garbage']) expect(parseSingleRange(h as string, 1000), String(h)).toBeNull()
  })
  it('a range outside the file is unsatisfiable (416)', () => {
    expect(parseSingleRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseSingleRange('bytes=-0', 1000)).toBe('unsatisfiable')
    expect(parseSingleRange('bytes=0-5', 0)).toBe('unsatisfiable')
  })
})
