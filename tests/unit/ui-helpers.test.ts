import { describe, it, expect } from 'vitest'
import { pruneSelection, runWithLimit } from '@/lib/ui/bulk'
import { normalizePhoneInput } from '@/lib/ui/phone'
import { formatDate, formatDateAndTime, formatDayMonth } from '@/lib/ui/formatDate'
import { nextRefreshDelay, autoRefreshAllowed, AUTO_REFRESH_BASE_MS, AUTO_REFRESH_MAX_MS, pushBusy, isBusy } from '@/lib/ui/busy'
import { tabTrapTarget } from '@/components/ui/useModalA11y'

describe('pruneSelection', () => {
  it('keeps the same Set when every ticked row is still shown', () => {
    const s = new Set(['a', 'b'])
    expect(pruneSelection(s, ['a', 'b', 'c'])).toBe(s)
  })
  it('drops rows that are no longer shown but keeps the others', () => {
    expect([...pruneSelection(new Set(['a', 'b']), ['b', 'c'])]).toEqual(['b'])
  })
  it('empties the selection for a completely new page of rows', () => {
    expect(pruneSelection(new Set(['a']), ['x', 'y']).size).toBe(0)
  })
})

describe('runWithLimit', () => {
  it('runs everything, keeps order and turns a thrown task into a failed result', async () => {
    let running = 0
    let peak = 0
    const res = await runWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++; peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      if (n === 3) throw new Error('boom')
      return n * 10
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(res.map((r) => r.ok)).toEqual([true, true, false, true, true])
    expect(res[0].ok && res[0].value).toBe(10)
  })
})

describe('normalizePhoneInput', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['91 98765 43210', '9876543210'],
    ['0 98765 43210', '9876543210'],
    ['098765-43210', '9876543210'],
    ['0091 98765 43210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['98765abc', '98765'],
    ['91', '91'],
    ['', ''],
  ])('%s -> %s', (input, out) => {
    expect(normalizePhoneInput(input)).toBe(out)
  })
  it('still cuts an over-long number that has no recognisable prefix to 10 digits', () => {
    expect(normalizePhoneInput('12345678901234')).toBe('1234567890')
  })
})

describe('formatDate helpers (always India time)', () => {
  it('uses Asia/Kolkata whatever the computer zone is', () => {
    // 20:00 UTC on 31 Dec is already 1:30 on 1 Jan in India
    expect(formatDate('2025-12-31T20:00:00Z')).toBe('Jan 1, 2026')
    expect(formatDayMonth('2025-12-31T20:00:00Z')).toBe('Jan 1')
    expect(formatDateAndTime('2025-12-31T20:00:00Z')).toContain('Jan 1, 2026')
  })
  it('gives the fallback for empty or invalid values', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date', 'n/a')).toBe('n/a')
  })
})

describe('auto refresh rules', () => {
  it('waits 30 seconds (with a little spread) and doubles after failures up to the cap', () => {
    expect(nextRefreshDelay(0, 0.5)).toBe(AUTO_REFRESH_BASE_MS)
    expect(nextRefreshDelay(1, 0.5)).toBe(AUTO_REFRESH_BASE_MS * 2)
    expect(nextRefreshDelay(20, 0.5)).toBe(AUTO_REFRESH_MAX_MS)
    expect(nextRefreshDelay(0, 0)).toBe(Math.round(AUTO_REFRESH_BASE_MS * 0.8))
    expect(nextRefreshDelay(0, 1)).toBe(Math.round(AUTO_REFRESH_BASE_MS * 1.2))
  })
  it('is switched off on heavy pages but not on the ticket pages', () => {
    expect(autoRefreshAllowed('/dashboards/executive')).toBe(false)
    expect(autoRefreshAllowed('/intake/inbox')).toBe(false)
    expect(autoRefreshAllowed('/admin/users')).toBe(false)
    expect(autoRefreshAllowed('/requests')).toBe(true)
    expect(autoRefreshAllowed('/requests/queue')).toBe(true)
    expect(autoRefreshAllowed('/intake')).toBe(true)
  })
  it('the busy signal counts holders and ignores a double release', () => {
    expect(isBusy()).toBe(false)
    const a = pushBusy()
    const b = pushBusy()
    a(); a()
    expect(isBusy()).toBe(true)
    b()
    expect(isBusy()).toBe(false)
  })
})

