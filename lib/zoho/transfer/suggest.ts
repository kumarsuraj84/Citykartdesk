/**
 * Suggestions for the mapping screens: a best guess that the administrator can accept or change. Nothing here is ever saved by itself.
 * No database and no server-only import, so the screens can use it too.
 */

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'system', 'only', 'log', 'issue', 'issues', 'team', 'admin'])

export function words(text: string | null | undefined): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0)
}

/** 0..1: how alike two names are. Equal words count fully, a word that contains the other (ac / acs) counts half. */
export function nameScore(a: string | null | undefined, b: string | null | undefined): number {
  const wa = words(a).filter((w) => !STOP.has(w))
  const wb = words(b).filter((w) => !STOP.has(w))
  if (wa.length === 0 || wb.length === 0) return 0
  if (wa.join(' ') === wb.join(' ')) return 1
  let hit = 0
  for (const x of wa) {
    if (wb.includes(x)) hit += 1
    else if (wb.some((y) => (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y)))) hit += 0.5
  }
  return hit / Math.max(wa.length, wb.length)
}

/** The option whose name is closest to `name`, or null when nothing is close enough to be worth suggesting. */
export function bestMatch<T extends { id: string; name: string }>(name: string | null | undefined, options: T[], minScore = 0.5): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const o of options) {
    const s = nameScore(name, o.name)
    if (s > bestScore) { best = o; bestScore = s }
  }
  return best && bestScore >= minScore ? best : null
}

/** The CK Desk status a Zoho status most likely becomes (the owner confirms it on the screen). */
export function suggestStatus(zohoStatus: string | null | undefined): string | null {
  const s = String(zohoStatus ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'closed') return 'closed'
  if (s === 'resolved' || s === 'completed') return 'resolved'
  if (s === 'reject' || s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s.includes('purchase')) return 'hold_purchase_ho'
  if (s.includes('approval')) return 'pending_approval'
  if (s.includes('requester') || s.includes('user') || s.includes('information')) return 'waiting_user'
  if (s.startsWith('on hold') || s.includes('hold')) return 'waiting_user'
  if (s === 'open' || s === 'new') return 'open'
  if (s.includes('process') || s.includes('progress') || s.includes('oem') || s.includes('vendor')) return 'in_progress'
  if (s === 'assigned') return 'assigned'
  return null
}

/** The CK Desk statuses a Zoho ticket can be given, in the words people use. */
export const CK_STATUSES: { value: string; label: string; finished: boolean }[] = [
  { value: 'open', label: 'Open', finished: false },
  { value: 'assigned', label: 'Assigned', finished: false },
  { value: 'in_progress', label: 'In progress', finished: false },
  { value: 'waiting_user', label: 'Waiting for the requester', finished: false },
  { value: 'pending_approval', label: 'Waiting for approval', finished: false },
  { value: 'hold_purchase_ho', label: 'On hold - purchase from HO', finished: false },
  { value: 'resolved', label: 'Resolved', finished: true },
  { value: 'closed', label: 'Closed', finished: true },
  { value: 'cancelled', label: 'Cancelled', finished: true },
]
export const ckStatusLabel = (v: string | null | undefined) => CK_STATUSES.find((s) => s.value === v)?.label ?? (v ?? '')
export const isFinishedCkStatus = (v: string | null | undefined) => !!CK_STATUSES.find((s) => s.value === v)?.finished
