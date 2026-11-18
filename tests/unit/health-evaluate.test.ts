import { describe, it, expect } from 'vitest'
import { isNotApplicable, decideIncident, levelOf, overallStatus, humanMinutes, zohoSyncVerdict, sheetsVerdict, emailVerdict, weatherVerdict, uptimeText } from '@/lib/health/evaluate'
import { canSeeHealth } from '@/lib/health/access'
import { CHECKS, INCIDENT_AFTER } from '@/lib/health/catalog'

const now = new Date('2026-11-18T10:00:00Z').getTime()
const s = (ok: boolean, minAgo = 0) => ({ ok, at: new Date(now - minAgo * 60_000).toISOString() })

describe('who may see Health & Performance', () => {
  it('only a platform owner', () => {
    expect(canSeeHealth('platform_owner')).toBe(true)
    for (const r of ['admin', 'manager', 'agent', 'user', 'technician', '', null, undefined]) expect(canSeeHealth(r as never), String(r)).toBe(false)
  })
})

describe('outages (incidents)', () => {
  it('opens after three failed checks in a row, not after one or two', () => {
    expect(INCIDENT_AFTER).toBe(3)
    expect(decideIncident([s(false), s(true, 1)], false)).toBe('none')
    expect(decideIncident([s(false), s(false, 1)], false)).toBe('none')
    expect(decideIncident([s(false), s(false, 1), s(false, 2)], false)).toBe('open')
    expect(decideIncident([s(false), s(false, 1), s(true, 2)], false)).toBe('none')
  })
  it('stays open while failing and closes at the first good answer', () => {
    expect(decideIncident([s(false), s(false, 1), s(false, 2), s(false, 3)], true)).toBe('none')
    expect(decideIncident([s(true), s(false, 1), s(false, 2)], true)).toBe('close')
    expect(decideIncident([], true)).toBe('none')
  })
})

describe('the state of a check right now', () => {
  it('good, down, or no data when the probe has stopped', () => {
    expect(levelOf(s(true, 1), now)).toBe('good')
    expect(levelOf(s(false, 1), now)).toBe('down')
    expect(levelOf(s(true, 30), now)).toBe('nodata')       // an old "good" is not good
    expect(levelOf(null, now)).toBe('nodata')
  })
  it('overall: a core check down = down; a late sync or missing data = degraded; else healthy', () => {
    expect(overallStatus([{ group: 'core', level: 'good' }, { group: 'sync', level: 'good' }])).toBe('healthy')
    expect(overallStatus([{ group: 'core', level: 'down' }, { group: 'sync', level: 'good' }])).toBe('down')
    expect(overallStatus([{ group: 'core', level: 'good' }, { group: 'sync', level: 'down' }])).toBe('degraded')
    expect(overallStatus([{ group: 'core', level: 'good' }, { group: 'core', level: 'nodata' }])).toBe('degraded')
    expect(overallStatus([])).toBe('unknown')
  })
})

describe('a check that does not apply right now', () => {
  it('is "not in use" only when the app\'s own collector is alive; a dead collector or a probe check is still a problem', () => {
    expect(isNotApplicable('app', 'nodata', true)).toBe(true)
    expect(isNotApplicable('app', 'nodata', false)).toBe(false)   // the collector itself stopped
    expect(isNotApplicable('probe', 'nodata', true)).toBe(false)  // the probe's checks always have an answer
    expect(isNotApplicable('app', 'down', true)).toBe(false)
    expect(isNotApplicable('app', 'good', true)).toBe(false)
  })
})

describe('plain wording', () => {
  it('ages and uptime', () => {
    expect(humanMinutes(0.2)).toBe('under 1 min')
    expect(humanMinutes(12)).toBe('12 min')
    expect(humanMinutes(200)).toBe('3 h 20 min')
    expect(humanMinutes(60 * 24 * 2 + 60 * 4)).toBe('2 d 4 h')
    expect(uptimeText(100)).toBe('100%')
    expect(uptimeText(99.996)).toBe('99.99%')
    expect(uptimeText(99.4)).toBe('99.40%')
    expect(uptimeText(96.13)).toBe('96.1%')
    expect(uptimeText(null)).toBe('—')
  })
})

describe('the syncs', () => {
  it('Zoho: good within 30 minutes of the last good run', () => {
    const ago = (m: number) => new Date(now - m * 60_000).toISOString()
    expect(zohoSyncVerdict({ lastOkAt: ago(12), lastRunOk: true, lastError: null }, now)).toMatchObject({ ok: true })
    expect(zohoSyncVerdict({ lastOkAt: ago(45), lastRunOk: false, lastError: 'timeout' }, now)).toMatchObject({ ok: false, detail: expect.stringContaining('latest run failed') })
    expect(zohoSyncVerdict({ lastOkAt: null, lastRunOk: null, lastError: null }, now).ok).toBe(false)
  })
  it('Google sheets: on time, an error, a late check, a broken connection, or not applicable', () => {
    const hrs = (h: number) => new Date(now - h * 3_600_000).toISOString()
    expect(sheetsVerdict([], false, now)).toBeNull()
    expect(sheetsVerdict([{ kind: 'ac', lastCheckedAt: hrs(3), lastStatus: 'ok', lastError: null }], false, now)).toMatchObject({ ok: true })
    expect(sheetsVerdict([{ kind: 'ac', lastCheckedAt: hrs(3), lastStatus: 'error', lastError: 'tab missing' }], false, now)).toMatchObject({ ok: false, detail: expect.stringContaining('AC: error') })
    expect(sheetsVerdict([{ kind: 'cvm', lastCheckedAt: hrs(30), lastStatus: 'ok', lastError: null }], false, now)).toMatchObject({ ok: false, detail: expect.stringContaining('CVM: not checked') })
    expect(sheetsVerdict([{ kind: 'ac', lastCheckedAt: hrs(1), lastStatus: 'ok', lastError: null }], true, now)).toMatchObject({ ok: false, detail: expect.stringContaining('Google connection') })
  })
  it('e-mail: every active mailbox polled within 20 minutes; none active = not applicable', () => {
    const ago = (m: number) => new Date(now - m * 60_000).toISOString()
    expect(emailVerdict([], now)).toBeNull()
    expect(emailVerdict([{ name: 'a', lastPolledAt: ago(3) }], now)).toMatchObject({ ok: true })
    expect(emailVerdict([{ name: 'a', lastPolledAt: ago(3) }, { name: 'b', lastPolledAt: ago(90) }], now)).toMatchObject({ ok: false, detail: expect.stringContaining('1 of 2') })
    expect(emailVerdict([{ name: 'a', lastPolledAt: null }], now)!.ok).toBe(false)
  })
  it('weather: yesterday is fine before 10:00 India time, today is needed after', () => {
    expect(weatherVerdict('2026-11-17', '2026-11-18', '2026-11-17', 9).ok).toBe(true)
    expect(weatherVerdict('2026-11-17', '2026-11-18', '2026-11-17', 11).ok).toBe(false)
    expect(weatherVerdict('2026-11-18', '2026-11-18', '2026-11-17', 11).ok).toBe(true)
    expect(weatherVerdict(null, '2026-11-18', '2026-11-17', 11).ok).toBe(false)
  })
})

describe('the list of checks', () => {
  it('has unique keys, and the syncs the owner asked for', () => {
    const keys = CHECKS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of ['app', 'database', 'sync_zoho', 'sync_google_sheets', 'sync_email']) expect(keys).toContain(k)
  })
})