describe('tabTrapTarget (keeps Tab inside a dialog)', () => {
  const items = ['first', 'middle', 'last']
  it('wraps from the last to the first, and from the first back to the last with Shift', () => {
    expect(tabTrapTarget(items, 'last', false, true)).toBe('first')
    expect(tabTrapTarget(items, 'first', true, true)).toBe('last')
  })
  it('lets the browser move focus when it stays inside', () => {
    expect(tabTrapTarget(items, 'middle', false, true)).toBeNull()
    expect(tabTrapTarget(items, 'first', false, true)).toBeNull()
  })
  it('pulls focus in when it is outside the dialog', () => {
    expect(tabTrapTarget(items, null, false, false)).toBe('first')
    expect(tabTrapTarget(items, null, true, false)).toBe('last')
  })
  it('does nothing when the dialog has nothing to focus', () => {
    expect(tabTrapTarget([], null, false, false)).toBeNull()
  })
})

import { formatDateOnly } from '@/lib/ui/formatDate'
describe('formatDateOnly', () => {
  it('shows the exact calendar day', () => {
    expect(formatDateOnly('2026-01-05')).toBe('Jan 5, 2026')
    expect(formatDateOnly('2026-01-05', { year: false })).toBe('Jan 5')
    expect(formatDateOnly('2026-12-31T00:00:00+00:00')).toBe('Dec 31, 2026')
  })
  it('gives the fallback for empty or odd values', () => {
    expect(formatDateOnly(null)).toBe('—')
    expect(formatDateOnly('soon', undefined, 'n/a')).toBe('n/a')
  })
})

import { parseRequestTab } from '@/lib/ui/requestTabs'
import { labelFor } from '@/components/EventTracker'
describe('parseRequestTab', () => {
  it('opens the tab named in the address', () => {
    expect(parseRequestTab('history', { showApprovals: false })).toBe('history')
    expect(parseRequestTab('approvals', { showApprovals: true })).toBe('approvals')
  })
  it('falls back to Conversations for anything unknown, empty, or not allowed', () => {
    expect(parseRequestTab('approvals', { showApprovals: false })).toBe('conversations')
    expect(parseRequestTab('nonsense', { showApprovals: true })).toBe('conversations')
    expect(parseRequestTab(undefined, { showApprovals: true })).toBe('conversations')
    expect(parseRequestTab(['tasks', 'history'], { showApprovals: true })).toBe('tasks')
  })
})

// labelFor needs only a tiny stand-in for a page element
const el = (tag: string, attrs: Record<string, string>) => ({ tagName: tag.toUpperCase(), getAttribute: (n: string) => attrs[n] ?? null }) as unknown as Element
describe('EventTracker labelFor (no names, no query strings)', () => {
  it('prefers data-track, then aria-label', () => {
    expect(labelFor(el('button', { 'data-track': 'bulk-assign', 'aria-label': 'x' }))).toBe('button:bulk-assign')
    expect(labelFor(el('button', { 'aria-label': 'Close' }))).toBe('button:Close')
  })
  it('drops the query string, the fragment and ids from a link address', () => {
    expect(labelFor(el('a', { href: '/requests/4f9c1e2a-1b2c-4d3e-8f90-1234567890ab?from=%2Frequests%2Fqueue%3Fq%3DJohn' }))).toBe('a:/requests/:id')
    expect(labelFor(el('a', { href: '/x?q=secret#top' }))).toBe('a:/x')
  })
  it('never uses the visible text', () => {
    expect(labelFor(el('button', {}))).toBe('button')
    expect(labelFor(el('input', { type: 'checkbox' }))).toBe('input[checkbox]')
  })
})

import { containsPattern } from '@/lib/ui/likePattern'
describe('containsPattern (search box -> ilike)', () => {
  it('wraps plain words', () => {
    expect(containsPattern('  router ')).toBe('%router%')
  })
  it('removes characters that would break the filter text', () => {
    expect(containsPattern('a,b(c)"d\\e')).toBe('%abcde%')
  })
  it('makes % and _ match only themselves', () => {
    expect(containsPattern('50%_off')).toBe('%50\\%\\_off%')
  })
})

import { safely, NETWORK_ERROR_MESSAGE } from '@/lib/ui/safeAction'
describe('safely (a thrown server action becomes an error answer)', () => {
  it('passes a normal answer through', async () => {
    expect(await safely(async () => ({ data: 1 } as { data: number; error?: string }))).toEqual({ data: 1 })
  })
  it('turns a thrown error into { error }', async () => {
    const out = await safely<{ error?: string }>(async () => { throw new Error('fetch failed') })
    expect(out).toEqual({ error: NETWORK_ERROR_MESSAGE })
  })
})
