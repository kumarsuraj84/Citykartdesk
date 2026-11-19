// Which notifications pop up in the corner of the screen, and which stay in the bell only. Pure (no browser or database), so the
// rules are easy to test; the component that shows the cards is components/layout/NotificationPopups.tsx.

export type PopupMode = 'all' | 'important' | 'off'

export interface PopupPrefs {
  mode: PopupMode
  sound: boolean
}

/** Each person's own choice, kept in their browser (see PopupSettings on the profile page). */
export const DEFAULT_PREFS: PopupPrefs = { mode: 'all', sound: false }
export const PREFS_KEY = 'ck-popup-prefs'

/** A pop-up shows only for something that happened in the last few minutes, never for old unread items on login. */
export const POPUP_MAX_AGE_MS = 10 * 60_000
/** A normal pop-up goes away by itself after this long; an important one stays until it is dismissed. */
export const NORMAL_DURATION_MS = 8_000
/** At most this many cards for one check; anything beyond is summarised in one card. */
export const MAX_CARDS_PER_CHECK = 3

/**
 * How often an open tab asks the server whether something new has arrived. 60 s visible (was 20 s) and 5 min hidden (was 2 min): with 1,000+ people and 2,000+ devices
 * the 20 s check alone would have been ~100 requests a second, about 40 times today's whole peak (capacity review of 19 Nov 2026). A new notification now shows within
 * a minute; the pop-up still accepts anything up to POPUP_MAX_AGE_MS old, so nothing is missed. A tab nobody looks at is also checked the moment the person comes back to it.
 */
export const POLL_VISIBLE_MS = 60_000
export const POLL_HIDDEN_MS = 300_000
/** Coming back to a tab checks at once, but never more often than this, so switching tabs again and again cannot flood the server. */
export const MIN_GAP_BETWEEN_CHECKS_MS = 10_000
/** Every wait is spread by +-20 % so that devices which were all opened together (a morning start, a release) do not keep asking at the very same second. `random` is 0..1 (0.5 gives exactly `baseMs`). */
export const POLL_JITTER = 0.2
export function pollDelayMs(baseMs: number, random: number = Math.random()): number {
  return Math.round(baseMs * (1 - POLL_JITTER + 2 * POLL_JITTER * random))
}

/** Asks for attention: stays until dismissed. */
export const IMPORTANT_TYPES: ReadonlySet<string> = new Set([
  'approval_requested', 'sla_breached', 'sla_warning', 'csat_low_rating', 'request_reopened',
])

/** Worth a short pop-up. Quiet events (digests, auto-closed, priority or status changes...) are left to the bell. */
export const NORMAL_TYPES: ReadonlySet<string> = new Set([
  'request_assigned', 'request_reassigned', 'comment_added', 'internal_note_added', 'mentioned',
  'approval_approved', 'approval_rejected', 'approval_decided', 'request_resolved', 'collaborator_added',
  'task_assigned', 'business_rule_notification',
])

export interface PopupNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  request_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  actor_name: string | null
}

export function parsePrefs(raw: string | null | undefined): PopupPrefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const v = JSON.parse(raw) as Partial<PopupPrefs>
    return {
      mode: v.mode === 'important' || v.mode === 'off' || v.mode === 'all' ? v.mode : DEFAULT_PREFS.mode,
      sound: typeof v.sound === 'boolean' ? v.sound : DEFAULT_PREFS.sound,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/** "/requests/<id>/..." -> the ticket the person has open right now. */
export function requestIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/requests\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname ?? '')
  return m ? m[1].toLowerCase() : null
}

export function isImportant(n: Pick<PopupNotification, 'type'> & { metadata?: PopupNotification['metadata'] }): boolean {
  // a notification of an ordinary type can still ask for attention (a vendor's quote waiting for a PO decision is a "status_changed" message)
  return IMPORTANT_TYPES.has(n.type) || (n.metadata as { popup?: string } | null | undefined)?.popup === 'important'
}

export function popupDecision(
  n: PopupNotification,
  prefs: PopupPrefs,
  ctx: { openRequestId: string | null; nowMs: number },
): { show: boolean; important: boolean } {
  const important = isImportant(n)
  const no = { show: false, important }
  if (prefs.mode === 'off') return no
  if (!important && !NORMAL_TYPES.has(n.type)) return no
  if (prefs.mode === 'important' && !important) return no
  // "a new request in the team queue" goes to every team member: bell only
  if (n.metadata && (n.metadata as { audience?: string }).audience === 'team') return no
  if (ctx.nowMs - new Date(n.created_at).getTime() > POPUP_MAX_AGE_MS) return no
  // already looking at that ticket: the page shows the change itself
  if (!important && n.request_id && ctx.openRequestId && n.request_id.toLowerCase() === ctx.openRequestId) return no
  return { show: true, important }
}

/** The "(3) " in the tab title, so a waiting notification is noticed from another tab. */
export function withTitleBadge(title: string, unread: number): string {
  const bare = title.replace(/^\(\d+\+?\)\s/, '')
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${bare}` : bare
}

export function loadPrefs(): PopupPrefs {
  try { return parsePrefs(window.localStorage.getItem(PREFS_KEY)) } catch { return DEFAULT_PREFS }
}
export function savePrefs(p: PopupPrefs): void {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private window: the choice just is not remembered */ }
}
