// A small in-memory cache for expensive dashboard reads (audit D-040 / D-041). Three properties matter:
//  * the data may be at most `ttlMs` old, which is stated where it is used and kept short;
//  * identical loads that arrive together share ONE query (single flight), so a burst of managers opening dashboards costs the database once;
//  * a failed load is never kept, and every caller gets its own copy, so one request changing the rows cannot change what another sees.
// The key MUST contain everything that decides what the viewer may see (organization, scope, role level): never share a key between viewers
// who could see different rows. It lives in the server process (a restart empties it), which is fine for a cache.

interface Entry<T> { at: number; value?: T; pending?: Promise<T> }

export interface ShortCache<T> {
  /** The cached value for `key`, or the result of `load()` (stored for `ttlMs`). `fresh` skips the stored value but still shares a load already running. */
  get(key: string, load: () => Promise<T>, opts?: { fresh?: boolean }): Promise<T>
  clear(): void
  size(): number
}

export function createShortCache<T>(ttlMs: number, maxEntries = 100, clone: (v: T) => T = (v) => structuredClone(v)): ShortCache<T> {
  const entries = new Map<string, Entry<T>>()

  const trim = (now: number) => {
    for (const [k, e] of entries) if (!e.pending && now - e.at >= ttlMs) entries.delete(k)
    while (entries.size > maxEntries) { const oldest = entries.keys().next().value; if (oldest === undefined) break; entries.delete(oldest) }
  }

  return {
    async get(key, load, opts) {
      // test suites change data and read it straight back, so the stored value is bypassed there (the cache itself is unit-tested with SHORT_CACHE_IN_TESTS=1)
      const bypass = opts?.fresh || (process.env.VITEST !== undefined && process.env.SHORT_CACHE_IN_TESTS !== '1')
      const now = Date.now()
      const hit = entries.get(key)
      if (hit?.pending) return clone(await hit.pending)
      if (hit && hit.value !== undefined && !bypass && now - hit.at < ttlMs) return clone(hit.value)

      const entry: Entry<T> = { at: now }
      entry.pending = load().then(
        (value) => { entry.value = value; entry.at = Date.now(); entry.pending = undefined; return value },
        (err) => { if (entries.get(key) === entry) entries.delete(key); throw err },
      )
      entries.set(key, entry)
      trim(now)
      return clone(await entry.pending)
    },
    clear() { entries.clear() },
    size() { return entries.size },
  }
}
