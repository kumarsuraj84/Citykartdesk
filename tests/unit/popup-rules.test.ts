import { describe, it, expect } from 'vitest'
import { popupDecision, parsePrefs, requestIdFromPath, withTitleBadge, DEFAULT_PREFS, POPUP_MAX_AGE_MS, type PopupNotification } from '@/lib/notifications/popup-rules'

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0)
const REQ = '123e4567-e89b-12d3-a456-426614174000'
const n = (o: Partial<PopupNotification> = {}): PopupNotification => ({
  id: 'n1', type: 'comment_added', title: 't', body: 'b', link: '/requests/x', request_id: REQ, metadata: null,
  created_at: new Date(NOW - 5_000).toISOString(), actor_name: 'Ayush', ...o,
})
const ctx = { openRequestId: null as string | null, nowMs: NOW }

describe('which notifications pop up', () => {
  it('shows the useful events, and keeps quiet ones in the bell', () => {
    for (const type of ['request_assigned', 'comment_added', 'mentioned', 'approval_requested', 'sla_breached', 'request_reopened']) {
      expect(popupDecision(n({ type }), DEFAULT_PREFS, ctx).show, type).toBe(true)
    }
    for (const type of ['daily_digest', 'request_auto_closed', 'priority_changed', 'status_changed', 'request_closed', 'request_created']) {
      expect(popupDecision(n({ type }), DEFAULT_PREFS, ctx).show, type).toBe(false)
    }
  })

  it('marks approvals, SLA alerts, reminders (nudge), low ratings and reopens as important', () => {
    for (const type of ['approval_requested', 'sla_breached', 'sla_warning', 'csat_low_rating', 'request_reopened']) {
      expect(popupDecision(n({ type }), DEFAULT_PREFS, ctx)).toEqual({ show: true, important: true })
    }
    expect(popupDecision(n({ type: 'comment_added' }), DEFAULT_PREFS, ctx)).toEqual({ show: true, important: false })
  })

  it('"important only" and "off" are respected', () => {
    expect(popupDecision(n({ type: 'comment_added' }), { mode: 'important', sound: false }, ctx).show).toBe(false)
    expect(popupDecision(n({ type: 'sla_breached' }), { mode: 'important', sound: false }, ctx).show).toBe(true)
    expect(popupDecision(n({ type: 'sla_breached' }), { mode: 'off', sound: false }, ctx).show).toBe(false)
  })

  it('never pops up something old, a team-wide broadcast, or a change on the ticket already open', () => {
    expect(popupDecision(n({ created_at: new Date(NOW - POPUP_MAX_AGE_MS - 1000).toISOString() }), DEFAULT_PREFS, ctx).show).toBe(false)
    expect(popupDecision(n({ type: 'request_assigned', metadata: { audience: 'team' } }), DEFAULT_PREFS, ctx).show).toBe(false)
    expect(popupDecision(n(), DEFAULT_PREFS, { ...ctx, openRequestId: REQ }).show).toBe(false)
    // an important one is still shown on the open ticket, and other tickets are unaffected
    expect(popupDecision(n({ type: 'sla_breached' }), DEFAULT_PREFS, { ...ctx, openRequestId: REQ }).show).toBe(true)
    expect(popupDecision(n(), DEFAULT_PREFS, { ...ctx, openRequestId: '00000000-0000-0000-0000-000000000000' }).show).toBe(true)
  })
})

describe('settings, open ticket and tab title', () => {
  it('reads the saved choice safely', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{"mode":"important","sound":true}')).toEqual({ mode: 'important', sound: true })
    expect(parsePrefs('{"mode":"weird","sound":"yes"}')).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.sound).toBe(false) // sound is opt-in
  })

  it('finds the open ticket from the address', () => {
    expect(requestIdFromPath(`/requests/${REQ}`)).toBe(REQ)
    expect(requestIdFromPath(`/requests/${REQ}/anything`)).toBe(REQ)
    expect(requestIdFromPath('/requests/queue')).toBeNull()
    expect(requestIdFromPath('/home')).toBeNull()
  })

  it('puts the unread count in the tab title and takes it out again', () => {
    expect(withTitleBadge('Citykart Desk', 3)).toBe('(3) Citykart Desk')
    expect(withTitleBadge('(3) Citykart Desk', 5)).toBe('(5) Citykart Desk')
    expect(withTitleBadge('(5) Citykart Desk', 0)).toBe('Citykart Desk')
    expect(withTitleBadge('Citykart Desk', 150)).toBe('(99+) Citykart Desk')
  })
})
