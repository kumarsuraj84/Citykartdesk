'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { markNotificationRead } from '@/lib/actions/notifications'
import {
  MAX_CARDS_PER_CHECK, NORMAL_DURATION_MS, loadPrefs, popupDecision, requestIdFromPath, withTitleBadge,
  type PopupNotification,
} from '@/lib/notifications/popup-rules'
import { PopupCard } from './PopupCard'

const POLL_VISIBLE_MS = 8_000
const POLL_HIDDEN_MS = 30_000
const SHOWN_KEEP = 200

function readJson<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window */ }
}

/** A short two-note chime made in the browser (no sound file). Browsers may refuse until the page has been clicked once. */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tone = (freq: number, at: number) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28)
      osc.connect(gain); gain.connect(ctx.destination); osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.3)
    }
    tone(880, 0); tone(1175, 0.16)
    window.setTimeout(() => void ctx.close(), 900)
  } catch { /* no sound, no problem */ }
}

/**
 * Pop-ups in the bottom-right corner when a new notification arrives, so people do not have to watch the bell.
 * Asks a tiny endpoint every few seconds (only while the tab is open and visible, slowly otherwise), never shows an old
 * unread item, shows each notification once even with several tabs open, and obeys the person's own settings
 * (lib/notifications/popup-rules.ts). Renders nothing itself; the cards are shown through the app's toaster.
 */
export function NotificationPopups({ viewerId }: { viewerId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  useEffect(() => { pathRef.current = pathname }, [pathname])

  useEffect(() => {
    const sinceKey = `ck-popup-since:${viewerId}`
    const shownKey = `ck-popup-shown:${viewerId}`
    let since: string = readJson<string | null>(sinceKey, null) ?? new Date().toISOString()
    let stopped = false
    let timer: number | undefined

    // each notification is claimed once per browser, so two open tabs never both pop it up
    const claim = async (id: string): Promise<boolean> => {
      const take = () => {
        const seen = readJson<string[]>(shownKey, [])
        if (seen.includes(id)) return false
        writeJson(shownKey, [...seen, id].slice(-SHOWN_KEEP))
        return true
      }
      const locks = (navigator as Navigator & { locks?: { request: <T>(name: string, cb: () => T) => Promise<T> } }).locks
      return locks ? locks.request('ck-popup-claim', take) : take()
    }

    const open = (n: PopupNotification, toastId: string | number) => {
      toast.dismiss(toastId)
      void markNotificationRead(n.id).catch(() => {})
      router.push(n.link || (n.request_id ? `/requests/${n.request_id}?tab=conversations` : '/notifications'))
    }

    const present = async (items: PopupNotification[]) => {
      const prefs = loadPrefs()
      const ctx = { openRequestId: requestIdFromPath(pathRef.current), nowMs: Date.now() }
      const toShow: { n: PopupNotification; important: boolean }[] = []
      for (const n of items) {
        const d = popupDecision(n, prefs, ctx)
        if (d.show && (await claim(n.id))) toShow.push({ n, important: d.important })
      }
      if (toShow.length === 0) return
      // newest cards win; the rest are folded into one summary so a burst never floods the screen
      const cards = toShow.slice(-MAX_CARDS_PER_CHECK)
      const folded = toShow.length - cards.length
      if (folded > 0) {
        toast.custom((tid) => (
          <button type="button" onClick={() => { toast.dismiss(tid); router.push('/notifications') }}
            className="w-[340px] rounded-xl border border-border bg-card px-3 py-2 text-left text-xs font-medium text-primary shadow-lg">
            +{folded} more notification{folded > 1 ? 's' : ''} - open the list
          </button>
        ), { id: `popup-more-${Date.now()}`, duration: NORMAL_DURATION_MS })
      }
      for (const { n, important } of cards) {
        toast.custom((tid) => (
          <PopupCard n={n} important={important} durationMs={NORMAL_DURATION_MS} onOpen={() => open(n, tid)} onClose={() => toast.dismiss(tid)} />
        ), { id: `popup-${n.id}`, duration: important ? Infinity : NORMAL_DURATION_MS })
      }
      if (prefs.sound) playChime()
    }

    const poll = async () => {
      if (stopped) return
      const hidden = document.hidden
      try {
        // a hidden tab only refreshes the number in the tab title; what happened meanwhile is shown when the tab is back
        const res = await fetch(hidden ? '/api/notifications/new' : `/api/notifications/new?since=${encodeURIComponent(since)}`, { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as { now: string; items: PopupNotification[]; unread: number }
          document.title = withTitleBadge(document.title, data.unread)
          if (!hidden) {
            since = data.now
            writeJson(sinceKey, since)
            await present(data.items)
          }
        }
      } catch { /* offline or the server is restarting: try again next time */ }
      if (!stopped) timer = window.setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)
    }

    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void poll() } }
    document.addEventListener('visibilitychange', onVisible)
    timer = window.setTimeout(poll, 1500)
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [viewerId, router])

  return null
}
