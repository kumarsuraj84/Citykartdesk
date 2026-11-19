/**
 * What to do when the browser cannot load a page file ("Loading chunk ... failed"): after a new version is released, a tab that was left open asks for files of the
 * OLD version. One reload fixes it. But a browser that keeps failing (a cached page, a bad connection) used to reload every 10 seconds for hours: the system log held
 * 1,507 such errors from ONE person on 3 Nov and 576 from another on 2 Nov. Now there are at most MAX_RELOADS reloads in WINDOW_MS; after that the person is told what
 * to do (press Ctrl+F5) instead of the page reloading and logging forever. Pure, so it can be tested.
 */
export const MAX_RELOADS = 2
export const WINDOW_MS = 10 * 60_000

export function isChunkLoadError(message: string | undefined | null): boolean {
  if (!message) return false
  return /Loading chunk .* failed|ChunkLoadError|Failed to fetch dynamically imported module/i.test(message)
}

/** `history` = the times (ms) of the reloads done so far. Returns whether to reload now, and the history to keep. */
export function decideReload(history: readonly number[], now: number): { reload: boolean; history: number[] } {
  const recent = history.filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_RELOADS) return { reload: false, history: recent }
  return { reload: true, history: [...recent, now] }
}

const KEY = 'ck-chunk-reload-history'

export function readHistory(): number[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((n) => typeof n === 'number') : []
  } catch { return [] }
}

export function writeHistory(h: number[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(h)) } catch { /* private mode: the in-page limit below still applies */ }
}

/** Reloads the page unless the limit is used up. Returns true when it reloaded (or is about to), false when the person has to be asked to press Ctrl+F5. */
export function reloadForChunkError(now: number = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  const d = decideReload(readHistory(), now)
  writeHistory(d.history)
  if (d.reload) reload()
  return d.reload
}
