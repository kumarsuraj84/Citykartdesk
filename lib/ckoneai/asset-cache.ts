// A small in-memory copy of the assistant page's FIXED files, kept by the CK Desk server.
//
// Why: the assistant (CKOneAI, on another machine) sometimes answers slowly for a few seconds, and its page files are among the slow answers (a 400 KB script took 8.7 s on 21 Nov 2026,
// a 4 KB one 2.8 s). Those files never change once published: their names carry a fingerprint (index-BsNCApvY.js, styles-yU0SCtz1.css) and the assistant itself marks them "immutable".
// So after the first load, CK Desk answers them from its own memory and the assistant is not asked again. Only these fingerprinted files are kept; the page itself (/ckoneai-ui) and every
// API answer (questions, answers, history, health) are never kept.
//
// Safe by construction: only GET, only a fingerprinted name under /ckoneai-ui/assets/, only a 200 answer of a file type (script, style, font, image), at most 2 MB each and 16 MB in all
// (oldest dropped first), forgotten after 6 hours. The sign-in and pilot-list checks still run before a copy is handed out.

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024
export const TTL_MS = 6 * 60 * 60 * 1000

// name-<fingerprint of 8 or more letters/digits>.<type>, directly under /ckoneai-ui/assets/, no query
const FINGERPRINTED = /^\/ckoneai-ui\/assets\/[A-Za-z0-9_.]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|gif|ico)$/
const FILE_TYPES = /^(?:text\/javascript|application\/javascript|text\/css|font\/|application\/font|image\/)/i

/** Is this request one whose answer may be kept? */
export function isCacheableAsset(method: string, path: string, search: string): boolean {
  return method.toUpperCase() === 'GET' && search === '' && FINGERPRINTED.test(path)
}

/** May this answer from the assistant be kept? (a good answer, a known file type, small enough) */
export function mayKeep(status: number, contentType: string | null, contentLength: number | null): boolean {
  if (status !== 200) return false
  if (!contentType || !FILE_TYPES.test(contentType)) return false
  if (contentLength !== null && contentLength > MAX_FILE_BYTES) return false
  return true
}

export interface CachedAsset {
  body: Uint8Array
  /** only the headers worth repeating: content-type, etag, last-modified, cache-control */
  headers: Record<string, string>
  at: number
}

export class AssetCache {
  private items = new Map<string, CachedAsset>()
  private bytes = 0

  get(key: string, now: number = Date.now()): CachedAsset | null {
    const e = this.items.get(key)
    if (!e) return null
    if (now - e.at > TTL_MS) { this.delete(key); return null }
    return e
  }

  set(key: string, entry: CachedAsset): boolean {
    if (entry.body.byteLength > MAX_FILE_BYTES) return false
    this.delete(key)
    this.items.set(key, entry)
    this.bytes += entry.body.byteLength
    // drop the oldest until it fits (a Map keeps insertion order)
    while (this.bytes > MAX_TOTAL_BYTES) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined || oldest === key) break
      this.delete(oldest)
    }
    return true
  }

  clear(): void { this.items.clear(); this.bytes = 0 }
  get size(): number { return this.items.size }
  get totalBytes(): number { return this.bytes }

  private delete(key: string): void {
    const e = this.items.get(key)
    if (e) { this.bytes -= e.body.byteLength; this.items.delete(key) }
  }
}

/** One cache per server process. */
export const assetCache = new AssetCache()
