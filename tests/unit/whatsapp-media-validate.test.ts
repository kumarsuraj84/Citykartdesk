import { describe, it, expect } from 'vitest'
import { WhatsAppGraphClient } from '@/lib/whatsapp/graph-client'
import { retrieveAndValidateMedia } from '@/lib/whatsapp/media'

// A minimal real JPEG/PNG header — enough for the magic-byte check, not a
// full valid image (this stage validates bytes-match-declared-type, not
// that the file fully decodes).
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const NOT_A_JPEG = Buffer.from('this is plain text, not a jpeg')

function clientWithMedia(mediaId: string, meta: { mimeType?: string; fileSize?: number } | null, body: Buffer, downloadStatus = 200) {
  const fetchImpl = (async (url: string | URL) => {
    const u = url.toString()
    if (u.endsWith(`/${mediaId}`)) {
      if (!meta) return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
      return new Response(JSON.stringify({ url: 'https://mock/media-download', mime_type: meta.mimeType, file_size: meta.fileSize, sha256: 'x' }), { status: 200 })
    }
    if (u === 'https://mock/media-download') return new Response(new Uint8Array(body), { status: downloadStatus })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
  return new WhatsAppGraphClient('phone-1', 'token', 'v23.0', fetchImpl)
}

describe('Stage 5 — WhatsApp media retrieval + validation (Step 10)', () => {
  it('accepts a JPEG whose bytes match its declared MIME type', async () => {
    const client = clientWithMedia('m1', { mimeType: 'image/jpeg' }, JPEG_HEADER)
    const result = await retrieveAndValidateMedia(client, 'm1')
    expect(result).toEqual({ ok: true, buffer: JPEG_HEADER, mimeType: 'image/jpeg', size: JPEG_HEADER.length })
  })

  it('accepts a PNG whose bytes match its declared MIME type', async () => {
    const client = clientWithMedia('m2', { mimeType: 'image/png' }, PNG_HEADER)
    const result = await retrieveAndValidateMedia(client, 'm2')
    expect(result.ok).toBe(true)
  })

  it('rejects content whose bytes do NOT match the declared type (spoofed MIME)', async () => {
    const client = clientWithMedia('m3', { mimeType: 'image/jpeg' }, NOT_A_JPEG)
    const result = await retrieveAndValidateMedia(client, 'm3')
    expect(result).toEqual({ ok: false, reason: 'content_mismatch', message: expect.any(String) })
  })

  it('rejects a disallowed MIME type outright, before ever downloading', async () => {
    const client = clientWithMedia('m4', { mimeType: 'application/x-msdownload' }, Buffer.from('exe'))
    const result = await retrieveAndValidateMedia(client, 'm4')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('disallowed_type')
  })

  it('rejects a file whose declared size exceeds the 25MB limit before downloading', async () => {
    const client = clientWithMedia('m5', { mimeType: 'image/jpeg', fileSize: 26 * 1024 * 1024 }, JPEG_HEADER)
    const result = await retrieveAndValidateMedia(client, 'm5')
    expect(result).toEqual({ ok: false, reason: 'too_large', message: expect.any(String) })
  })

  it('returns lookup_failed when the media id no longer exists on Meta', async () => {
    const client = clientWithMedia('missing', null, Buffer.alloc(0))
    const result = await retrieveAndValidateMedia(client, 'missing')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('lookup_failed')
  })

  it('returns download_failed when the media URL itself errors', async () => {
    const client = clientWithMedia('m6', { mimeType: 'image/jpeg' }, JPEG_HEADER, 500)
    const result = await retrieveAndValidateMedia(client, 'm6')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('download_failed')
  })

  it('allows a type with no known magic-byte signature (e.g. plain text) through the byte check, still gated by the allowlist', async () => {
    const client = clientWithMedia('m7', { mimeType: 'text/plain' }, Buffer.from('hello world'))
    const result = await retrieveAndValidateMedia(client, 'm7')
    expect(result.ok).toBe(true)
  })
})
