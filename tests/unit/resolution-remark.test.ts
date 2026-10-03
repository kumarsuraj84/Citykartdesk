import { describe, it, expect } from 'vitest'
import { latestResolveActivities, resolutionRemarks, type StatusActivity } from '@/lib/reporting/resolution-remark'

const act = (over: Partial<StatusActivity> = {}): StatusActivity => ({
  request_id: 'r1', actor_id: 'tech', created_at: '2026-10-03T10:00:00.000Z', metadata: { to: 'resolved' }, ...over,
})

describe('resolution remark for reports', () => {
  it('uses the remark stored on the status change', () => {
    const latest = latestResolveActivities([act({ metadata: { to: 'resolved', remark: ' Replaced the printer ' } })])
    expect(resolutionRemarks(latest, []).get('r1')).toBe('Replaced the printer')
  })

  it('for older tickets, falls back to the same technician\'s comment posted right after', () => {
    const latest = latestResolveActivities([act()])
    const map = resolutionRemarks(latest, [
      { request_id: 'r1', author_id: 'tech', created_at: '2026-10-03T10:00:01.200Z', body: 'Fixed the cable' },
      { request_id: 'r1', author_id: 'someone-else', created_at: '2026-10-03T10:00:01.500Z', body: 'thanks' },
    ])
    expect(map.get('r1')).toBe('Fixed the cable')
  })

  it('ignores comments that are too late, too early, or empty', () => {
    const latest = latestResolveActivities([act()])
    const map = resolutionRemarks(latest, [
      { request_id: 'r1', author_id: 'tech', created_at: '2026-10-03T09:59:00.000Z', body: 'earlier note' },
      { request_id: 'r1', author_id: 'tech', created_at: '2026-10-03T10:30:00.000Z', body: 'much later note' },
      { request_id: 'r1', author_id: 'tech', created_at: '2026-10-03T10:00:01.000Z', body: '   ' },
    ])
    expect(map.has('r1')).toBe(false)
  })

  it('takes the latest resolution when a ticket was resolved more than once', () => {
    const latest = latestResolveActivities([
      act({ created_at: '2026-10-01T10:00:00.000Z', metadata: { to: 'resolved', remark: 'first fix' } }),
      act({ created_at: '2026-10-03T10:00:00.000Z', metadata: { to: 'resolved', remark: 'second fix' } }),
      act({ created_at: '2026-10-04T10:00:00.000Z', metadata: { to: 'in_progress', remark: 'reopened' } }),
    ])
    expect(resolutionRemarks(latest, []).get('r1')).toBe('second fix')
  })
})
