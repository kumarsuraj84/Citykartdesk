import { describe, it, expect } from 'vitest'
import { groupErrors, buildClaudeBundle, trimStack, type LogRowLite } from '@/lib/syslog/bundle'

const row = (id: number, extra: Partial<LogRowLite> = {}): LogRowLite => ({
  id, created_at: `2026-10-14T00:0${id % 10}:00.000Z`, category: 'error', source: 'database', severity: 'error', outcome: 'failure', action: 'database.http_500',
  message: 'GET h/rest/v1/requests -> 500: canceling statement due to statement timeout', error_code: '57014', stack: null, fingerprint: 'fp-timeout', path: '/requests',
  method: 'GET', request_id: `req-${id}`, actor_role: 'manager', from_click: false, click_target: null, detail: null, ...extra,
})

describe('groupErrors', () => {
  it('groups by fingerprint with counts, first / last seen, pages, roles and click attribution; serious and frequent first', () => {
    const g = groupErrors([
      row(1), row(2, { path: '/home', actor_role: 'admin', from_click: true, click_target: 'button:Refresh' }), row(3),
      row(4, { fingerprint: 'fp-warn', severity: 'warning', error_code: '429', action: 'integration.http_429', source: 'integration' }),
      row(5, { fingerprint: 'fp-crit', severity: 'critical', action: 'process.uncaughtException', source: 'process', error_code: 'TypeError' }),
    ])
    expect(g.map((x) => x.fingerprint)).toEqual(['fp-crit', 'fp-timeout', 'fp-warn'])      // critical, then error (3×), then warning
    const t = g.find((x) => x.fingerprint === 'fp-timeout')!
    expect(t).toMatchObject({ count: 3, firstSeen: '2026-10-14T00:01:00.000Z', lastSeen: '2026-10-14T00:03:00.000Z', clickCount: 1, sampleId: 3 })
    expect(t.paths).toEqual(['/requests', '/home']); expect(t.roles).toEqual(['manager', 'admin']); expect(t.clickTargets).toEqual(['button:Refresh'])
  })
  it('rows without a fingerprint still group by source, action and code; the limit applies', () => {
    const g = groupErrors([row(1, { fingerprint: null }), row(2, { fingerprint: null }), row(3, { fingerprint: null, action: 'other' })], 1)
    expect(g).toHaveLength(1); expect(g[0].count).toBe(2)
  })
})

describe('trimStack', () => {
  it('drops framework frames and keeps the first lines, redacted', () => {
    const s = trimStack('Error: boom for a@b.com\n at app (lib/x.ts:1:1)\n at next (node_modules/next/dist/server.js:1:1)\n at node:internal/process\n at y (lib/y.ts:2:2)', 5)
    expect(s).toBe('Error: boom for [email]\n at app (lib/x.ts:1:1)\n at y (lib/y.ts:2:2)')
    expect(trimStack(null)).toBe('')
  })
})

describe('buildClaudeBundle', () => {
  const base = { generatedAt: new Date('2026-10-14T06:00:00Z'), windowDays: 7, appVersion: '20261014-063000', filtersText: 'severity ≥ error', totalRows: 12 }
  it('is a readable markdown report with no personal data or secrets, and says whether a click caused it', () => {
    const groups = groupErrors([
      row(1, { message: 'mail to suraj@citykart.org failed with Bearer abcdef1234567890xyz', stack: 'Error: x\n at f (lib/a.ts:1:1)', from_click: true, click_target: 'button:Send' }),
      row(2, { fingerprint: 'fp-bg', source: 'cron', action: 'cron.job_failed', message: 'alerts: HTTP 502', from_click: false, path: null }),
    ])
    const md = buildClaudeBundle({ ...base, groups })
    expect(md).toContain('# Citykart Desk — error report')
    expect(md).toContain('App build: 20261014-063000')
    expect(md).toContain('Followed a click: 1 of 1 (e.g. button:Send)')
    expect(md).toContain('Not caused by a click (background, scheduled or external)')
    expect(md).toContain('at f (lib/a.ts:1:1)')
    expect(md).not.toContain('suraj@citykart.org'); expect(md).not.toContain('abcdef1234567890xyz')
    expect(md).toContain('[email]')
  })
  it('limits how many problems it shows, and handles an empty result', () => {
    const many = groupErrors(Array.from({ length: 30 }, (_, i) => row(i + 1, { fingerprint: `fp-${i}`, message: `problem ${i}` })))
    const md = buildClaudeBundle({ ...base, groups: many, maxGroups: 5 })
    expect(md).toContain('(showing the 5 most serious)')
    expect((md.match(/^## \d+\./gm) ?? []).length).toBe(5)
    expect(buildClaudeBundle({ ...base, groups: [], totalRows: 0 })).toContain('No errors match.')
  })
})
