import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { visitCodeFor, visitCodeValid, istDay } from '@/lib/visits/code'
import { outcomeAfterStoreAnswer } from '@/lib/visits/confirm'

const ORG = '00000000-0000-0000-0000-000000000001'

describe('the store\'s daily visit code', () => {
  beforeEach(() => { process.env.VISIT_CODE_SECRET = 'unit-test-visit-secret-0123456789' })
  afterEach(() => { delete process.env.VISIT_CODE_SECRET; delete process.env.ALLOW_SHARED_SECRET_FALLBACK })

  const noon = new Date('2026-10-19T06:30:00Z')   // 12:00 in India

  it('is six digits, the same all day, different for another store and another day', () => {
    const a = visitCodeFor(ORG, 'ALC', noon)!
    expect(a).toMatch(/^\d{6}$/)
    expect(visitCodeFor(ORG, 'ALC', new Date('2026-10-19T17:00:00Z'))).toBe(a)         // 22:30 the same day
    expect(visitCodeFor(ORG, 'alc', noon)).toBe(a)                                      // capitals do not matter
    expect(visitCodeFor(ORG, 'MAR', noon)).not.toBe(a)
    expect(visitCodeFor(ORG, 'ALC', new Date('2026-10-20T06:30:00Z'))).not.toBe(a)
  })

  it('changes at midnight Indian time', () => {
    expect(istDay(new Date('2026-10-19T18:29:00Z'))).toBe('2026-10-19')
    expect(istDay(new Date('2026-10-19T18:31:00Z'))).toBe('2026-10-20')
  })

  it('accepts today\'s and yesterday\'s code, nothing older, and refuses a wrong or malformed code', () => {
    const today = visitCodeFor(ORG, 'ALC', noon)!
    const yesterday = visitCodeFor(ORG, 'ALC', new Date(noon.getTime() - 24 * 3600_000))!
    const older = visitCodeFor(ORG, 'ALC', new Date(noon.getTime() - 48 * 3600_000))!
    expect(visitCodeValid(ORG, 'ALC', today, noon)).toBe(true)
    expect(visitCodeValid(ORG, 'ALC', yesterday, noon)).toBe(true)
    expect(visitCodeValid(ORG, 'ALC', older, noon)).toBe(false)
    expect(visitCodeValid(ORG, 'MAR', today, noon)).toBe(false)                          // another store's code
    expect(visitCodeValid(ORG, 'ALC', '12345', noon)).toBe(false)
    expect(visitCodeValid(ORG, 'ALC', '', noon)).toBe(false)
    expect(visitCodeValid(ORG, 'ALC', ` ${today.slice(0, 3)} ${today.slice(3)} `, noon)).toBe(true)   // spaces typed by a person are ignored
  })

  it('is switched off when the server has no secret, and never falls back to another secret by itself', () => {
    delete process.env.VISIT_CODE_SECRET
    process.env.CRON_SECRET = 'some-cron-secret-0123456789abcdef'
    expect(visitCodeFor(ORG, 'ALC', noon)).toBeNull()
    expect(visitCodeValid(ORG, 'ALC', '123456', noon)).toBe(false)
    process.env.ALLOW_SHARED_SECRET_FALLBACK = '1'                                       // only the transitional switch allows it
    expect(visitCodeFor(ORG, 'ALC', noon)).toMatch(/^\d{6}$/)
    delete process.env.CRON_SECRET
  })
})

describe('what happens after the store answers (the agreed rules)', () => {
  it.each([
    ['resolved', 'resolved', 'resolved_both'],            // both agree: resolved
    ['resolved', 'not_resolved', 'disputed'],             // engineer says resolved, store says not: not resolved, the OEM is asked to send an engineer again
    ['not_resolved', 'resolved', 'resolved_by_store'],    // the store's confirmation is final
    ['not_resolved', 'not_resolved', 'open'],             // stays open
  ] as const)('engineer %s + store %s => %s', (engineer, store, expected) => {
    expect(outcomeAfterStoreAnswer(engineer, store)).toBe(expected)
  })
})
