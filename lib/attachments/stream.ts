// Hands a stored file to the browser WITHOUT first reading the whole file into the server's memory (audit G-24).
// The storage client's download() always builds a complete Blob; a 25 MB video opened by ten people at once was 250 MB of memory, and the
// browser could not skip ahead in audio or video. Here the file is fetched from the storage service as a stream and passed on as it
// arrives, with its Content-Length, and a single byte range ("Range: bytes=...") is answered with 206 Partial Content.
// Access checks, the content-type table and the security headers stay in the routes that call this; this file only moves bytes.

const FETCH_HEADERS_MS = 20_000

export type RangeSpec = { start: number; end: number }

/**
 * Reads a Range header for a file of `size` bytes. Returns the first..last byte (inclusive) to send, 'unsatisfiable' when the range lies outside the file
 * (the answer is 416), or null when the whole file should be sent (no header, not a bytes range, or several ranges at once, which are simply ignored).
 */
export function parseSingleRange(header: string | null | undefined, size: number): RangeSpec | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null                              // other units, or several ranges (a comma): send everything
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {                                  // "the last n bytes"
    const n = Number(b)
    if (!(n > 0) || size === 0) return 'unsatisfiable'
    return { start: Math.max(size - n, 0), end: size - 1 }
  }
  const start = Number(a)
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  if (b !== '' && Number(b) < start) return null   // a malformed range is ignored, as the standard says
  if (start >= size) return 'unsatisfiable'
  return { start, end }
}

/** Only a header that is one plain bytes range is passed on to the storage service. */
const forwardableRange = (h: string | null | undefined) => (h && /^bytes=\d*-\d*$/.test(h.trim()) ? h.trim() : null)

export type StoredFile =
  | { kind: 'ok'; res: Response }
  | { kind: 'missing' }          // the storage service answered "no such file" (any 4xx)
  | { kind: 'unavailable' }      // it did not answer, or answered 5xx

/** Opens a file of a private bucket with the server's own (service) key. The caller has already decided that this person may see it. */
export async function openStoredFile(bucket: string, path: string, rangeHeader?: string | null): Promise<StoredFile> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!base || !key) return { kind: 'unavailable' }
  const url = `${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const range = forwardableRange(rangeHeader)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_HEADERS_MS)   // only until the answer starts: a long download must not be cut off
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key, ...(range ? { Range: range } : {}) }, signal: controller.signal, cache: 'no-store' })
    if (res.status === 416) return { kind: 'ok', res }
    if (res.status >= 500) { await res.body?.cancel().catch(() => {}); return { kind: 'unavailable' } }
    if (!res.ok || !res.body) { await res.body?.cancel().catch(() => {}); return { kind: 'missing' } }
    return { kind: 'ok', res }
  } catch {
    return { kind: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

/** The part of a stream from byte `start` to byte `end` (inclusive), for a storage service that ignored the Range header. */
export function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let pos = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) { controller.close(); return }
        const from = pos
        pos += value.byteLength
        if (pos <= start) continue                                   // still before the wanted part
        if (from > end) { await reader.cancel().catch(() => {}); controller.close(); return }
        controller.enqueue(value.subarray(Math.max(start - from, 0), Math.min(end - from + 1, value.byteLength)))
        if (pos > end) { await reader.cancel().catch(() => {}); controller.close() }
        return
      }
    },
    cancel(reason) { return reader.cancel(reason) },
  })
}

/**
 * The response to send for an opened file: status 200 with the whole file, or 206 / 416 for a range. `headers` are the caller's own (type, disposition,
 * nosniff, cache) and are always sent unchanged.
 */
export function fileResponse(file: Response, headers: Record<string, string>, rangeHeader?: string | null): Response {
  const out = new Headers(headers)
  out.set('Accept-Ranges', 'bytes')
  const encoded = !!file.headers.get('content-encoding')   // the body was decoded on the way: the announced length is not the length we pass on
  const total = (() => {
    if (encoded) return null
    const cr = /\/(\d+)\s*$/.exec(file.headers.get('content-range') ?? '')
    if (file.status === 206 && cr) return Number(cr[1])
    const cl = file.headers.get('content-length')
    return cl !== null && /^\d+$/.test(cl) ? Number(cl) : null
  })()

  if (file.status === 416) {
    if (total !== null) out.set('Content-Range', `bytes */${total}`)
    return new Response(null, { status: 416, headers: out })
  }
  if (file.status === 206) {                                         // the storage service did the range itself
    const cr = file.headers.get('content-range'), cl = file.headers.get('content-length')
    if (cr) out.set('Content-Range', cr)
    if (cl) out.set('Content-Length', cl)
    return new Response(file.body, { status: 206, headers: out })
  }
  const wanted = forwardableRange(rangeHeader) && total !== null ? parseSingleRange(rangeHeader, total) : null
  if (wanted === 'unsatisfiable') {
    void file.body?.cancel().catch(() => {})
    out.set('Content-Range', `bytes */${total}`)
    return new Response(null, { status: 416, headers: out })
  }
  if (wanted && file.body) {                                         // it ignored the Range header: cut the part out here
    out.set('Content-Range', `bytes ${wanted.start}-${wanted.end}/${total}`)
    out.set('Content-Length', String(wanted.end - wanted.start + 1))
    return new Response(sliceStream(file.body, wanted.start, wanted.end), { status: 206, headers: out })
  }
  if (total !== null) out.set('Content-Length', String(total))
  return new Response(file.body, { status: 200, headers: out })
}
