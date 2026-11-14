import { describe, it, expect } from 'vitest'
import { parseZohoTicketNo } from '@/lib/zoho/queries'
import { ZOHO_OPEN_STATUSES, ZOHO_FINISHED_STATUSES, isZohoOpenStatus, tidyZohoStatus, bucketOf, AGE_BUCKETS, RED_FLAG_SHARE, AC_SERVICE } from '@/lib/zoho/report-shapes'

// The Zoho Data tab reads the old Zoho system's own database. These tests cover the rules that decide what a report says,
// so a change to them cannot quietly alter a figure a manager reads.

describe('the Zoho ticket number a person types', () => {
  it('accepts a plain number, with or without a # and spaces', () => {
    expect(parseZohoTicketNo('129571')).toBe(129571)
    expect(parseZohoTicketNo('  129571 ')).toBe(129571)
    expect(parseZohoTicketNo('#129571')).toBe(129571)
    expect(parseZohoTicketNo('1,29,571')).toBe(129571)
  })

  it('refuses anything that is not a ticket number, so nothing odd ever reaches the database', () => {
    for (const bad of ['', '   ', 'ABC-12', '12a', '-5', '0', '1.5', "1 or '1'='1", '129571; drop table zoho_ticket', '١٢٣']) {
      expect(parseZohoTicketNo(bad), bad).toBeNull()
    }
  })

  it('refuses a number too big to be counted exactly', () => {
    expect(parseZohoTicketNo('9'.repeat(18))).toBeNull()
  })
})

describe("Zoho's own statuses", () => {
  it('counts the six waiting statuses as open and nothing else', () => {
    expect(ZOHO_OPEN_STATUSES).toHaveLength(6)
    expect(isZohoOpenStatus('Open')).toBe(true)
    expect(isZohoOpenStatus('Support from OEM/Vendor')).toBe(true)
    expect(isZohoOpenStatus('Closed')).toBe(false)
    expect(isZohoOpenStatus('Workaround Provided')).toBe(false)
    expect(isZohoOpenStatus(null)).toBe(false)
  })

  it('never calls the same status both open and finished', () => {
    for (const s of ZOHO_OPEN_STATUSES) expect(ZOHO_FINISHED_STATUSES).not.toContain(s as never)
  })

  it('shows the two spellings of Rejected as one word', () => {
    expect(tidyZohoStatus('Reject')).toBe('Rejected')
    expect(tidyZohoStatus('Rejected')).toBe('Rejected')
    expect(tidyZohoStatus(null)).toBe('(none)')
  })
})

describe('how old an open ticket is', () => {
  const asOn = new Date('2026-11-14T12:00:00Z')
  const daysAgo = (d: number) => new Date(asOn.getTime() - d * 86_400_000).toISOString()

  it('puts a ticket in the bucket the owner uses', () => {
    expect(bucketOf(daysAgo(0), asOn)).toBe('0-5')
    expect(bucketOf(daysAgo(5), asOn)).toBe('0-5')
    expect(bucketOf(daysAgo(6), asOn)).toBe('6-10')
    expect(bucketOf(daysAgo(10), asOn)).toBe('6-10')
    expect(bucketOf(daysAgo(11), asOn)).toBe('11-20')
    expect(bucketOf(daysAgo(20), asOn)).toBe('11-20')
    expect(bucketOf(daysAgo(21), asOn)).toBe('20+')
    expect(bucketOf(daysAgo(400), asOn)).toBe('20+')
  })

  it('has a bucket for every ticket, so none is left out of the report', () => {
    const keys = AGE_BUCKETS.map((b) => b.key)
    for (let d = 0; d <= 60; d++) expect(keys).toContain(bucketOf(daysAgo(d), asOn))
  })
})

describe('the red flag on a store', () => {
  const red = (open: number, acTotal: number) => open / acTotal >= RED_FLAG_SHARE

  it('turns red at 30% of the store\'s ACs and not before', () => {
    expect(red(2, 7)).toBe(false)   // 28.6%
    expect(red(3, 10)).toBe(true)   // exactly 30%
    expect(red(5, 7)).toBe(true)
    expect(RED_FLAG_SHARE).toBe(0.3)
  })
})

describe('which service the AC reports read', () => {
  it('is the AC issue log only, never the planned-service form', () => {
    expect(AC_SERVICE).toBe('AC Issues Log System Only - Admin Team')
    expect(AC_SERVICE).not.toContain('PMS')
  })
})
