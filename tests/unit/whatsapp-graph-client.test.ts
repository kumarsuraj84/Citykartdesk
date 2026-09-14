import { describe, it, expect, vi } from 'vitest'
import { WhatsAppGraphClient } from '@/lib/whatsapp/graph-client'

const SECRET_TOKEN = 'super-secret-token-should-never-leak'

function client(fetchImpl: typeof fetch) {
  return new WhatsAppGraphClient('phone-123', SECRET_TOKEN, 'v23.0', fetchImpl)
}

describe('Stage 5 — Meta Graph API client (Step 34, outbound HTTP boundary mocked)', () => {
  it('sendMessage: success returns the Meta message id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.out.1' }] }), { status: 200 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result).toEqual({ ok: true, messageId: 'wamid.out.1' })
  })

  it('sendMessage: sends the Authorization bearer header and posts to the versioned messages endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'x' }] }), { status: 200 })) as unknown as typeof fetch
    await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v23.0/phone-123/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET_TOKEN}`)
  })

  it('sendMessage: classifies 401 as auth', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth token' } }), { status: 401 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result).toEqual({ ok: false, errorClass: 'auth', status: 401, message: 'Invalid OAuth token' })
  })

  it('sendMessage: classifies 403 as auth', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorClass).toBe('auth')
  })

  it('sendMessage: classifies 429 (rate limit) as retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorClass).toBe('retryable')
  })

  it('sendMessage: classifies a 5xx as retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Internal error' } }), { status: 503 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorClass).toBe('retryable')
  })

  it('sendMessage: classifies a generic 400 as non_retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorClass).toBe('non_retryable')
  })

  it('sendMessage: a malformed (non-JSON) success response is treated as non_retryable, not a crash', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result.ok).toBe(false)
  })

  it('sendMessage: a network failure (fetch throws) is classified retryable, never throws out', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(result).toEqual({ ok: false, errorClass: 'retryable', status: 0, message: 'ECONNRESET' })
  })

  it('never includes the access token anywhere in a returned error message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth token' } }), { status: 401 })) as unknown as typeof fetch
    const result = await client(fetchImpl).sendMessage('919876543210', { type: 'text', text: { body: 'hi' } })
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN)
  })

  it('getMediaUrl: success returns url/mimeType/size', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ url: 'https://x/media', mime_type: 'image/jpeg', file_size: 1234, sha256: 'abc' }), { status: 200 })) as unknown as typeof fetch
    const result = await client(fetchImpl).getMediaUrl('media-1')
    expect(result).toEqual({ ok: true, url: 'https://x/media', mimeType: 'image/jpeg', sha256: 'abc', fileSize: 1234 })
  })

  it('getMediaUrl: failure is classified the same way as sendMessage', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 })) as unknown as typeof fetch
    const result = await client(fetchImpl).getMediaUrl('media-missing')
    expect(result).toEqual({ ok: false, errorClass: 'non_retryable', status: 404, message: 'Not found' })
  })

  it('downloadMedia: returns the raw buffer and content-type on success', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch
    const result = await client(fetchImpl).downloadMedia('https://x/media')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Buffer.from(result.buffer)).toEqual(Buffer.from([1, 2, 3]))
      expect(result.contentType).toBe('image/png')
    }
  })

  it('testConnection: success returns the display phone number without sending any message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ display_phone_number: '+911234567890' }), { status: 200 })) as unknown as typeof fetch
    const result = await client(fetchImpl).testConnection()
    // Stage 6 Part 1 also reads back verified_name (previously requested in
    // the `fields` param but never parsed from the response) — this fixture
    // doesn't return one, so it resolves to null, not simply absent.
    expect(result).toEqual({ ok: true, displayPhoneNumber: '+911234567890', verifiedName: null })
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain('/messages')
  })

  it('testConnection: success also returns verified_name when Meta includes it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ display_phone_number: '+911234567890', verified_name: 'Citykart Support' }), { status: 200 })) as unknown as typeof fetch
    const result = await client(fetchImpl).testConnection()
    expect(result).toEqual({ ok: true, displayPhoneNumber: '+911234567890', verifiedName: 'Citykart Support' })
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('fields=display_phone_number,verified_name')
  })

  it('testConnection: failure surfaces Meta\'s own error message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid access token' } }), { status: 401 })) as unknown as typeof fetch
    const result = await client(fetchImpl).testConnection()
    expect(result).toEqual({ ok: false, message: 'Invalid access token' })
  })
})
