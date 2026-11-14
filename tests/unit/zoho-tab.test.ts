import { describe, it, expect } from 'vitest'
import { parseZohoTicketNo } from '@/lib/zoho/queries'
import { isKnownField, labelOf, ownerOf, plainText, showClosure, showElapsed, showZohoValue, tidyFieldName } from '@/lib/zoho/ticket-fields'
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

// ── every Zoho field reaches the screen ───────────────────────────────────────────────────────────────────────────────
// The copy keeps each ticket's whole original Zoho record. These tests cover the reading of it, because a field that is
// shown as blank when Zoho actually held a value is the one mistake a person cannot spot.

describe('reading a value out of the original Zoho record', () => {
  it('shows a date the way Zoho wrote it', () => {
    expect(showZohoValue('responded_time', { value: '1794593357713', display_value: 'Nov 4, 2026 11:54 AM' })).toBe('Nov 4, 2026 11:54 AM')
  })

  it('shows a person, a group or a status by name', () => {
    expect(showZohoValue('technician', { id: '7467000000134001', name: 'Kapil Dev' })).toBe('Kapil Dev')
    expect(showZohoValue('status', { id: '1', name: 'Closed' })).toBe('Closed')
  })

  it('says Yes and No instead of true and false', () => {
    expect(showZohoValue('is_overdue', true)).toBe('Yes')
    expect(showZohoValue('is_escalated', false)).toBe('No')
  })

  it('leaves an unused field blank, so it is simply not shown', () => {
    expect(showZohoValue('responded_time', null)).toBe('')
    expect(showZohoValue('tags', [])).toBe('')
    expect(showZohoValue('subject', '   ')).toBe('')
  })

  it('turns the time taken from milliseconds into hours and minutes', () => {
    expect(showElapsed(12_286_000)).toBe('3 h 25 m')
    expect(showElapsed(60_000)).toBe('1 m')
    expect(showElapsed(0)).toBe('')
    expect(showElapsed(null)).toBe('')
    expect(showZohoValue('time_elapsed', 12_286_000)).toBe('3 h 25 m')
  })

  it('takes the words out of an old e-mail body, formatting and all', () => {
    expect(plainText('<div>Dear team,&nbsp;<br>ladies washroom flas not warking</div>')).toBe('Dear team, \nladies washroom flas not warking')
  })

  it('reads the closure the technician filled in', () => {
    const c = showClosure({ closure_code: { id: '1', name: 'Moved' }, closure_comments: '<p>Replaced the flush valve</p>', requester: { name: 'Kapil Dev' } })
    expect(c.code).toBe('Moved')
    expect(c.comments).toBe('Replaced the flush valve')
    expect(c.by).toBe('Kapil Dev')
  })

  it('never loses a Zoho field we have not named yet', () => {
    expect(isKnownField('responded_time')).toBe(true)
    expect(isKnownField('some_new_zoho_field')).toBe(false)   // still shown, under "Everything else Zoho held"
    expect(tidyFieldName('first_response_due_by_time')).toBe('First response due by time')
    expect(labelOf('closure_info')).toBe('Closure')
  })

  it('knows whose field each one is', () => {
    expect(ownerOf('requester')).toBe('store')
    expect(ownerOf('responded_time')).toBe('technician')
    expect(ownerOf('technician')).toBe('technician')
    expect(ownerOf('sla')).toBe('system')
  })

  it('shows the fields that were missing from the first version of the screen', () => {
    for (const key of ['responded_time', 'assigned_time', 'completed_time', 'resolved_time', 'closure_info', 'department', 'site', 'sla', 'urgency', 'approval_status', 'time_elapsed']) {
      expect(isKnownField(key), key).toBe(true)
    }
  })
})
